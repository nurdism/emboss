import { Box2, Vector2 } from 'three'
import type * as opentype from 'opentype.js'
import {
  buildContourTree,
  contourBounds,
  forestContours,
  forestToRegions,
  pointInPolygon,
  type Contour,
  type ContourNode,
  type Region,
} from './contours'
import { extrudePocketed, extrudeSolid, triangleCount, type SolidMesh } from './mesh'
import {
  borderContours,
  LOCKED_ASPECT,
  MIN_BORDER_INSET,
  mountingHoleContours,
  plateContour,
} from './plate'
import { qrArt, type QrArt } from './qr'
import { repairContours, subtractContours } from './repair'
import { svgArt } from './svg'
import { textContours } from './text'
import type { PlateShape, SignConfig } from './types'

/** One printable body, tied to the colour it should come out in. */
export interface SignPart {
  /** Shown in the slicer's part list. */
  name: string
  mesh: SolidMesh
  color: string
}

export interface SignBuild {
  /** The plate, then whatever sits on or in it, in filament slot order. */
  parts: SignPart[]
  plateWidth: number
  plateHeight: number
  totalHeight: number
  triangles: number
  /** Set when the artwork is a QR code, so the panel can report its grain. */
  qr: { modules: number; moduleSize: number } | null
  warnings: string[]
}

/**
 * Auto-fit padding factors. Artwork inscribed in a round or angled plate needs
 * more room than it does in a rectangle.
 */
const FIT_FACTOR: Record<PlateShape, [number, number]> = {
  rect: [1, 1],
  rounded: [1, 1],
  square: [1, 1],
  pill: [1.08, 1.15],
  circle: [1.42, 1.42],
  ellipse: [1.42, 1.42],
  triangle: [2.2, 2.6],
  hexagon: [1.34, 1.16],
  octagon: [1.12, 1.12],
  stop: [1.12, 1.12],
  shield: [1.2, 1.45],
}

export interface BuildInput {
  cfg: SignConfig
  font: opentype.Font | null
  svgSource: string | null
}

/** Clear margin a QR code wants on every side, in modules. */
const QUIET_ZONE = 4

