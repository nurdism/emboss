import { Box2, Vector2 } from 'three'
import { pointInPolygon, type Contour } from './contours'
import type { HoleMode, PlateShape } from './types'

/**
 * Round every corner of a polygon by the same radius, inserting a tangent arc
 * at each vertex. The radius is clamped per corner to half the shorter
 * neighbouring edge, so a value larger than a shape can take simply gives the
 * roundest version of that shape rather than folding it inside out.
 */
function roundCorners(points: Contour, radius: number, segments: number): Contour {
  if (radius <= 1e-6 || points.length < 3) return points
  const count = points.length
  const out: Contour = []

  for (let i = 0; i < count; i++) {
    const current = points[i]
    const previous = points[(i - 1 + count) % count]
    const next = points[(i + 1) % count]

    const toPrev = new Vector2(previous.x - current.x, previous.y - current.y)
    const toNext = new Vector2(next.x - current.x, next.y - current.y)
    const lenPrev = toPrev.length()
    const lenNext = toNext.length()
    if (lenPrev < 1e-9 || lenNext < 1e-9) continue
    toPrev.divideScalar(lenPrev)
    toNext.divideScalar(lenNext)

    const cosine = Math.max(-1, Math.min(1, toPrev.dot(toNext)))
    const interior = Math.acos(cosine)
    // A straight run has nothing to round.
    if (interior > Math.PI - 1e-4 || interior < 1e-4) {
      out.push(current.clone())
      continue
    }

    const half = interior / 2
    const tangent = Math.min(radius / Math.tan(half), lenPrev / 2, lenNext / 2)
    const effective = tangent * Math.tan(half)

    const startPoint = new Vector2(
      current.x + toPrev.x * tangent,
      current.y + toPrev.y * tangent,
    )
    const endPoint = new Vector2(current.x + toNext.x * tangent, current.y + toNext.y * tangent)

    const bisector = new Vector2(toPrev.x + toNext.x, toPrev.y + toNext.y)
    if (bisector.lengthSq() < 1e-12) {
      out.push(startPoint, endPoint)
      continue
    }
    bisector.normalize()
    const centre = new Vector2(
      current.x + bisector.x * (effective / Math.sin(half)),
      current.y + bisector.y * (effective / Math.sin(half)),
    )

    let from = Math.atan2(startPoint.y - centre.y, startPoint.x - centre.x)
    const to = Math.atan2(endPoint.y - centre.y, endPoint.x - centre.x)
    let sweep = to - from
    while (sweep > Math.PI) sweep -= Math.PI * 2
    while (sweep < -Math.PI) sweep += Math.PI * 2

    const steps = Math.max(2, Math.round((segments * Math.abs(sweep)) / (Math.PI / 2)))
    for (let step = 0; step <= steps; step++) {
      const angle = from + (sweep * step) / steps
      out.push(
        new Vector2(centre.x + Math.cos(angle) * effective, centre.y + Math.sin(angle) * effective),
      )
    }
  }
  return out
}

function rectangle(w: number, h: number): Contour {
  return [
    new Vector2(-w / 2, -h / 2),
    new Vector2(w / 2, -h / 2),
    new Vector2(w / 2, h / 2),
    new Vector2(-w / 2, h / 2),
  ]
}

function ellipse(w: number, h: number, segments: number): Contour {
  const points: Vector2[] = []
  const count = Math.max(24, segments * 8)
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2
    points.push(new Vector2((Math.cos(angle) * w) / 2, (Math.sin(angle) * h) / 2))
  }
  return points
}

function polygon(w: number, h: number, sides: number, rotation: number): Contour {
  const points: Vector2[] = []
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i / sides) * Math.PI * 2
    points.push(new Vector2((Math.cos(angle) * w) / 2, (Math.sin(angle) * h) / 2))
  }
  return points
}

/** Apex up, flat base, lifted so the centroid rather than the box centre sits on the origin. */
function triangle(w: number, h: number): Contour {
  const lift = h / 6
  return [
    new Vector2(0, h / 2 + lift),
    new Vector2(-w / 2, -h / 2 + lift),
    new Vector2(w / 2, -h / 2 + lift),
  ]
}

/** Rectangular top, pointed bottom. Reads as a badge or crest. */
function shield(w: number, h: number): Contour {
  const x = w / 2
  const y = h / 2
  return [
    new Vector2(0, -y),
    new Vector2(x, -y + h * 0.35),
    new Vector2(x, y),
    new Vector2(-x, y),
    new Vector2(-x, -y + h * 0.35),
  ]
}

