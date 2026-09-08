import { Box2, Vector2 } from 'three'

export type Contour = Vector2[]

export interface ContourNode {
  points: Contour
  children: ContourNode[]
}

/** Signed area, positive when the contour winds counter-clockwise. */
export function signedArea(points: Contour): number {
  let sum = 0
  for (let i = 0, n = points.length; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

export function pointInPolygon(pt: Vector2, poly: Contour): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    const straddles = a.y > pt.y !== b.y > pt.y
    if (straddles && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Containment is decided by sampling vertices. Voting keeps a point that lands
 * exactly on a shared boundary from flipping the answer.
 */
function contourInside(inner: Contour, outer: Contour): boolean {
  const samples = Math.min(16, inner.length)
  const step = Math.max(1, Math.floor(inner.length / samples))
  let hits = 0
  let tested = 0
  for (let i = 0; i < inner.length; i += step) {
    tested++
    if (pointInPolygon(inner[i], outer)) hits++
  }
  return hits * 2 > tested
}

const side = (a: Vector2, b: Vector2, c: Vector2): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

/** True only for a proper crossing. Segments that merely touch do not count. */
function segmentsCross(a1: Vector2, a2: Vector2, b1: Vector2, b2: Vector2): boolean {
  if (Math.min(a1.x, a2.x) > Math.max(b1.x, b2.x)) return false
  if (Math.max(a1.x, a2.x) < Math.min(b1.x, b2.x)) return false
  if (Math.min(a1.y, a2.y) > Math.max(b1.y, b2.y)) return false
  if (Math.max(a1.y, a2.y) < Math.min(b1.y, b2.y)) return false
  const d1 = side(b1, b2, a1)
  const d2 = side(b1, b2, a2)
  const d3 = side(a1, a2, b1)
  const d4 = side(a1, a2, b2)
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0
}

/**
 * Whether two rings actually cut through each other.
 *
 * Plenty of real fonts draw a serif or a bowl as its own contour that overlaps
 * the stem, relying on the nonzero winding rule to union them. Such a ring is
 * not a counter, and treating it as one hands the triangulator a hole that
 * pokes outside its own outline, which produces a mesh that is not closed.
 */
export function contoursCross(a: Contour, b: Contour): boolean {
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i]
    const a2 = a[(i + 1) % a.length]
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(a1, a2, b[j], b[(j + 1) % b.length])) return true
    }
  }
  return false
}

/**
 * Nest contours by containment: outermost rings become solids, the rings
 * directly inside them become holes, rings inside those become solids again.
 * This is the even-odd rule, which matches how letter counters and typical
 * logo artwork are drawn.
 */
export function buildContourTree(contours: Contour[]): ContourNode[] {
  const usable = contours
    .filter((c) => c.length >= 3 && Math.abs(signedArea(c)) > 1e-9)
    .map((points) => ({ points, area: Math.abs(signedArea(points)), box: contourBounds([points]) }))
    .sort((a, b) => b.area - a.area)

  const roots: ContourNode[] = []
  const placed: { node: ContourNode; box: Box2 }[] = []

  for (const { points, box } of usable) {
    const node: ContourNode = { points, children: [] }
    // Rings are sorted largest first, so the last match walking forwards is the
    // tightest ring that truly encloses this one.
    let parent: ContourNode | null = null
    for (const candidate of placed) {
      if (!candidate.box.containsBox(box)) continue
      if (!contourInside(points, candidate.node.points)) continue
      if (contoursCross(points, candidate.node.points)) continue
      parent = candidate.node
    }
    if (parent) parent.children.push(node)
    else roots.push(node)
    placed.push({ node, box })
  }
  return roots
}

/** A planar face: one outer ring with zero or more holes punched in it. */
export interface Region {
  outer: Contour
  holes: Contour[]
}

/**
 * Turn a nesting forest into planar faces, alternating solid and hole. A ring
 * two levels down (a letter counter, say) becomes a face of its own.
 */
export function forestToRegions(nodes: ContourNode[]): Region[] {
  const regions: Region[] = []
  for (const node of nodes) {
    regions.push({ outer: node.points, holes: node.children.map((child) => child.points) })
    for (const child of node.children) {
      regions.push(...forestToRegions(child.children))
    }
  }
  return regions
}

/** Every ring in a forest, at any depth. */
export function forestContours(nodes: ContourNode[]): Contour[] {
  const all: Contour[] = []
  for (const node of nodes) {
    all.push(node.points)
    all.push(...forestContours(node.children))
  }
  return all
}

export function contourBounds(contours: Contour[]): Box2 {
  const box = new Box2()
  box.makeEmpty()
  for (const contour of contours) {
    for (const point of contour) box.expandByPoint(point)
  }
  return box
}

export function translateContours(contours: Contour[], dx: number, dy: number): void {
  for (const contour of contours) {
    for (const point of contour) {
      point.x += dx
      point.y += dy
    }
  }
}

/** Drop repeated points, including a closing point equal to the first. */
export function cleanContour(points: Vector2[], epsilon = 1e-6): Contour {
  const out: Vector2[] = []
  for (const point of points) {
    const last = out[out.length - 1]
    if (!last || last.distanceToSquared(point) > epsilon * epsilon) out.push(point)
  }
  while (out.length > 1 && out[0].distanceToSquared(out[out.length - 1]) <= epsilon * epsilon) {
    out.pop()
  }
  return out
}