export function buildSign({ cfg, font, svgSource }: BuildInput): SignBuild {
  const warnings: string[] = []
  const text = font && cfg.text.trim().length > 0 ? textContours(font, cfg) : []

  // A QR code takes the artwork slot outright. It is the point of the sign it
  // is on, and pairing one with an icon only starves both of room.
  let svg: Contour[] = []
  let qr: QrArt | null = null
  const qrText = cfg.qrText.trim()

  if (qrText) {
    try {
      qr = qrArt(qrText, cfg)
      svg = qr.contours
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error))
    }
  } else if (svgSource) {
    const parsed = svgArt(svgSource, cfg)
    if (parsed.warning) warnings.push(parsed.warning)
    svg = parsed.contours
  }

  if (svg.length > 0) {
    placeSvg(svg, text, cfg)
    if (
      cfg.svgPlacement === 'manual' &&
      text.length > 0 &&
      overlaps(contourBounds(text), contourBounds(svg))
    ) {
      warnings.push(
        `${qr ? 'The QR code' : 'The SVG'} overlaps the text, which cuts holes where they cross.`,
      )
    }
  }

  // Outlines are normalised before anything measures or nests them, so the rest
  // of the pipeline only ever sees rings that behave.
  // Each element is normalised on its own, so a glyph is never merged into an
  // unrelated icon that happens to sit next to it.
  const textRings = repairContours(text)
  const iconRings = repairContours(svg)
  const content: Contour[] = [...textRings, ...iconRings]

  let plateWidth = Math.max(1, cfg.width)
  let plateHeight = Math.max(1, cfg.height)

  if (cfg.autoFit && content.length > 0) {
    const bounds = contourBounds(content)
    const center = bounds.getCenter(new Vector2())
    for (const contour of content) {
      for (const point of contour) {
        point.x -= center.x
        point.y -= center.y
      }
    }
    const size = bounds.getSize(new Vector2())
    const [fx, fy] = FIT_FACTOR[cfg.plate]
    // Reserve a band for mounting holes so they do not land on the artwork.
    const band = cfg.holes === 'none' ? 0 : cfg.holeDiameter + 4
    const sides = cfg.holes === 'top-center' ? 0 : 2
    const rows = cfg.holes === 'four-corners' ? 2 : 1
    // A rim eats into the plate from every edge, so reserve its full depth too.
    const rim = cfg.borderWidth > 0 ? Math.max(MIN_BORDER_INSET, cfg.borderInset) + cfg.borderWidth : 0
    plateWidth = Math.max(1, size.x * fx + (cfg.padding + rim) * 2 + band * sides)
    plateHeight = Math.max(1, size.y * fy + (cfg.padding + rim) * 2 + band * rows)
  }

  if (LOCKED_ASPECT.has(cfg.plate)) {
    plateWidth = plateHeight = Math.max(plateWidth, plateHeight)
  }

  const plate = plateContour(
    cfg.plate,
    plateWidth,
    plateHeight,
    cfg.cornerRadius,
    Math.max(2, Math.round(cfg.curveSegments / 2)),
  )
  const art: Contour[] = [...content]
  let border = cfg.borderWidth > 0 ? borderContours(plate, cfg.borderInset, cfg.borderWidth) : null

  if (cfg.borderWidth > 0 && !border) {
    warnings.push('The border is too wide for this plate. Reduce the width or inset.')
  }
  if (border && !content.every((c) => c.every((p) => pointInPolygon(p, border!.inner)))) {
    warnings.push('The border would cross the artwork, so it was left off. Add padding or shrink the artwork.')
    border = null
  }
  if (border) {
    art.push(border.outer, border.inner)
    if (cfg.borderWidth < 0.8) {
      warnings.push(
        `A ${cfg.borderWidth.toFixed(1)} mm border is thinner than a typical nozzle and may not print.`,
      )
    }
  }

  let qrReport: SignBuild['qr'] = null

  if (qr && iconRings.length > 0) {
    // The code is square, so either side of its bounds gives the module pitch.
    const box = contourBounds(iconRings)
    const module = Math.max(...box.getSize(new Vector2()).toArray()) / qr.modules
    qrReport = { modules: qr.modules, moduleSize: module }
    if (module < 0.8) {
      warnings.push(
        `Each QR module is about ${module.toFixed(
          2,
        )} mm across, under a typical nozzle width. Enlarge the code, or shorten the text so it needs fewer modules.`,
      )
    }
    // A code needs a clear margin around it to be found at all. The plate
    // supplies it, or the rim does once one is on.
    const field = border ? contourBounds([border.inner]) : null
    const quiet = Math.min(
      (field ? field.max.x : plateWidth / 2) - box.max.x,
      box.min.x - (field ? field.min.x : -plateWidth / 2),
      (field ? field.max.y : plateHeight / 2) - box.max.y,
      box.min.y - (field ? field.min.y : -plateHeight / 2),
    )
    if (quiet < module * QUIET_ZONE) {
      warnings.push(
        `The QR code has ${Math.max(0, quiet).toFixed(1)} mm of clear space around it and wants ${(
          module * QUIET_ZONE
        ).toFixed(1)} mm. Add padding or shrink the code, or scanners may miss it.`,
      )
    }
    // Scanners read a code as dark on light and mostly refuse the inverse.
    const codeColor = cfg.colorMode === 'per-element' ? cfg.iconColor : cfg.artColor
    if (luminance(codeColor) > luminance(cfg.baseColor)) {
      warnings.push(
        'This code is lighter than the plate behind it, and most scanners will not read an inverted code. Swap the two colours.',
      )
    }
  }

  // Holes cannot sit in the rim itself, so push them past it when one is on.
  // Unless they have been told to bore through it, which is the whole point.
  const holeInset =
    border && !cfg.holesThroughAll
      ? Math.max(cfg.holeInset, Math.max(MIN_BORDER_INSET, cfg.borderInset) + cfg.borderWidth + cfg.holeDiameter / 2 + 1.5)
      : cfg.holeInset

  const placement = mountingHoleContours(
    cfg.holes,
    plate,
    plateWidth,
    plateHeight,
    cfg.holeDiameter,
    holeInset,
    art,
    cfg.holesThroughAll,
  )
  const holeNodes: ContourNode[] = placement.contours.map((points) => ({ points, children: [] }))

  if (placement.dropped > 0) {
    warnings.push(
      `${placement.dropped} mounting hole${
        placement.dropped > 1 ? 's had' : ' had'
      } nowhere safe to go. Enlarge the plate, add padding, or shrink the holes${
        cfg.holesThroughAll ? '' : ', or let them cut through everything'
      }.`,
    )
  }

  // A hole boring through everything takes a bite out of whatever it lands on,
  // and it can clip the edge of a letter rather than sitting neatly inside one,
  // so the boolean does the cutting rather than ring nesting.
  const bore = (rings: Contour[]): Contour[] =>
    subtractContours(rings, placement.clearances)
  const artRings = bore(art)

  const artForest = buildContourTree(artRings)
  if (content.some((c) => c.some((p) => !pointInPolygon(p, plate)))) {
    warnings.push('Artwork reaches past the plate edge. Increase the size or reduce the art.')
  }

  const baseDepth = Math.max(0.2, cfg.baseDepth)
  const artDepth = Math.max(0.1, cfg.artDepth)
  const bodyNode: ContourNode = { points: plate, children: holeNodes }

  let base: SolidMesh
  let totalHeight: number
  // Height band every raised or inlaid feature occupies.
  let artBottom: number
  let artTop: number

  if (cfg.mode === 'raised') {
    base = extrudeSolid(forestToRegions([bodyNode]), 0, baseDepth)
    artBottom = baseDepth
    artTop = baseDepth + artDepth
    totalHeight = baseDepth + artDepth
  } else {
    // Inlay: the artwork fills a recess in the plate top. Once the recess is as
    // deep as the plate it becomes a through cut, and the plate is simply a
    // solid with the artwork removed.
    const pocket = Math.min(artDepth, baseDepth)
    const floor = baseDepth - pocket
    artBottom = floor
    artTop = baseDepth
    totalHeight = baseDepth

    if (artForest.length === 0) {
      base = extrudeSolid(forestToRegions([bodyNode]), 0, baseDepth)
    } else {
      const topFace = punch(
        forestToRegions([{ points: plate, children: artForest }]),
        placement.contours,
      )
      if (floor <= 1e-6) {
        base = extrudeSolid(topFace, 0, baseDepth)
        artBottom = 0
      } else {
        base = extrudePocketed(
          forestToRegions([bodyNode]),
          topFace,
          forestToRegions(artForest),
          0,
          baseDepth,
          floor,
        )
      }
    }
  }

  const parts: SignPart[] = [{ name: 'Plate', mesh: base, color: cfg.baseColor }]
  const addPart = (name: string, rings: Contour[], color: string) => {
    if (rings.length === 0) return
    const mesh = extrudeSolid(forestToRegions(buildContourTree(rings)), artBottom, artTop)
    if (mesh.indices.length > 0) parts.push({ name, mesh, color })
  }

  if (cfg.colorMode === 'per-element') {
    // Each element gets its own body, and so its own filament slot.
    addPart('Text', bore(textRings), cfg.textColor)
    addPart(qr ? 'QR code' : 'Icon', bore(iconRings), cfg.iconColor)
    if (border) addPart('Border', bore([border.outer, border.inner]), cfg.borderColor)
  } else {
    addPart('Artwork', artRings, cfg.artColor)
  }

  if (parts.length === 1) {
    warnings.push('No artwork yet, so the sign is a blank plate in one colour.')
  }
  if (plateWidth > cfg.bedX || plateHeight > cfg.bedY) {
    warnings.push(
      `At ${plateWidth.toFixed(0)} x ${plateHeight.toFixed(0)} mm the sign is larger than the ${
        cfg.bedX
      } x ${cfg.bedY} mm bed.`,
    )
  }
  // A QR code reports its own module size, which says the same thing in terms
  // the user can act on, so the generic detail gauge is left to other artwork.
  if (cfg.mode === 'inlay' && artForest.length > 0 && !qr) {
    const thinnest = minFeature(forestContours(artForest))
    if (thinnest < 0.8) {
      warnings.push(
        `Some artwork detail is around ${thinnest.toFixed(
          2,
        )} mm across. Detail under a nozzle width may not print as a separate colour.`,
      )
    }
  }

  return {
    parts,
    plateWidth,
    plateHeight,
    totalHeight,
    triangles: parts.reduce((total, part) => total + triangleCount(part.mesh), 0),
    qr: qrReport,
    warnings,
  }
}

