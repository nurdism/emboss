import { Vector2 } from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import { cleanContour, contourBounds, type Contour } from './contours'
import type { SignConfig } from './types'

export interface SvgArt {
  contours: Contour[]
  /** Set when the file is stroke-only art that had to be treated as filled. */
  warning: string | null
}

const loader = new SVGLoader()

/**
 * Parse an SVG into contours centred on the origin, sized so its longest side
 * matches cfg.svgSize and turned by the requested angle. Placement relative to
 * the text happens later, once the text bounds are known.
 */
export function svgArt(source: string, cfg: SignConfig): SvgArt {
  const parsed = loader.parse(source)
  const filled = parsed.paths.filter((path) => {
    const fill = path.userData?.style?.fill
    return fill !== undefined && fill !== 'none'
  })
  const strokeOnly = filled.length === 0 && parsed.paths.length > 0
  const paths = strokeOnly ? parsed.paths : filled

  const contours: Contour[] = []
  for (const path of paths) {
    for (const subPath of path.subPaths) {
      // SVG is y-down, so flip into the y-up millimetre space.
      const points = cleanContour(
        subPath.getPoints(cfg.curveSegments).map((p) => new Vector2(p.x, -p.y)),
      )
      if (points.length >= 3) contours.push(points)
    }
  }
  if (contours.length === 0) {
    return { contours, warning: 'No closed outlines found in this SVG.' }
  }

  const bounds = contourBounds(contours)
  const size = bounds.getSize(new Vector2())
  const center = bounds.getCenter(new Vector2())
  const longest = Math.max(size.x, size.y)
  const scale = longest > 1e-6 ? cfg.svgSize / longest : 1
  const angle = (cfg.svgRotation * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  for (const contour of contours) {
    for (const point of contour) {
      const x = (point.x - center.x) * scale
      const y = (point.y - center.y) * scale
      point.x = x * cos - y * sin
      point.y = x * sin + y * cos
    }
  }

  return {
    contours,
    warning: strokeOnly
      ? 'This SVG has no filled shapes, so its outlines were extruded as if filled. Convert strokes to outlines for a cleaner result.'
      : null,
  }
}
