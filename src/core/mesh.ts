import { BufferAttribute, BufferGeometry, Vector2 } from 'three'
import earcut from 'earcut'
import { signedArea, type Contour, type Region } from './contours'

/** A welded, indexed triangle soup in millimetres, Z up. */
export interface SolidMesh {
  positions: number[]
  indices: number[]
}

const WELD = 1e5
const EPSILON = 1e-6

class MeshBuilder {
  readonly positions: number[] = []
  readonly indices: number[] = []
  private readonly lookup = new Map<string, number>()

  vertex(x: number, y: number, z: number): number {
    const key = `${Math.round(x * WELD)},${Math.round(y * WELD)},${Math.round(z * WELD)}`
    const existing = this.lookup.get(key)
    if (existing !== undefined) return existing
    const id = this.positions.length / 3
    this.positions.push(x, y, z)
    this.lookup.set(key, id)
    return id
  }

  triangle(a: number, b: number, c: number): void {
    if (a === b || b === c || a === c) return
    this.indices.push(a, b, c)
  }

  build(): SolidMesh {
    return { positions: this.positions, indices: this.indices }
  }
}

function ccw(contour: Contour): Contour {
  return signedArea(contour) < 0 ? [...contour].reverse() : contour
}

function cw(contour: Contour): Contour {
  return signedArea(contour) > 0 ? [...contour].reverse() : contour
}

/** Outer rings counter-clockwise, holes clockwise, so winding rules stay simple. */
export function orientRegion(region: Region): Region {
  return { outer: ccw(region.outer), holes: region.holes.map(cw) }
}

/**
 * Points are looked up by grid cell so edge splitting stays near linear
 * instead of testing every vertex against every edge.
 */
class PointGrid {
  private readonly cells = new Map<string, number[]>()
  private readonly size: number