/** Shapes whose width and height are always equal. */
export const LOCKED_ASPECT: ReadonlySet<PlateShape> = new Set<PlateShape>([
  'square',
  'circle',
  'stop',
])

/** Shapes drawn as smooth curves, where a corner radius means nothing. */
export const SMOOTH_SHAPES: ReadonlySet<PlateShape> = new Set<PlateShape>([
  'circle',
  'ellipse',
  'pill',
  'rect',
])

export function plateContour(
  shape: PlateShape,
  width: number,
  height: number,
  cornerRadius: number,
  segments: number,
): Contour {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const round = (points: Contour) => roundCorners(points, Math.max(0, cornerRadius), segments)

  switch (shape) {
    case 'rect':
      return rectangle(w, h)
    case 'rounded':
    case 'square':
      return round(rectangle(w, h))
    case 'pill':
      return roundCorners(rectangle(w, h), Math.min(w, h) / 2, Math.max(segments, 12))
    case 'circle':
    case 'ellipse':
      return ellipse(w, h, segments)
    case 'triangle':
      return round(triangle(w, h))
    case 'hexagon':
      return round(polygon(w, h, 6, 0))
    // A stop sign is the same eight sided outline, held square so the top,
    // bottom and sides come out flat.
    case 'stop':
    case 'octagon':
      return round(polygon(w, h, 8, Math.PI / 8))
    case 'shield':
      return round(shield(w, h))
  }
}

function toCcw(contour: Contour): Contour {
  return polygonArea(contour) < 0 ? [...contour].reverse() : contour
}

function polygonArea(contour: Contour): number {
  let sum = 0
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i]
    const b = contour[(i + 1) % contour.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

/** Keep the part of a polygon on the inner side of a line, Sutherland-Hodgman style. */
function clipToHalfPlane(polygon: Contour, origin: Vector2, normal: Vector2): Contour {
  const depth = (p: Vector2) => (p.x - origin.x) * normal.x + (p.y - origin.y) * normal.y
  const out: Contour = []
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i]
    const next = polygon[(i + 1) % polygon.length]
    const dc = depth(current)
    const dn = depth(next)
    if (dc >= 0) out.push(current)
    if (dc >= 0 !== dn >= 0) {
      const t = dc / (dc - dn)
      out.push(new Vector2(current.x + (next.x - current.x) * t, current.y + (next.y - current.y) * t))
    }
  }
  return out
}

/**
 * Shrink an outline by a fixed distance measured perpendicular to every edge,
 * so a rim drawn between the original and the result keeps an even width all
 * the way round.
 *
 * Every plate outline is convex, and the inward offset of a convex polygon is
 * exactly the intersection of its edge half-planes pushed inwards. Building it
 * that way clips corners instead of letting them fold through themselves, which
 * is what happens to a rounded rectangle offset by more than its corner radius.
 * Returns null once the outline has nothing left.
 */
export function offsetInward(contour: Contour, distance: number): Contour | null {
  const ring = toCcw(contour)
  if (ring.length < 3) return null
  if (distance <= 0) return [...ring]

  let box = new Box2()
  box.makeEmpty()
  for (const p of ring) box.expandByPoint(p)
  const pad = Math.max(box.max.x - box.min.x, box.max.y - box.min.y)
  let result: Contour = [
    new Vector2(box.min.x - pad, box.min.y - pad),
    new Vector2(box.max.x + pad, box.min.y - pad),
    new Vector2(box.max.x + pad, box.max.y + pad),
    new Vector2(box.min.x - pad, box.max.y + pad),
  ]

  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    if (length < 1e-9) continue
    // Interior lies to the left of every edge on a counter-clockwise ring.
    const normal = new Vector2(-dy / length, dx / length)
    const origin = new Vector2(a.x + normal.x * distance, a.y + normal.y * distance)
    result = clipToHalfPlane(result, origin, normal)
    if (result.length < 3) return null
  }

  const cleaned: Contour = []
  for (const p of result) {
    const last = cleaned[cleaned.length - 1]
    if (!last || last.distanceToSquared(p) > 1e-12) cleaned.push(p)
  }
  while (cleaned.length > 1 && cleaned[0].distanceToSquared(cleaned[cleaned.length - 1]) <= 1e-12) {
    cleaned.pop()
  }
  if (cleaned.length < 3 || polygonArea(cleaned) <= 1e-6) return null
  return cleaned
}

