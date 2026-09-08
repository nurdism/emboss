import * as opentype from 'opentype.js'
import { Path as ThreePath, Vector2 } from 'three'
import { cleanContour, contourBounds, translateContours, type Contour } from './contours'
import type { SignConfig } from './types'

/**
 * Flatten an opentype path into closed polygonal contours. Opentype hands back
 * screen coordinates with y growing downwards, so y is negated here to land in
 * the y-up millimetre space the rest of the pipeline uses.
 */
function pathToContours(path: opentype.Path, curveSegments: number): Contour[] {
  const contours: Contour[] = []
  let current: ThreePath | null = null
  let started = false

  const flush = () => {
    if (current && started) {
      const points = cleanContour(current.getPoints(curveSegments))
      if (points.length >= 3) contours.push(points)
    }
    current = null
    started = false
  }

  for (const command of path.commands) {
    switch (command.type) {
      case 'M':
        flush()
        current = new ThreePath()
        current.moveTo(command.x, -command.y)
        started = true
        break
      case 'L':
        current?.lineTo(command.x, -command.y)
        break
      case 'C':
        current?.bezierCurveTo(
          command.x1,
          -command.y1,
          command.x2,
          -command.y2,
          command.x,
          -command.y,
        )
        break
      case 'Q':
        current?.quadraticCurveTo(command.x1, -command.y1, command.x, -command.y)
        break
      case 'Z':
        flush()
        break
    }
  }
  flush()
  return contours
}

function lineAdvance(font: opentype.Font, line: string, cfg: SignConfig): number {
  const scale = cfg.fontSize / font.unitsPerEm
  let x = 0
  let previous: opentype.Glyph | null = null
  for (const char of line) {
    const glyph = font.charToGlyph(char)
    if (previous) x += font.getKerningValue(previous, glyph) * scale
    x += (glyph.advanceWidth ?? 0) * scale + cfg.letterSpacing
    previous = glyph
  }
  // Trailing tracking is not part of the visible run.
  return line.length > 0 ? x - cfg.letterSpacing : 0
}

/**
 * Lay the label out line by line, centre the whole block on the origin, then
 * apply the user's nudge. Centring uses the ink bounding box rather than font
 * metrics so a sign reads as visually centred.
 */
export function textContours(font: opentype.Font, cfg: SignConfig): Contour[] {
  const lines = cfg.text.split('\n')
  const scale = cfg.fontSize / font.unitsPerEm
  const widths = lines.map((line) => lineAdvance(font, line, cfg))
  const widest = Math.max(0, ...widths)
  const lineHeight = cfg.fontSize * cfg.lineSpacing

  const contours: Contour[] = []
  lines.forEach((line, lineIndex) => {
    let x = 0
    if (cfg.align === 'center') x = (widest - widths[lineIndex]) / 2
    if (cfg.align === 'right') x = widest - widths[lineIndex]
    const y = -lineIndex * lineHeight

    let previous: opentype.Glyph | null = null
    for (const char of line) {
      const glyph = font.charToGlyph(char)
      if (previous) x += font.getKerningValue(previous, glyph) * scale
      // getPath works in y-down space, so the baseline offset is negated here
      // and pathToContours flips the result back to y-up.
      const glyphPath = glyph.getPath(x, -y, cfg.fontSize, undefined, font)
      contours.push(...pathToContours(glyphPath, cfg.curveSegments))
      x += (glyph.advanceWidth ?? 0) * scale + cfg.letterSpacing
      previous = glyph
    }
  })

  if (contours.length === 0) return contours
  const bounds = contourBounds(contours)
  const center = bounds.getCenter(new Vector2())
  translateContours(contours, -center.x + cfg.textOffsetX, -center.y + cfg.textOffsetY)
  return contours
}