  constructor(private readonly points: Vector2[]) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of points) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
    const span = Math.max(maxX - minX, maxY - minY, 1)
    this.size = span / Math.max(4, Math.ceil(Math.sqrt(points.length)))
    points.forEach((p, i) => {
      const key = this.key(p.x, p.y)
      const bucket = this.cells.get(key)
      if (bucket) bucket.push(i)
      else this.cells.set(key, [i])
    })
  }

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.size)},${Math.floor(y / this.size)}`
  }

  near(a: Vector2, b: Vector2): number[] {
    const x0 = Math.floor(Math.min(a.x, b.x) / this.size) - 1
    const x1 = Math.floor(Math.max(a.x, b.x) / this.size) + 1
    const y0 = Math.floor(Math.min(a.y, b.y) / this.size) - 1
    const y1 = Math.floor(Math.max(a.y, b.y) / this.size) + 1
    const found: number[] = []
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const bucket = this.cells.get(`${x},${y}`)
        if (bucket) found.push(...bucket)
      }
    }
    return found
  }

  point(i: number): Vector2 {
    return this.points[i]
  }
}

/** Vertices strictly between a and b, ordered along the segment. */
function splitPoints(grid: PointGrid, ai: number, bi: number): number[] {
  const a = grid.point(ai)
  const b = grid.point(bi)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq < EPSILON * EPSILON) return []

  const hits: { index: number; t: number }[] = []
  for (const i of grid.near(a, b)) {
    if (i === ai || i === bi) continue
    const p = grid.point(i)
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq
    if (t <= EPSILON || t >= 1 - EPSILON) continue
    const distance = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / Math.sqrt(lengthSq)
    if (distance > EPSILON) continue
    hits.push({ index: i, t })
  }
  hits.sort((l, r) => l.t - r.t)
  return hits.map((hit) => hit.index)
}

/**
 * Earcut bridges holes with edges that can run straight through other
 * vertices, leaving a T-junction: one side of the seam is a single long edge,
 * the other is several short ones, and the mesh stops being closed. Splitting
 * every such edge at the vertices lying on it restores a watertight cap.
 */
function removeTJunctions(points: Vector2[], triangles: number[]): number[] {
  const grid = new PointGrid(points)
  const queue: [number, number, number][] = []
  for (let i = 0; i < triangles.length; i += 3) {
    queue.push([triangles[i], triangles[i + 1], triangles[i + 2]])
  }

  const out: number[] = []
  let guard = queue.length * 64 + 1024
  while (queue.length > 0 && guard-- > 0) {
    const [a, b, c] = queue.pop()!
    const edges: [number, number, number][] = [
      [a, b, c],
      [b, c, a],
      [c, a, b],
    ]
    let split = false
    for (const [start, end, apex] of edges) {
      const between = splitPoints(grid, start, end)
      if (between.length === 0) continue
      // Fan the run from the opposite corner, which never lies on this edge.
      const chain = [start, ...between, end]
      for (let i = 0; i < chain.length - 1; i++) {
        queue.push([chain[i], chain[i + 1], apex])
      }
      split = true
      break
    }
    if (!split) out.push(a, b, c)
  }
  if (guard <= 0) out.push(...queue.flat())
  return out
}

/** Triangulate one planar face. Returns indices into the concatenated rings. */
function triangulateRegion(region: Region): { points: Vector2[]; triangles: number[] } {
  const points: Vector2[] = [...region.outer]
  const coords: number[] = []
  for (const p of region.outer) coords.push(p.x, p.y)
  const holeIndices: number[] = []
  for (const hole of region.holes) {
    holeIndices.push(points.length)
    for (const p of hole) {
      points.push(p)
      coords.push(p.x, p.y)
    }
  }
  const triangles = earcut(coords, holeIndices, 2)
  return { points, triangles: removeTJunctions(points, triangles) }
}

function addCap(mesh: MeshBuilder, region: Region, z: number, faceUp: boolean): void {
  const { points, triangles } = triangulateRegion(region)
  for (let i = 0; i < triangles.length; i += 3) {
    const p0 = points[triangles[i]]
    const p1 = points[triangles[i + 1]]
    const p2 = points[triangles[i + 2]]
    // Force counter-clockwise, then flip for a downward face.
    const area = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)
    if (Math.abs(area) < EPSILON * EPSILON) continue
    const [a, b, c] =
      area > 0 ? [p0, p1, p2] : [p0, p2, p1]
    const ia = mesh.vertex(a.x, a.y, z)
    const ib = mesh.vertex(b.x, b.y, z)
    const ic = mesh.vertex(c.x, c.y, z)
    if (faceUp) mesh.triangle(ia, ib, ic)
    else mesh.triangle(ia, ic, ib)
  }
}

/**
 * Walls between two heights. Following the ring's own direction puts the
 * normal on the right-hand side, which is outwards for a counter-clockwise
 * outer ring and into the void for a clockwise hole. Reverse flips that, which
 * is what a pocket's inner surface needs.
 */
function addWalls(
  mesh: MeshBuilder,
  contour: Contour,
  zLow: number,
  zHigh: number,
  reverse: boolean,
): void {
  const ring = reverse ? [...contour].reverse() : contour
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const bottomA = mesh.vertex(a.x, a.y, zLow)
    const bottomB = mesh.vertex(b.x, b.y, zLow)
    const topB = mesh.vertex(b.x, b.y, zHigh)
    const topA = mesh.vertex(a.x, a.y, zHigh)
    mesh.triangle(bottomA, bottomB, topB)
    mesh.triangle(bottomA, topB, topA)
  }
}

const ringsOf = (region: Region): Contour[] => [region.outer, ...region.holes]

/** A straight prism: the regions swept from zBottom to zTop. */
export function extrudeSolid(regions: Region[], zBottom: number, zTop: number): SolidMesh {
  const mesh = new MeshBuilder()
  for (const raw of regions) {
    const region = orientRegion(raw)
    addCap(mesh, region, zTop, true)
    addCap(mesh, region, zBottom, false)
    for (const ring of ringsOf(region)) addWalls(mesh, ring, zBottom, zTop, false)
  }
  return mesh.build()
}

/**
 * A prism with pockets milled into its top face, built as one closed solid so
 * slicers see a single watertight body rather than two stacked ones.
 *
 * `body` is the plate profile including any through holes. `pockets` are the
 * recesses. `topFace` is what is left of the top surface once they are cut.
 */
export function extrudePocketed(
  body: Region[],
  topFace: Region[],
  pockets: Region[],
  zBottom: number,
  zTop: number,
  pocketFloor: number,
): SolidMesh {
  const mesh = new MeshBuilder()

  for (const raw of body) {
    const region = orientRegion(raw)
    addCap(mesh, region, zBottom, false)
    for (const ring of ringsOf(region)) addWalls(mesh, ring, zBottom, zTop, false)
  }
  for (const raw of topFace) {
    addCap(mesh, orientRegion(raw), zTop, true)
  }
  for (const raw of pockets) {
    const region = orientRegion(raw)
    addCap(mesh, region, pocketFloor, true)
    for (const ring of ringsOf(region)) addWalls(mesh, ring, pocketFloor, zTop, true)
  }
  return mesh.build()
}

export function toBufferGeometry(mesh: SolidMesh): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(mesh.positions), 3))
  geometry.setIndex(new BufferAttribute(new Uint32Array(mesh.indices), 1))
  geometry.computeVertexNormals()
  return geometry
}

export const triangleCount = (mesh: SolidMesh): number => mesh.indices.length / 3