export interface BorderRings {
  outer: Contour
  inner: Contour
}

/**
 * The two rings that bound a rim: the outer one set in from the plate edge, the
 * inner one a border width further in. Null when the rim will not fit.
 */
export function borderContours(
  plate: Contour,
  inset: number,
  width: number,
): BorderRings | null {
  if (width <= 0) return null
  const outer = offsetInward(plate, Math.max(MIN_BORDER_INSET, inset))
  if (!outer) return null
  const inner = offsetInward(plate, Math.max(MIN_BORDER_INSET, inset) + width)
  if (!inner) return null
  return { outer, inner }
}

/** A rim flush with the plate edge would leave a zero width wall, so keep a lip. */
export const MIN_BORDER_INSET = 0.4

function circle(cx: number, cy: number, radius: number, segments = 32): Contour {
  const points: Vector2[] = []
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    points.push(new Vector2(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius))
  }
  return points
}

/** Even-odd fill test across every artwork ring. */
function insideArtwork(pt: Vector2, artwork: Contour[]): boolean {
  let inside = false
  for (const contour of artwork) {
    if (pointInPolygon(pt, contour)) inside = !inside
  }
  return inside
}

function distanceToSegment(p: Vector2, a: Vector2, b: Vector2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  const t =
    lengthSq < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

function clearsArtwork(centre: Vector2, clearance: number, artwork: Contour[]): boolean {
  if (insideArtwork(centre, artwork)) return false
  for (const contour of artwork) {
    for (let i = 0; i < contour.length; i++) {
      if (distanceToSegment(centre, contour[i], contour[(i + 1) % contour.length]) < clearance) {
        return false
      }
    }
  }
  return true
}

const holeFits = (centre: Vector2, radius: number, plate: Contour): boolean =>
  circle(centre.x, centre.y, radius, 16).every((p) => pointInPolygon(p, plate))

/**
 * Corner insets are measured off the bounding box, which puts them outside a
 * round or angled plate. Walk the hole back towards the centre until it clears
 * the outline so every plate shape gets usable holes.
 */
function pullInside(centre: Vector2, radius: number, plate: Contour): Vector2 | null {
  if (holeFits(centre, radius, plate)) return centre
  let low = 0
  let high = 1
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2
    if (holeFits(new Vector2(centre.x * mid, centre.y * mid), radius, plate)) low = mid
    else high = mid
  }
  const fitted = new Vector2(centre.x * low, centre.y * low)
  return holeFits(fitted, radius, plate) ? fitted : null
}

export interface HolePlacement {
  contours: Contour[]
  /** Holes that were asked for but had nowhere safe to go. */
  dropped: number
}

/**
 * Place mounting holes, skipping any that would run off the plate, collide with
 * another hole, or cut into the artwork. Dropping a hole keeps the mesh sound
 * and is reported back so the sign can say what happened.
 */
export function mountingHoleContours(
  mode: HoleMode,
  plate: Contour,
  width: number,
  height: number,
  diameter: number,
  inset: number,
  artwork: Contour[] = [],
): HolePlacement {
  if (mode === 'none' || diameter <= 0) return { contours: [], dropped: 0 }

  const radius = diameter / 2
  // Leave a wall between the hole and whatever is next to it.
  const clearance = radius + Math.min(1.2, radius)
  const x = Math.max(0, width / 2 - inset)
  const y = Math.max(0, height / 2 - inset)

  const centres: Vector2[] = []
  if (mode === 'top-center') centres.push(new Vector2(0, y))
  if (mode === 'top-corners') centres.push(new Vector2(-x, y), new Vector2(x, y))
  if (mode === 'four-corners') {
    centres.push(new Vector2(-x, y), new Vector2(x, y), new Vector2(-x, -y), new Vector2(x, -y))
  }

  const placed: Vector2[] = []
  const contours: Contour[] = []
  let dropped = 0

  for (const centre of centres) {
    const fitted = pullInside(centre, clearance, plate)
    const collides =
      fitted === null ||
      placed.some((other) => other.distanceTo(fitted) < diameter + 1) ||
      !clearsArtwork(fitted, clearance, artwork)
    if (collides) {
      dropped++
      continue
    }
    placed.push(fitted)
    contours.push(circle(fitted.x, fitted.y, radius))
  }

  return { contours, dropped }
}
