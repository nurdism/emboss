import { Vector2 } from 'three'
import polygonClipping, { type Geom, type Ring } from 'polygon-clipping'
import { buildContourTree, forestToRegions, type Contour } from './contours'

/**
 * Normalise artwork outlines into rings that never cross themselves or each
 * other.
 *
 * TrueType fills with the nonzero winding rule, and plenty of faces lean on it:
 * a serif is drawn as its own contour lapping over the stem, and some display
 * faces draw a whole glyph as one self-crossing stroke whose counters exist
 * only because the path doubles back. Handing outlines like that straight to a
 * triangulator produces a surface with holes in it.
 *
 * Unioning the outlines resolves every overlap and self-crossing into plain
 * nested rings, which is what the extruder needs. Anything the boolean cannot
 * handle falls back to the original outlines rather than failing the build.
 */
export function repairContours(contours: Contour[]): Contour[] {
  if (contours.length === 0) return contours

  const regions = forestToRegions(buildContourTree(contours))
  if (regions.length === 0) return contours

  const polygons: Geom[] = regions.map((region) =>
    [region.outer, ...region.holes].map(closedRing),
  )

  try {
    const united = polygonClipping.union(polygons[0], ...polygons.slice(1))
    const out: Contour[] = []
    for (const polygon of united) {
      for (const ring of polygon) {
        const contour = openRing(ring)
        if (contour.length >= 3) out.push(contour)
      }
    }
    return out.length > 0 ? out : contours
  } catch {
    return contours
  }
}

/** The clipper wants the first point repeated at the end. */
function closedRing(contour: Contour): Ring {
  const ring: Ring = contour.map((p) => [p.x, p.y])
  ring.push([contour[0].x, contour[0].y])
  return ring
}

/** Drop the repeated closing point the clipper hands back. */
function openRing(ring: readonly (readonly number[])[]): Contour {
  const points: Contour = []
  for (const [x, y] of ring) {
    const last = points[points.length - 1]
    if (last && Math.abs(last.x - x) < 1e-9 && Math.abs(last.y - y) < 1e-9) continue
    points.push(new Vector2(x, y))
  }
  const first = points[0]
  const last = points[points.length - 1]
  if (points.length > 1 && first && last && Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) {
    points.pop()
  }
  return points
}
