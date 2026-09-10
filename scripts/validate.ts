/**
 * Geometry and package checks for the sign pipeline. Run with `npm run check`.
 *
 * The important property is that every solid is closed: in a watertight mesh
 * each directed edge appears exactly as often as its reverse.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Box2, Vector2 } from 'three'
import { strFromU8, unzipSync } from 'fflate'
import qrcode from 'qrcode-generator'
import * as opentype from 'opentype.js'
import { buildSign } from '../src/core/build'
import type { SolidMesh } from '../src/core/mesh'
import { pointInPolygon } from '../src/core/contours'
import { mountingHoleContours, plateContour } from '../src/core/plate'
import { PRESETS } from '../src/core/presets'
import { qrArt } from '../src/core/qr'
import { repairContours } from '../src/core/repair'
import { isItalicFace, textContours } from '../src/core/text'
import { buildThreeMF } from '../src/core/threemf'
import { defaultConfig, type SignConfig } from '../src/core/types'

const readFont = (path: string) => {
  const file = readFileSync(resolve(process.cwd(), path))
  return opentype.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength))
}

const font = readFont('public/fonts/DejaVuSans-Bold.ttf')
/**
 * Playfair Display draws serifs as separate contours that overlap the stem,
 * the nonzero winding rule that TrueType actually uses. Nesting a crossing
 * contour as if it were a counter used to produce a mesh that was not closed,
 * so this face guards that path.
 */
