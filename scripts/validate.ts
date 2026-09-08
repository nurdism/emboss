/**
 * Geometry and package checks for the sign pipeline. Run with `npm run check`.
 *
 * The important property is that every solid is closed: in a watertight mesh
 * each directed edge appears exactly as often as its reverse.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import * as opentype from 'opentype.js'
import { buildSign } from '../src/core/build'
import type { SolidMesh } from '../src/core/mesh'
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