/**
 * Cut through holes out of whichever face contains them. A border inverts the
 * solid and hole parity, so a hole inside the rim lands in the field region
 * rather than the plate region and has to be attached to the right one.
 */
function punch(regions: Region[], holes: Contour[]): Region[] {
  if (holes.length === 0) return regions
  return regions.map((region) => {
    const extra = holes.filter(
      (hole) =>
        pointInPolygon(hole[0], region.outer) &&
        !region.holes.some((existing) => pointInPolygon(hole[0], existing)),
    )
    return extra.length > 0 ? { outer: region.outer, holes: [...region.holes, ...extra] } : region
  })
}

/**
 * Move SVG art, which arrives centred on the origin, to sit beside the text
 * with a clear gap. The manual nudge is applied on top of wherever it lands.
 */
function placeSvg(svg: Contour[], text: Contour[], cfg: SignConfig): void {
  let dx = cfg.svgOffsetX
  let dy = cfg.svgOffsetY

  if (cfg.svgPlacement !== 'manual' && text.length > 0 && svg.length > 0) {
    const textBox = contourBounds(text)
    const svgBox = contourBounds(svg)
    const half = svgBox.getSize(new Vector2()).multiplyScalar(0.5)
    const middle = textBox.getCenter(new Vector2())
    switch (cfg.svgPlacement) {
      case 'above':
        dx += middle.x
        dy += textBox.max.y + cfg.svgGap + half.y
        break
      case 'below':
        dx += middle.x
        dy += textBox.min.y - cfg.svgGap - half.y
        break
      case 'left':
        dx += textBox.min.x - cfg.svgGap - half.x
        dy += middle.y
        break
      case 'right':
        dx += textBox.max.x + cfg.svgGap + half.x
        dy += middle.y
        break
    }
  }

  if (dx === 0 && dy === 0) return
  for (const contour of svg) {
    for (const point of contour) {
      point.x += dx
      point.y += dy
    }
  }
}

/**
 * Rough perceived brightness of a `#rrggbb` colour, 0 to 1. Anything the colour
 * inputs cannot produce reads as mid grey, so it never triggers a warning on
 * its own.
 */
function luminance(color: string): number {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim())
  if (!hex) return 0.5
  const value = parseInt(hex[1], 16)
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

const overlaps = (a: Box2, b: Box2): boolean =>
  a.min.x < b.max.x && b.min.x < a.max.x && a.min.y < b.max.y && b.min.y < a.max.y

/** Smallest bounding-box side across the artwork rings, as a rough detail gauge. */
function minFeature(contours: Contour[]): number {
  let smallest = Infinity
  for (const contour of contours) {
    const box = contourBounds([contour])
    const size = box.getSize(new Vector2())
    smallest = Math.min(smallest, Math.max(size.x, size.y) < 1e-6 ? Infinity : Math.min(size.x, size.y))
  }
  return smallest === Infinity ? Infinity : smallest
}