const overlapping = readFont('scripts/fixtures/PlayfairDisplay-Regular.ttf')

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`)
}

interface MeshReport {
  triangles: number
  vertices: number
  unpaired: number
  degenerate: number
  loose: number
}

function inspect(mesh: SolidMesh): MeshReport {
  const edges = new Map<string, number>()
  const used = new Set<number>()
  let degenerate = 0
  let triangles = 0

  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i]
    const b = mesh.indices[i + 1]
    const c = mesh.indices[i + 2]
    if (a === b || b === c || a === c) {
      degenerate++
      continue
    }
    triangles++
    used.add(a).add(b).add(c)
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = `${u}_${v}`
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }

  let unpaired = 0
  for (const [key, count] of edges) {
    const [u, v] = key.split('_')
    if ((edges.get(`${v}_${u}`) ?? 0) !== count) unpaired++
  }

  return {
    triangles,
    vertices: mesh.positions.length / 3,
    unpaired,
    degenerate,
    loose: mesh.positions.length / 3 - used.size,
  }
}

function watertight(label: string, mesh: SolidMesh): void {
  const r = inspect(mesh)
  check(
    label,
    r.unpaired === 0 && r.degenerate === 0 && r.loose === 0,
    `tris=${r.triangles} verts=${r.vertices} unpaired=${r.unpaired} degenerate=${r.degenerate} loose=${r.loose}`,
  )
}

function run(label: string, overrides: Partial<SignConfig>) {
  const cfg: SignConfig = { ...defaultConfig, ...overrides }
  const sign = buildSign({ cfg, font, svgSource: null })
  for (const part of sign.parts) {
    watertight(`${label}: ${part.name.toLowerCase()} closed`, part.mesh)
  }
  check(
    `${label}: plate sized`,
    sign.plateWidth > 5 && sign.plateHeight > 5 && sign.totalHeight > 0,
    `${sign.plateWidth.toFixed(1)} x ${sign.plateHeight.toFixed(1)} x ${sign.totalHeight.toFixed(1)} mm`,
  )
  if (sign.warnings.length) console.log(`      note: ${sign.warnings.join(' | ')}`)
  return sign
}

console.log('--- geometry ---')
const raised = run('raised rounded', {})
run('inlay pocket', { mode: 'inlay' })
run('inlay through', { mode: 'inlay', artDepth: 5, baseDepth: 2 })
run('ellipse + corner holes', { plate: 'ellipse', holes: 'top-corners', text: 'GARAGE' })
run('hexagon two lines', { plate: 'hexagon', text: 'BAY\nTWO' })
run('pill four holes', { plate: 'pill', holes: 'four-corners', text: 'LOADING DOCK' })
run('shield centre hole', { plate: 'shield', holes: 'top-center', text: 'K9', fontSize: 24 })
run('octagon inlay holes', { plate: 'octagon', mode: 'inlay', holes: 'four-corners', text: 'STOP' })
run('fixed size', { autoFit: false, width: 140, height: 45, text: 'Fixed Plate' })
run('counters and symbols', { text: 'Bogo Ø8@% #&', mode: 'inlay' })
run('repeated letters', { text: 'IIIIIIII', mode: 'inlay' })
run('lowercase descenders', { text: 'garage bay', mode: 'inlay', plate: 'ellipse' })
run('tight tracking', { text: 'HELLO', letterSpacing: -0.5, mode: 'inlay' })
run('left aligned block', { text: 'ROOM\n101\nWEST', align: 'left', mode: 'inlay' })
run('smooth curves', { text: 'OOO', curveSegments: 32, mode: 'inlay' })
run('coarse curves', { text: 'OOO', curveSegments: 2, mode: 'inlay' })

console.log('\n--- overlapping glyph contours ---')
for (const text of ['A', 'B', '8', 'GARAGE 8B', 'Overlapping Serifs']) {
  const cfg: SignConfig = { ...defaultConfig, text, mode: 'inlay', borderWidth: 2 }
  const sign = buildSign({ cfg, font: overlapping, svgSource: null })
  for (const part of sign.parts) {
    watertight(`playfair "${text}": ${part.name.toLowerCase()} closed`, part.mesh)
  }
}

console.log('\n--- new shapes ---')
run('triangle', { plate: 'triangle', text: 'YIELD', fontSize: 14 })
run('circle', { plate: 'circle', text: 'NO\nENTRY' })
run('square', { plate: 'square', text: 'A1', fontSize: 30 })
run('stop sign', { plate: 'stop', text: 'STOP', fontSize: 22 })
run('stop sign inlay + holes', { plate: 'stop', text: 'STOP', fontSize: 22, mode: 'inlay', holes: 'four-corners' })
const square = buildSign({ cfg: { ...defaultConfig, plate: 'square', autoFit: false, width: 90, height: 30 }, font, svgSource: null })
check('square locks its aspect', square.plateWidth === square.plateHeight, `${square.plateWidth} x ${square.plateHeight}`)
const circle = buildSign({ cfg: { ...defaultConfig, plate: 'circle', text: 'WIDE LABEL' }, font, svgSource: null })
check('circle locks its aspect', circle.plateWidth === circle.plateHeight, `${circle.plateWidth.toFixed(1)}`)

console.log('\n--- borders ---')
run('border raised', { borderWidth: 2 })
run('border inlay', { borderWidth: 2, mode: 'inlay' })
run('border inlay + holes', { borderWidth: 2, mode: 'inlay', holes: 'four-corners' })
run('border on circle', { plate: 'circle', borderWidth: 3, borderInset: 3, text: 'NO\nENTRY' })
run('border on stop sign', { plate: 'stop', borderWidth: 2.5, text: 'STOP', fontSize: 22, mode: 'inlay' })
run('border on triangle', { plate: 'triangle', borderWidth: 2, text: 'YIELD', fontSize: 14 })
run('border on shield', { plate: 'shield', borderWidth: 2, text: 'K9', fontSize: 24 })
run('border on ellipse + holes', { plate: 'ellipse', borderWidth: 2, holes: 'top-corners', mode: 'inlay' })
run('border flush to edge', { borderWidth: 2, borderInset: 0 })
run('thick border', { borderWidth: 8, borderInset: 1, mode: 'inlay' })

const tooWide = buildSign({
  cfg: { ...defaultConfig, autoFit: false, width: 40, height: 20, borderWidth: 30 },
  font,
  svgSource: null,
})
check('over wide border is refused', tooWide.warnings.some((w) => w.includes('too wide')))
watertight('plate survives a refused border', tooWide.parts[0].mesh)

const crossing = buildSign({
  cfg: { ...defaultConfig, autoFit: false, width: 110, height: 30, borderWidth: 4, borderInset: 1 },
  font,
  svgSource: null,
})
check('border crossing artwork is refused', crossing.warnings.some((w) => w.includes('cross the artwork')))
watertight('plate survives a crossing border', crossing.parts[0].mesh)

console.log('\n--- empty and edge cases ---')
const blank = buildSign({ cfg: { ...defaultConfig, text: '   ' }, font, svgSource: null })
check('blank text still yields a plate', blank.parts.length === 1 && blank.parts[0].mesh.indices.length > 0)
watertight('blank plate closed', blank.parts[0].mesh)
const noFont = buildSign({ cfg: { ...defaultConfig, autoFit: false }, font: null, svgSource: null })
check('missing font still yields a plate', noFont.parts.length === 1)
const tiny = buildSign(
  { cfg: { ...defaultConfig, autoFit: false, width: 12, height: 12, holes: 'four-corners' }, font, svgSource: null },
)
check('unplaceable holes are reported, not emitted', tiny.warnings.some((w) => w.includes('mounting hole')))
watertight('tiny plate closed', tiny.parts[0].mesh)

console.log('\n--- colour modes ---')
const twoTone = buildSign({ cfg: { ...defaultConfig, borderWidth: 2 }, font, svgSource: null })
check('two tone yields plate and artwork', twoTone.parts.map((p) => p.name).join(',') === 'Plate,Artwork',
  twoTone.parts.map((p) => p.name).join(','))

const perElement = buildSign({
  cfg: { ...defaultConfig, colorMode: 'per-element', borderWidth: 2 },
  font,
  svgSource: null,
})
check('per element splits text and border', perElement.parts.map((p) => p.name).join(',') === 'Plate,Text,Border',
  perElement.parts.map((p) => p.name).join(','))
for (const part of perElement.parts) watertight(`per element: ${part.name.toLowerCase()} closed`, part.mesh)
check('each part carries its own colour',
  new Set(perElement.parts.map((p) => p.color)).size === perElement.parts.length,
  perElement.parts.map((p) => p.color).join(' '))

const noBorder = buildSign({ cfg: { ...defaultConfig, colorMode: 'per-element' }, font, svgSource: null })
check('slots stay gapless without a border', noBorder.parts.map((p) => p.name).join(',') === 'Plate,Text',
  noBorder.parts.map((p) => p.name).join(','))

const perElementInlay = buildSign({
  cfg: { ...defaultConfig, colorMode: 'per-element', borderWidth: 2, mode: 'inlay' },
  font,
  svgSource: null,
})
for (const part of perElementInlay.parts) watertight(`per element inlay: ${part.name.toLowerCase()} closed`, part.mesh)

console.log('\n--- hole inset ---')

/**
 * Hole centres for a 90 x 40 rectangle, so an inset of i puts a hole at
 * x = 45 - i and y = 20 - i, before anything is pulled back inside the plate.
 */
function holesAt(mode: SignConfig['holes'], inset: number): Vector2[] {
  const outline = plateContour('rect', 90, 40, 0, 8)
  const placement = mountingHoleContours(mode, outline, 90, 40, 4, inset, [], true)
  return placement.contours.map((ring) =>
    ring.reduce((sum, p) => sum.add(p), new Vector2()).multiplyScalar(1 / ring.length),
  )
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

check('a top centre hole starts near the top edge', near(holesAt('top-center', 4)[0].y, 16))
check('the inset walks it down to the middle', near(holesAt('top-center', 20)[0].y, 0))
check(
  'and keeps going into the bottom half',
  near(holesAt('top-center', 30)[0].y, -10),
  `y = ${holesAt('top-center', 30)[0].y.toFixed(1)} mm`,
)
check(
  'every step of the inset moves it',
  (() => {
    let previous = Infinity
    for (let inset = 4; inset <= 36; inset += 2) {
      const y = holesAt('top-center', inset)[0].y
      if (y >= previous - 1e-9) return false
      previous = y
    }
    return true
  })(),
)
check('the plate edge still stops it', holesAt('top-center', 40)[0].y > -20)

/** Hole centres on a square plate of some shape, with an inset. */
function holesOn(shape: SignConfig['plate'], size: number, inset: number): Vector2[] {
  const outline = plateContour(shape, size, size, 5, 16)
  const placement = mountingHoleContours('top-corners', outline, size, size, 4, inset, [], true)
  return placement.contours.map((ring) =>
    ring.reduce((sum, p) => sum.add(p), new Vector2()).multiplyScalar(1 / ring.length),
  )
}

/**
 * The inset used to be measured off the bounding box, which lands outside every
 * plate that is not a rectangle, and a stray hole was walked back towards the
 * middle until it fit. That threw the inset away: on a stop sign, 5 mm and
 * 40 mm both parked the hole in the same spot on the outline.
 */
for (const shape of ['stop', 'circle', 'octagon', 'hexagon', 'triangle', 'shield', 'ellipse'] as const) {
  const walk = [4, 10, 20, 40].map((inset) => holesOn(shape, 254, inset)[0])
  check(
    `the inset moves a hole on a ${shape} plate`,
    walk.every((c, i) => i === 0 || c.length() < walk[i - 1].length() - 1),
    walk.map((c) => `(${c.x.toFixed(0)}, ${c.y.toFixed(0)})`).join(' '),
  )
}
check(
  'a hole sits the inset in from the outline, not the bounding box',
  (() => {
    // The top edge of a stop sign is flat and level, so a top centre hole on one
    // is exactly the inset below it.
    const outline = plateContour('stop', 254, 254, 0, 16)
    const top = Math.max(...outline.map((p) => p.y))
    const placed = mountingHoleContours('top-center', outline, 254, 254, 4, 30, [], true)
    const centre = placed.contours[0].reduce((s, p) => s.add(p), new Vector2()).multiplyScalar(1 / placed.contours[0].length)
    return near(centre.y, top - 30)
  })(),
)

const corners = holesAt('top-corners', 30)
check(
  'top corner holes travel down together',
  corners.length === 2 && near(corners[0].y, -10) && near(corners[1].y, -10),
  corners.map((c) => `(${c.x.toFixed(1)}, ${c.y.toFixed(1)})`).join(' '),
)
check(
  'and stay mirrored across the middle',
  corners.length === 2 && near(corners[0].x, -corners[1].x),
)

check(
  'a mirrored pair stops at the middle rather than swapping over',
  (() => {
    // Four corners mirror on both axes, so neither can pass the centre line.
    const wide = holesAt('four-corners', 26)
    return wide.every((c) => Math.abs(c.y) < 1e-6) && wide.every((c) => Math.abs(c.x) > 0)
  })(),
)

console.log('\n--- holes through everything ---')

/** A hole insetted far enough to land in the middle of the label. */
const CRAMPED: Partial<SignConfig> = {
  text: 'LOADING',
  autoFit: false,
  width: 90,
  height: 26,
  fontSize: 12,
  holes: 'top-center',
  holeDiameter: 5,
  holeInset: 13,
}

const refused = buildSign({ cfg: { ...defaultConfig, ...CRAMPED }, font, svgSource: null })
check('a hole with nowhere to go is still dropped by default', refused.warnings.some((w) => w.includes('nowhere safe')))
check('the message offers the way out', refused.warnings.some((w) => w.includes('cut through everything')))

const bored = run('through everything', { ...CRAMPED, holesThroughAll: true })
check('boring keeps every hole', !bored.warnings.some((w) => w.includes('nowhere safe')), bored.warnings.join(' | '))

/** How close a body comes to the hole this case puts at the origin. */
const reachOfHole = (mesh: SolidMesh): number => {
  let nearest = Infinity
  for (let i = 0; i < mesh.positions.length; i += 3) {
    nearest = Math.min(nearest, Math.hypot(mesh.positions[i], mesh.positions[i + 1]))
  }
  return nearest
}
check(
  'the label crowded the hole to begin with',
  reachOfHole(refused.parts[1].mesh) < 3.7,
  `${reachOfHole(refused.parts[1].mesh).toFixed(2)} mm from the centre, inside the 3.70 mm wall`,
)
check(
  'the bore goes through the plate at the hole radius',
  Math.abs(reachOfHole(bored.parts[0].mesh) - 2.5) < 1e-6,
  `${reachOfHole(bored.parts[0].mesh).toFixed(3)} mm`,
)
check(
  'the label is cut back to leave a wall around it',
  Math.abs(reachOfHole(bored.parts[1].mesh) - 3.7) < 0.01,
  `${reachOfHole(bored.parts[1].mesh).toFixed(3)} mm, a ${(
    reachOfHole(bored.parts[1].mesh) - 2.5
  ).toFixed(2)} mm wall`,
)

run('through everything, inlaid', { ...CRAMPED, holesThroughAll: true, mode: 'inlay' })
run('through everything, per element', { ...CRAMPED, holesThroughAll: true, colorMode: 'per-element' })
run('through a rim', {
  ...CRAMPED,
  holesThroughAll: true,
  holeInset: 2,
  borderWidth: 2.5,
  borderInset: 1,
})
run('through a rim, inlaid', {
  ...CRAMPED,
  holesThroughAll: true,
  holeInset: 2,
  borderWidth: 2.5,
  borderInset: 1,
  mode: 'inlay',
})
run('through a rounded plate', { ...CRAMPED, holesThroughAll: true, plate: 'rounded', cornerRadius: 6 })
run('through everything on a circle', {
  text: 'NO\nENTRY',
  plate: 'circle',
  autoFit: false,
  width: 60,
  height: 60,
  fontSize: 12,
  holes: 'top-center',
  holeDiameter: 5,
  holeInset: 30,
  holesThroughAll: true,
  mode: 'inlay',
})

const swallowed = run('a hole that swallows a letter', {
  text: 'I',
  autoFit: false,
  width: 24,
  height: 24,
  fontSize: 14,
  holes: 'top-center',
  holeDiameter: 10,
  holeInset: 12,
  holesThroughAll: true,
})
check('the plate survives losing its whole label', swallowed.parts[0].mesh.indices.length > 0)

const offPlate = buildSign({
  cfg: { ...defaultConfig, autoFit: false, width: 12, height: 12, holes: 'four-corners', holesThroughAll: true },
  font,
  svgSource: null,
})
check('a hole off the plate is dropped even when boring', offPlate.warnings.some((w) => w.includes('nowhere safe')))
watertight('plate survives a dropped bore', offPlate.parts[0].mesh)

console.log('\n--- text options ---')

/** Ink extent of the label alone, with the plate and everything else left out. */
function inkBox(overrides: Partial<SignConfig>): Box2 {
  const cfg: SignConfig = { ...defaultConfig, ...overrides }
  return textContours(font, cfg).reduce(
    (box, contour) => contour.reduce((b, p) => b.expandByPoint(p), box),
    new Box2().makeEmpty(),
  )
}
const inkWidth = (overrides: Partial<SignConfig>) => inkBox(overrides).getSize(new Vector2()).x
const inkHeight = (overrides: Partial<SignConfig>) => inkBox(overrides).getSize(new Vector2()).y

run('uppercase', { text: 'workshop bay', textCase: 'upper', mode: 'inlay' })
run('lowercase', { text: 'WORKSHOP BAY', textCase: 'lower', mode: 'inlay' })
run('title case', { text: 'workshop bay', textCase: 'title', mode: 'inlay' })
run('small caps', { text: 'Workshop Bay', textCase: 'small-caps', mode: 'inlay' })
run('italic', { text: 'Workshop', italic: true, mode: 'inlay' })
run('underline', { text: 'WORKSHOP', underline: true, mode: 'inlay' })
run('underlined descenders', { text: 'gypsy jazz', underline: true, mode: 'inlay' })
run('underlined italic block', { text: 'Loading\nDock', underline: true, italic: true, mode: 'inlay' })
run('stretched wide', { text: 'WORKSHOP', textStretch: 180, mode: 'inlay' })
run('squeezed narrow', { text: 'LOADING DOCK', textStretch: 60, mode: 'inlay' })
run('everything at once', {
  text: 'loading dock\nbay two',
  textCase: 'small-caps',
  italic: true,
  underline: true,
  textStretch: 115,
  borderWidth: 2,
  mode: 'inlay',
})

check(
  'uppercase draws wider than lower case',
  inkWidth({ text: 'workshop', textCase: 'upper' }) > inkWidth({ text: 'workshop', textCase: 'lower' }),
)
check(
  'title case matches the same words typed that way',
  Math.abs(inkWidth({ text: 'LOADING dock', textCase: 'title' }) - inkWidth({ text: 'Loading Dock' })) < 1e-9,
)
check(
  'a case treatment leaves the typed label alone',
  (() => {
    const cfg: SignConfig = { ...defaultConfig, text: 'workshop', textCase: 'upper' }
    textContours(font, cfg)
    return cfg.text === 'workshop'
  })(),
)
check(
  'small capitals come out shorter than full ones',
  inkHeight({ text: 'ab', textCase: 'small-caps' }) < inkHeight({ text: 'AB', textCase: 'small-caps' }),
)
check(
  'small capitals are capital shapes at 78 per cent',
  Math.abs(inkWidth({ text: 'ab', textCase: 'small-caps' }) - inkWidth({ text: 'AB' }) * 0.78) < 1e-6,
)
check(
  'a lean tips the letters twelve degrees off the baseline',
  (() => {
    // A plain stem shears by exactly its own height times the tangent, which
    // pins down both the angle and the pivot.
    const upright = inkBox({ text: 'I' }).getSize(new Vector2())
    const leaned = inkBox({ text: 'I', italic: true }).getSize(new Vector2())
    const expected = upright.y * Math.tan((12 * Math.PI) / 180)
    return Math.abs(leaned.x - upright.x - expected) < 1e-6 && Math.abs(leaned.y - upright.y) < 1e-9
  })(),
)
check('the bundled face is upright', !isItalicFace(font))
check(
  'a face that is already italic is not leaned again',
  (() => {
    // No italic file ships with the app, so the flag is borrowed for the test.
    const post = font.tables.post as { italicAngle: number }
    const upright = inkWidth({ text: 'WORKSHOP' })
    post.italicAngle = -12
    const drawn = isItalicFace(font)
    const asked = inkWidth({ text: 'WORKSHOP', italic: true })
    post.italicAngle = 0
    return drawn && Math.abs(asked - upright) < 1e-9
  })(),
)
check(
  'an underline sits below the letters',
  inkBox({ text: 'WORKSHOP', underline: true }).min.y < inkBox({ text: 'WORKSHOP' }).min.y,
)
check(
  'an underline spans the whole line',
  inkWidth({ text: 'WORKSHOP', underline: true }) >= inkWidth({ text: 'WORKSHOP' }) - 1e-9,
)
check(
  'stretching scales the block across only',
  Math.abs(inkWidth({ text: 'WORKSHOP', textStretch: 200 }) - inkWidth({ text: 'WORKSHOP' }) * 2) < 1e-6 &&
    Math.abs(inkHeight({ text: 'WORKSHOP', textStretch: 200 }) - inkHeight({ text: 'WORKSHOP' })) < 1e-9,
)
check(
  'alignment still lines up once a treatment is on',
  (() => {
    const box = inkBox({ text: 'LOADING\nBAY', align: 'left', textCase: 'small-caps', underline: true })
    return Math.abs(box.getCenter(new Vector2()).x) < 1e-6
  })(),
)

console.log('\n--- qr codes ---')

function runQr(label: string, text: string, overrides: Partial<SignConfig> = {}) {
  const cfg: SignConfig = { ...defaultConfig, qrText: text, ...overrides }
  const started = Date.now()
  const sign = buildSign({ cfg, font, svgSource: null })
  const elapsed = Date.now() - started
  for (const part of sign.parts) {
    watertight(`${label}: ${part.name.toLowerCase()} closed`, part.mesh)
  }
  const modules = qrArt(text, cfg).modules
  check(`${label}: built in reasonable time`, elapsed < 4000, `${modules} modules, ${elapsed} ms`)
  if (sign.warnings.length) console.log(`      note: ${sign.warnings.join(' | ')}`)
  return { sign, modules }
}

/**
 * Read the finished rings back onto the module grid and compare them with the
 * matrix they came from. Merging runs, growing them by the bleed, scaling into
 * millimetres and unioning the lot are all steps that could quietly corrupt the
 * pattern, and a corrupt pattern still looks like a QR code.
 */
function readsBack(text: string, cfg: SignConfig): boolean {
  const code = qrcode(0, cfg.qrEcc)
  code.addData(text)
  code.make()
  const modules = code.getModuleCount()

  const rings = repairContours(qrArt(text, cfg).contours)
  const box = rings.reduce(
    (acc, ring) => ring.reduce((b, p) => b.expandByPoint(p), acc),
    new Box2().makeEmpty(),
  )
  const size = box.getSize(new Vector2())

  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      const at = new Vector2(
        box.min.x + (size.x * (col + 0.5)) / modules,
        box.max.y - (size.y * (row + 0.5)) / modules,
      )
      // Even-odd, so a module sitting inside a counter still reads as light.
      const dark = rings.filter((ring) => pointInPolygon(at, ring)).length % 2 === 1
      if (dark !== code.isDark(row, col)) return false
    }
  }
  return true
}

for (const [label, text, ecc] of [
  ['a short code', 'HI', 'M'],
  ['a url', 'https://example.com/menu', 'M'],
  ['utf-8 text', 'caf\u00e9 \u2615 pr\u00e8s du quai', 'Q'],
  ['a dense payload', 'WIFI:T:WPA;S:Workshop Guest Network;P:correct-horse-battery-staple;;', 'H'],
] as const) {
  check(`${label} survives the geometry`, readsBack(text, { ...defaultConfig, qrEcc: ecc, svgSize: 40 }))
}

const shortCode = qrArt('HI', defaultConfig)
check('shortest text takes version 1', shortCode.modules === 21, `${shortCode.modules} modules`)
check(
  'longer text takes a larger version',
  qrArt('https://example.com/a-fairly-long-path/with/segments?and=query', defaultConfig).modules >
    shortCode.modules,
)
check(
  'heavier error correction packs denser',
  qrArt('https://example.com/hello', { ...defaultConfig, qrEcc: 'H' }).modules >=
    qrArt('https://example.com/hello', { ...defaultConfig, qrEcc: 'L' }).modules,
)
check('utf-8 text encodes', qrArt('caf\u00e9 \u2615', defaultConfig).modules >= 21)
check(
  'the code is laid out square at the requested size',
  (() => {
    const art = qrArt('https://example.com', { ...defaultConfig, svgSize: 40, svgRotation: 0 })
    const box = art.contours.reduce(
      (acc, ring) => ring.reduce((b, p) => b.expandByPoint(p), acc),
      new Box2().makeEmpty(),
    )
    const size = box.getSize(new Vector2())
    return Math.abs(size.x - 40) < 0.1 && Math.abs(size.y - 40) < 0.1
  })(),
)
let overflowed = false
try {
  qrArt('x'.repeat(5000), { ...defaultConfig, qrEcc: 'H' })
} catch {
  overflowed = true
}
check('text too long to encode is refused', overflowed)
const overflow = buildSign({
  cfg: { ...defaultConfig, qrText: 'x'.repeat(5000), qrEcc: 'H' },
  font,
  svgSource: null,
})
check('an unencodable code is reported, not thrown', overflow.warnings.some((w) => w.includes('too long')))
watertight('plate survives an unencodable code', overflow.parts[0].mesh)

runQr('qr raised', 'https://example.com', { text: 'SCAN ME', fontSize: 10, svgSize: 40, padding: 10 })
runQr('qr inlay', 'https://example.com', { text: 'SCAN ME', fontSize: 10, svgSize: 40, padding: 10, mode: 'inlay' })
runQr('qr alone', 'https://example.com', { text: '', svgSize: 40, padding: 10 })
runQr('qr rotated', 'https://example.com', { text: 'WIFI', svgSize: 40, svgRotation: 30, padding: 10 })
runQr('qr on a circle', 'https://example.com', { text: 'MENU', plate: 'circle', svgSize: 40, padding: 8 })
runQr('qr with border and holes', 'https://example.com/shop', {
  text: 'MENU',
  svgSize: 40,
  padding: 10,
  borderWidth: 2,
  holes: 'top-corners',
})
const dense = runQr('qr dense payload', 'WIFI:T:WPA;S:Workshop Guest Network;P:correct-horse-battery-staple;;', {
  text: 'GUEST WIFI',
  fontSize: 8,
  svgSize: 60,
  padding: 10,
  qrEcc: 'Q',
})
check('dense payload needs a larger matrix', dense.modules >= 33, `${dense.modules} modules`)

const perElementQr = buildSign({
  cfg: {
    ...defaultConfig,
    colorMode: 'per-element',
    qrText: 'https://example.com',
    svgSize: 40,
    padding: 10,
  },
  font,
  svgSource: null,
})
check(
  'per element names the code',
  perElementQr.parts.map((p) => p.name).join(',') === 'Plate,Text,QR code',
  perElementQr.parts.map((p) => p.name).join(','),
)

const cramped = buildSign({
  cfg: {
    ...defaultConfig,
    text: '',
    qrText: 'https://example.com',
    svgSize: 40,
    autoFit: false,
    width: 42,
    height: 42,
  },
  font,
  svgSource: null,
})
check('a missing quiet zone is reported', cramped.warnings.some((w) => w.includes('clear space')))

const tinyModules = buildSign({
  cfg: { ...defaultConfig, text: '', qrText: 'https://example.com/a/longer/target/url', svgSize: 12, padding: 10 },
  font,
  svgSource: null,
})
check('unprintable modules are reported', tinyModules.warnings.some((w) => w.includes('QR module')))

const inverted = buildSign({
  cfg: { ...defaultConfig, text: '', qrText: 'https://example.com', svgSize: 40, padding: 10 },
  font,
  svgSource: null,
})
check('a light code on a dark plate is reported', inverted.warnings.some((w) => w.includes('inverted')))

const qrPreset = PRESETS.find((preset) => preset.name === 'QR code')
check('a qr preset ships', qrPreset !== undefined)
const presetSign = buildSign({ cfg: { ...defaultConfig, ...qrPreset!.cfg }, font, svgSource: null })
for (const part of presetSign.parts) watertight(`qr preset: ${part.name.toLowerCase()} closed`, part.mesh)
check('the qr preset needs no fixing', presetSign.warnings.length === 0, presetSign.warnings.join(' | '))
check(
  'the qr preset prints at a readable grain',
  (presetSign.qr?.moduleSize ?? 0) >= 1,
  `${presetSign.qr?.modules} modules, ${presetSign.qr?.moduleSize.toFixed(2)} mm each`,
)

const withIcon = buildSign({
  cfg: { ...defaultConfig, text: '', qrText: 'https://example.com', svgSize: 40, padding: 10 },
  font,
  svgSource: '<svg viewBox="0 0 10 10"><path fill="#000" d="M0 0H10V10H0Z" /></svg>',
})
check(
  'a code takes the artwork slot from an icon',
  withIcon.parts.length === 2 && withIcon.triangles > 200,
  `${withIcon.parts.length} parts, ${withIcon.triangles} triangles`,
)

console.log('\n--- every setting has a control ---')

/**
 * A setting nobody can reach is a setting that looks like it is not saving.
 * Each one needs a control whose id matches its key, bar the two that share the
 * bed picker and the font, which is chosen from a list rather than a field.
 */
const CONTROL_EXCEPTIONS = new Set(['bedX', 'bedY', 'fontId'])
const markup = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
const ids = new Set([...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
const unreachable = (Object.keys(defaultConfig) as (keyof SignConfig)[]).filter(
  (key) => !CONTROL_EXCEPTIONS.has(key) && !ids.has(key),
)
check('every setting has a control of its own', unreachable.length === 0, unreachable.join(', '))
check('the bed picker and the font list are still there', ids.has('bed') && ids.has('fontToggle'))

console.log('\n--- 3mf package ---')
const bytes = buildThreeMF(
  raised.parts.map((part, index) => ({ name: part.name, mesh: part.mesh, extruder: index + 1 })),
  { name: 'sign', bedX: 256, bedY: 256 },
)
const sample = resolve(process.cwd(), 'node_modules/.cache/validate-output.3mf')
writeFileSync(sample, bytes)
const files = unzipSync(bytes)
const model = strFromU8(files['3D/3dmodel.model'])
const settings = strFromU8(files['Metadata/model_settings.config'])

check('four package entries', Object.keys(files).length === 4, Object.keys(files).join(', '))
check('relationship points at the model', strFromU8(files['_rels/.rels']).includes('/3D/3dmodel.model'))
check('two mesh objects', (model.match(/<mesh>/g) ?? []).length === 2)
check('assembly holds both parts', (model.match(/<component /g) ?? []).length === 2)
check('millimetre units', model.includes('unit="millimeter"'))
check('placed at bed centre', model.includes('1 0 0 0 1 0 0 0 1 128 128 0'))
check('no NaN or Infinity', !/NaN|Infinity/.test(model))
check('filament slots 1 and 2', settings.includes('value="1"') && settings.includes('value="2"'))

const objectIds = [...model.matchAll(/<object id="(\d+)"/g)].map((m) => Number(m[1]))
const refIds = [...model.matchAll(/objectid="(\d+)"/g)].map((m) => Number(m[1]))
const partIds = [...settings.matchAll(/<part id="(\d+)"/g)].map((m) => Number(m[1]))
check('object ids unique', new Set(objectIds).size === objectIds.length, objectIds.join(','))
check('every reference resolves', refIds.every((id) => objectIds.includes(id)), refIds.join(','))
check('parts map onto objects', partIds.every((id) => objectIds.includes(id)), partIds.join(','))

const vertexCount = (model.match(/<vertex /g) ?? []).length
const triangleRefs = [...model.matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)]
check('triangle indices in range', triangleRefs.every((m) => [1, 2, 3].every((i) => Number(m[i]) < vertexCount)))
check('package size sane', bytes.length > 2000 && bytes.length < 5_000_000, `${(bytes.length / 1024).toFixed(0)} KiB`)
check('object assigned to plate 1', settings.includes('<plate>') && settings.includes('"plater_id" value="1"'))
check('part names carried through', settings.includes('value="Plate"') && settings.includes('value="Artwork"'))

console.log(`\nsample package written to ${sample}`)
console.log(failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
