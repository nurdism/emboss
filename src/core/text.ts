import * as opentype from 'opentype.js'
import { Path as ThreePath, Vector2 } from 'three'
import { cleanContour, contourBounds, translateContours, type Contour } from './contours'
import type { SignConfig } from './types'

/**
 * Lean of a faux italic, in degrees. Only used on a face that has no true
 * italic of its own, which is every bundled face and every uploaded file.
 */
const OBLIQUE = 12

/** Height of a faux small capital, as a fraction of the full size. */
const SMALL_CAP = 0.78

/** Underline metrics for a face whose post table does not offer sensible ones. */
const FALLBACK_UNDERLINE = { position: -0.12, thickness: 0.05 }

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

/**
 * True when the face is already an italic or oblique cut, so asking for italics
 * has been answered by the file itself and nothing needs slanting.
 */
export function isItalicFace(font: opentype.Font): boolean {
  const post = font.tables.post as { italicAngle?: unknown } | undefined
  if (typeof post?.italicAngle === 'number' && post.italicAngle !== 0) return true
  // Bit zero of fsSelection is the italic flag.
  const os2 = font.tables.os2 as { fsSelection?: unknown } | undefined
  return typeof os2?.fsSelection === 'number' && (os2.fsSelection & 1) !== 0
}

/**
 * The label as it should read, with the case treatment applied. Small capitals
 * are left alone here because they need to know which letters started lower
 * case, and that is decided glyph by glyph during layout.
 */
function displayText(cfg: SignConfig): string {
  switch (cfg.textCase) {
    case 'upper':
      return cfg.text.toUpperCase()
    case 'lower':
      return cfg.text.toLowerCase()
    case 'title':
      // Lower case first, so an all caps label becomes Title Case rather than
      // staying shouted, then raise the first letter of every run.
      return cfg.text
        .toLowerCase()
        .replace(/\p{L}[\p{L}\p{M}'\u2019]*/gu, (word) => word[0].toUpperCase() + word.slice(1))
    default:
      return cfg.text
  }
}

interface PlacedGlyph {
  glyph: opentype.Glyph
  /** Point size for this one glyph, which a small capital shrinks. */
  size: number
  /** Pen position, before any alignment indent. */
  x: number
}

/**
 * Walk a line and place every glyph, kerning as it goes. Alignment and drawing
 * both read the result, so the width a line is measured at is the width it is
 * actually drawn at.
 */
function layoutLine(font: opentype.Font, line: string, cfg: SignConfig): {
  glyphs: PlacedGlyph[]
  width: number
} {
  const smallCaps = cfg.textCase === 'small-caps'
  const glyphs: PlacedGlyph[] = []
  let x = 0
  let previous: opentype.Glyph | null = null

  for (const char of line) {
    // A few letters upper case into two, such as the German sharp s. Those keep
    // their own shape rather than losing half of it to charToGlyph.
    const capital = smallCaps ? char.toUpperCase() : char
    const drawn = smallCaps && [...capital].length === 1 ? capital : char
    const size = smallCaps && drawn !== char ? cfg.fontSize * SMALL_CAP : cfg.fontSize

    const glyph = font.charToGlyph(drawn)
    const scale = size / font.unitsPerEm
    if (previous) x += font.getKerningValue(previous, glyph) * scale
    glyphs.push({ glyph, size, x })
    x += (glyph.advanceWidth ?? 0) * scale + cfg.letterSpacing
    previous = glyph
  }

  // Trailing tracking is not part of the visible run.
  return { glyphs, width: glyphs.length > 0 ? x - cfg.letterSpacing : 0 }
}

/** A rule under one line, at the position and weight the face asks for. */
function underlineBar(
  font: opentype.Font,
  cfg: SignConfig,
  left: number,
  width: number,
  baseline: number,
): Contour {
  const post = font.tables.post as { underlinePosition?: unknown; underlineThickness?: unknown } | undefined
  const em = font.unitsPerEm
  const scale = cfg.fontSize / em
  // Some faces leave these at zero, and a few put the underline above the
  // baseline, which is never what was meant.
  const reported = typeof post?.underlinePosition === 'number' ? post.underlinePosition * scale : 0
  const weight = typeof post?.underlineThickness === 'number' ? post.underlineThickness * scale : 0
  const top = baseline + (reported < 0 ? reported : FALLBACK_UNDERLINE.position * cfg.fontSize)
  const thickness = weight > 0 ? weight : FALLBACK_UNDERLINE.thickness * cfg.fontSize

  const right = left + width
  const bottom = top - thickness
  return [
    new Vector2(left, bottom),
    new Vector2(right, bottom),
    new Vector2(right, top),
    new Vector2(left, top),
  ]
}

/**
 * Lay the label out line by line, centre the whole block on the origin, then
 * apply the user's nudge. Centring uses the ink bounding box rather than font
 * metrics so a sign reads as visually centred.
 */
export function textContours(font: opentype.Font, cfg: SignConfig): Contour[] {
  const lines = displayText(cfg).split('\n')
  const laid = lines.map((line) => layoutLine(font, line, cfg))
  const widest = Math.max(0, ...laid.map((line) => line.width))
  const lineHeight = cfg.fontSize * cfg.lineSpacing
  // A face that is already italic needs no help. Everything else gets a lean.
  const slant = cfg.italic && !isItalicFace(font) ? Math.tan((OBLIQUE * Math.PI) / 180) : 0

  const contours: Contour[] = []
  laid.forEach((line, lineIndex) => {
    let indent = 0
    if (cfg.align === 'center') indent = (widest - line.width) / 2
    if (cfg.align === 'right') indent = widest - line.width
    const baseline = -lineIndex * lineHeight

    const drawn: Contour[] = []
    for (const placed of line.glyphs) {
      // getPath works in y-down space, so the baseline offset is negated here
      // and pathToContours flips the result back to y-up.
      const glyphPath = placed.glyph.getPath(indent + placed.x, -baseline, placed.size, undefined, font)
      drawn.push(...pathToContours(glyphPath, cfg.curveSegments))
    }
    // The lean pivots on the baseline, so the feet of the letters stay put.
    if (slant !== 0) {
      for (const contour of drawn) {
        for (const point of contour) point.x += (point.y - baseline) * slant
      }
    }
    contours.push(...drawn)

    // The rule stays level. A slanted one reads as a mistake rather than a lean.
    if (cfg.underline && line.width > 0) {
      contours.push(underlineBar(font, cfg, indent, line.width, baseline))
    }
  })

  if (contours.length === 0) return contours

  const stretch = cfg.textStretch / 100
  if (stretch !== 1) {
    for (const contour of contours) {
      for (const point of contour) point.x *= stretch
    }
  }

  const bounds = contourBounds(contours)
  const center = bounds.getCenter(new Vector2())
  translateContours(contours, -center.x + cfg.textOffsetX, -center.y + cfg.textOffsetY)
  return contours
}
