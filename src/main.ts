import './style.css'
import type * as opentype from 'opentype.js'
import { buildSign } from './core/build'
import {
  BUNDLED_FONTS,
  googleFonts,
  loadFont,
  parseFontFile,
  preferredWeight,
  type FontChoice,
} from './core/fonts'
import { fetchIconSvg, searchIcons, type IconHit } from './core/icons'
import { LOCKED_ASPECT, SMOOTH_SHAPES } from './core/plate'
import { PRESETS, type Preset } from './core/presets'
import { decodeState, readStateFromUrl, writeStateToUrl } from './core/share'
import { expandId, SHORT_PREFIX, shorteningAvailable, shortenPayload } from './core/shortlink'
import { isItalicFace } from './core/text'
import { buildThreeMF } from './core/threemf'
import { defaultConfig, type SignConfig } from './core/types'
import { initPreviews, previewOnView } from './ui/fontpreview'
import { initPanel } from './ui/panel'
import { canShareNatively, shareNatively, SHARE_TARGETS } from './ui/share-menu'
import { Viewer } from './ui/viewer'

const CUSTOM_FONT = 'custom:upload'
const FONT_CHUNK = 150

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing element #${id}`)
  return node as T
}

const restored = readStateFromUrl()
const cfg: SignConfig = restored.cfg ?? { ...defaultConfig }
const viewer = new Viewer(el('viewport'))
const messages = el('messages')
const stats = el('stats')
const downloadButton = el<HTMLButtonElement>('download')

let catalog: FontChoice[] = [...BUNDLED_FONTS]
let font: opentype.Font | null = null
let customFont: opentype.Font | null = null
let customFontName = 'Uploaded font'
let loadedFontId: string | null = null
let catalogReady = false
let svgSource: string | null = restored.svg ?? null
let svgName: string | null = restored.svgName ?? null
let iconSearchToken = 0
let busyCount = 0
let restoring = false

/** Snapshots for undo, oldest first. */
const past: string[] = []
const future: string[] = []
let lastSnapshot = ''
let snapshotTimer: number | undefined
let showDimensions = true
let pending = 0

/** Config keys driven directly by a control whose id matches the key. */
const BOUND_KEYS = [
  'text',
  'fontWeight',
  'fontSize',
  'letterSpacing',
  'lineSpacing',
  'align',
  'textCase',
  'italic',
  'underline',
  'textStretch',
  'textOffsetX',
  'textOffsetY',
  'svgSize',
  'svgPlacement',
  'svgGap',
  'svgOffsetX',
  'svgOffsetY',
  'svgRotation',
  'qrText',
  'qrEcc',
  'plate',
  'autoFit',
  'padding',
  'width',
  'height',
  'cornerRadius',
  'borderWidth',
  'borderInset',
  'baseDepth',
  'artDepth',
  'mode',
  'holes',
  'holeDiameter',
  'holeInset',
  'holesThroughAll',
  'colorMode',
  'baseColor',
  'artColor',
  'textColor',
  'iconColor',
  'borderColor',
  'curveSegments',
  'name',
] as const satisfies readonly (keyof SignConfig)[]

type BoundKey = (typeof BOUND_KEYS)[number]

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

function readInput(input: Control, key: BoundKey): string | number | boolean {
  if (input instanceof HTMLInputElement && input.type === 'checkbox') return input.checked
  if (input instanceof HTMLInputElement && (input.type === 'number' || input.type === 'range')) {
    const value = Number(input.value)
    return Number.isFinite(value) ? value : (defaultConfig[key] as number)
  }
  return input.value
}

function writeInput(input: Control, value: unknown): void {
  if (input instanceof HTMLInputElement && input.type === 'checkbox') {
    input.checked = Boolean(value)
    return
  }
  input.value = String(value)
}

/** Slider travel for each numeric setting: min, max, step. */
const RANGES: Partial<Record<BoundKey, [number, number, number]>> = {
  fontSize: [1, 120, 0.5],
  letterSpacing: [-5, 20, 0.1],
  lineSpacing: [0.5, 3, 0.05],
  textStretch: [50, 200, 1],
  textOffsetX: [-100, 100, 0.5],
  textOffsetY: [-100, 100, 0.5],
  svgSize: [1, 200, 1],
  svgGap: [0, 40, 0.5],
  svgOffsetX: [-100, 100, 0.5],
  svgOffsetY: [-100, 100, 0.5],
  svgRotation: [-180, 180, 5],
  padding: [0, 40, 0.5],
  width: [5, 350, 1],
  height: [5, 350, 1],
  cornerRadius: [0, 50, 0.5],
  borderWidth: [0, 15, 0.2],
  borderInset: [0, 20, 0.2],
  baseDepth: [0.2, 20, 0.2],
  artDepth: [0.1, 10, 0.1],
  holeDiameter: [0.5, 20, 0.5],
  holeInset: [0, 40, 0.5],
  curveSegments: [2, 48, 1],
}

const sliders = new Map<BoundKey, HTMLInputElement>()

/**
 * Put a slider next to each number box and keep the two in step. The slider is
 * for feel, the box is for an exact figure, and both write the same setting.
 */
function attachSlider(key: BoundKey, input: HTMLInputElement): HTMLInputElement | null {
  const range = RANGES[key]
  if (!range) return null
  const [min, max, step] = range

  input.min = String(min)
  input.max = String(max)
  input.step = String(step)

  const slider = document.createElement('input')
  slider.type = 'range'
  slider.min = String(min)
  slider.max = String(max)
  slider.step = String(step)
  slider.value = String(cfg[key])
  slider.tabIndex = -1
  slider.setAttribute('aria-label', `${key} slider`)

  const row = document.createElement('div')
  row.className = 'dual'
  input.replaceWith(row)
  row.append(slider, input)

  sliders.set(key, slider)
  return slider
}

const SHAPE_NAMES: Record<string, string> = {
  rect: 'Rectangle',
  rounded: 'Rounded rect',
  square: 'Square',
  circle: 'Circle',
  ellipse: 'Ellipse',
  pill: 'Pill',
  triangle: 'Triangle',
  hexagon: 'Hexagon',
  octagon: 'Octagon',
  stop: 'Stop sign',
  shield: 'Shield',
}

const CASE_NAMES: Record<string, string> = {
  upper: 'UPPERCASE',
  lower: 'lowercase',
  title: 'Title Case',
  'small-caps': 'Small Caps',
}

const HOLE_NAMES: Record<string, string> = {
  none: 'None',
  'top-center': 'Top centre',
  'top-corners': 'Top corners',
  'four-corners': 'Four corners',
}

/** A one line digest on each collapsed group, so state is readable while shut. */
function refreshSummaries(sign: { plateWidth: number; plateHeight: number }): void {
  const set = (pane: string, value: string) => {
    el(`sum-${pane}`).textContent = value
  }
  const family = currentChoice()?.family ?? 'No font'
  const treatments = [
    CASE_NAMES[cfg.textCase] ?? '',
    cfg.italic ? 'italic' : '',
    cfg.underline ? 'underlined' : '',
    cfg.textStretch === 100 ? '' : `${cfg.textStretch}% wide`,
  ].filter(Boolean)
  set('text', [`${family} · ${cfg.fontSize} mm`, ...treatments].join(' · '))
  set('artwork', artworkName() ?? 'None')
  set(
    'plate',
    `${SHAPE_NAMES[cfg.plate] ?? cfg.plate} · ${sign.plateWidth.toFixed(0)} x ${sign.plateHeight.toFixed(0)} mm`,
  )
  set('border', cfg.borderWidth > 0 ? `${cfg.borderWidth.toFixed(1)} mm` : 'Off')
  set(
    'depth',
    `${cfg.mode === 'raised' ? 'Raised' : 'Inlaid'} · ${cfg.baseDepth} + ${cfg.artDepth} mm`,
  )
  set(
    'mounting-holes',
    `${HOLE_NAMES[cfg.holes] ?? cfg.holes}${
      cfg.holes !== 'none' && cfg.holesThroughAll ? ' · through everything' : ''
    }`,
  )
  set(
    'colours',
    cfg.colorMode === 'per-element' ? 'A colour per element' : 'Two tone',
  )
  set('view', showDimensions ? 'Dimensions on' : 'Dimensions off')
  set('export', `${cfg.name || 'sign'}.3mf · ${cfg.bedX} mm bed`)
  set('source', 'github.com/nurdism/emboss')
}

/**
 * Italics come from the family's own drawn cut where there is one. Everything
 * else is leaned by hand, which is worth saying rather than leaving the user to
 * wonder why a serif looks off.
 */
function refreshItalicHint(): void {
  const hint = el('italicHint')
  const faux = cfg.italic && font !== null && !isItalicFace(font)
  hint.hidden = !faux
  if (faux) {
    hint.textContent =
      'This face has no italic of its own, so the outlines are leaned instead. Pick a family that ships one for a drawn italic.'
  }
}

function refreshSliders(): void {
  for (const [key, slider] of sliders) {
    const value = String(cfg[key])
    if (slider.value !== value) slider.value = value
  }
}

/** Two tone shows one artwork colour, per element shows one for each body. */
function refreshColorFields(parts: { name: string }[]): void {
  const perElement = cfg.colorMode === 'per-element'
  el('artColorField').hidden = perElement
  el('textColorField').hidden = !perElement
  el('iconColorField').hidden = !perElement
  el('iconColorName').textContent = hasQr() ? 'QR code' : 'Icon'
  el('borderColorField').hidden = !perElement
  el('slotHint').textContent = parts
    .map((part, index) => `${index + 1} ${part.name.toLowerCase()}`)
    .join(', ')
    .concat('. The 3MF pins each body to that filament slot.')
}

/** Circles, squares and stop signs are always as tall as they are wide. */
function refreshAspectLock(): void {
  const locked = LOCKED_ASPECT.has(cfg.plate)
  el('heightField').hidden = locked
  // A corner radius means nothing on a shape that is already all curves.
  const smooth = SMOOTH_SHAPES.has(cfg.plate)
  setEnabled('cornerRadius', !smooth)
  el('cornerRadius').title = smooth ? 'This shape has no corners to round.' : ''
  setEnabled('height', !cfg.autoFit)
  setEnabled('width', !cfg.autoFit)
  el('widthLabel').textContent = locked ? 'Size mm' : 'Width mm'
}

function setEnabled(key: BoundKey, enabled: boolean): void {
  el<HTMLInputElement>(key).disabled = !enabled
  const slider = sliders.get(key)
  if (slider) slider.disabled = !enabled
}

function bindControls(): void {
  for (const key of BOUND_KEYS) {
    const input = el<HTMLInputElement>(key)
    writeInput(input, cfg[key])
    const slider = attachSlider(key, input)

    const commit = (source: Control) => {
      ;(cfg as unknown as Record<string, unknown>)[key] = readInput(source, key)
      if (slider && source !== slider) slider.value = String(cfg[key])
      if (slider && source === slider) input.value = String(cfg[key])
      recordStep()
      if (key === 'fontWeight' || key === 'italic') void applyFont()
      else scheduleRebuild()
    }
    input.addEventListener('input', () => commit(input))
    input.addEventListener('change', () => commit(input))
    slider?.addEventListener('input', () => commit(slider))
  }

  const bed = el<HTMLSelectElement>('bed')
  bed.value = `${cfg.bedX}x${cfg.bedY}`
  bed.addEventListener('change', () => {
    const [x, y] = bed.value.split('x').map(Number)
    cfg.bedX = x
    cfg.bedY = y
    viewer.setBed(x, y)
    recordStep()
    scheduleRebuild()
  })

  el('fontFile').addEventListener('change', (event) => {
    void loadCustomFont(event.target as HTMLInputElement)
  })
  el('svgFile').addEventListener('change', (event) => {
    void loadSvg(event.target as HTMLInputElement)
  })
  el('svgClear').addEventListener('click', () => {
    svgSource = null
    svgName = null
    clearQr()
    el<HTMLInputElement>('svgFile').value = ''
    for (const button of el('iconResults').querySelectorAll('button')) {
      button.setAttribute('aria-pressed', 'false')
    }
    recordStep()
    scheduleRebuild()
  })
  el('fontSearch').addEventListener('input', renderFontList)
  el('fontToggle').addEventListener('click', () => setFontPanel(el('fontPanel').hidden))
  el('iconSearch').addEventListener('input', () => {
    void runIconSearch(el<HTMLInputElement>('iconSearch').value)
  })
  el('iconIdAdd').addEventListener('click', () => void addIconById())
  el('iconId').addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') void addIconById()
  })
  el('copyLink').addEventListener('click', copyLink)
  el('shareToggle').addEventListener('click', () => setShareMenu(el('shareMenu').hidden))
  document.addEventListener('click', (event) => {
    const inside = (event.target as Element | null)?.closest('#shareMenu, #shareToggle')
    if (!inside) setShareMenu(false)
  })
  downloadButton.addEventListener('click', exportSign)

  el('undo').addEventListener('click', undo)
  el('redo').addEventListener('click', redo)
  el('reset').addEventListener('click', () => void applyPreset(PRESETS[0]))
  el('viewFit').addEventListener('click', () => viewer.frame())
  el('viewTop').addEventListener('click', () => viewer.setView('top'))
  el('viewIso').addEventListener('click', () => viewer.setView('iso'))

  const dims = el<HTMLButtonElement>('viewDims')
  dims.addEventListener('click', () => {
    showDimensions = !showDimensions
    dims.setAttribute('aria-pressed', String(showDimensions))
    scheduleRebuild()
  })

  window.addEventListener('keydown', (event) => {
    const typing =
      event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
    // Leave the browser's own undo alone while a text field has focus.
    if (typing && event.target instanceof HTMLTextAreaElement) return
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
  })
}

// --- fonts -----------------------------------------------------------------

const currentChoice = (): FontChoice | undefined =>
  catalog.find((choice) => choice.id === cfg.fontId)

/** The list is long, so it stays shut until asked for. */
function setFontPanel(open: boolean): void {
  el('fontPanel').hidden = !open
  el('fontToggle').setAttribute('aria-expanded', String(open))
  if (!open) return
  // Rows measured while hidden never load their preview, so redraw on opening.
  renderFontList()
  el<HTMLInputElement>('fontSearch').focus()
}

function refreshChosenFont(): void {
  const choice = currentChoice()
  const label = el('fontCurrent')
  label.textContent = choice?.family ?? cfg.fontId
  label.style.fontFamily = choice && choice.category !== 'bundled' && choice.category !== 'uploaded'
    ? `"${choice.family}", system-ui, sans-serif`
    : ''
  if (choice && choice.category !== 'bundled' && choice.category !== 'uploaded') {
    previewOnView(label, choice.family)
  }
}

let fontMatches: FontChoice[] = []
let fontShown = 0

/**
 * The catalogue runs to nearly two thousand families, so rows are added a chunk
 * at a time as the list is scrolled rather than all at once. Rendering the lot
 * on every keystroke made searching crawl, and capping it hid everything past
 * the letter C.
 */
function renderFontList(): void {
  const query = el<HTMLInputElement>('fontSearch').value.trim().toLowerCase()
  fontMatches = query
    ? catalog.filter((choice) => choice.family.toLowerCase().includes(query))
    : catalog

  // Keep the chosen face in view while browsing, but never let it sit at the
  // top of a search it does not match.
  const selected = currentChoice()
  if (!query && selected && !fontMatches.includes(selected)) {
    fontMatches = [selected, ...fontMatches]
  }

  el<HTMLUListElement>('fontList').replaceChildren()
  fontShown = 0
  appendFontRows()

  const total = catalog.length
  el('fontCount').textContent =
    query && fontMatches.length !== total ? `${fontMatches.length} of ${total}` : `${total} fonts`
  refreshChosenFont()
}

function appendFontRows(): void {
  const list = el<HTMLUListElement>('fontList')
  if (fontShown === 0 && fontMatches.length === 0) {
    const empty = document.createElement('p')
    empty.textContent = 'No font matches that search.'
    list.replaceChildren(empty)
    return
  }

  const next = fontMatches.slice(fontShown, fontShown + FONT_CHUNK)
  list.append(
    ...next.map((choice) => {
      const item = document.createElement('li')
      item.setAttribute('role', 'option')
      item.setAttribute('aria-selected', String(choice.id === cfg.fontId))
      const name = document.createElement('span')
      name.textContent = choice.family
      name.dataset.preview =
        choice.category === 'bundled' || choice.category === 'uploaded' ? '' : choice.family
      const tag = document.createElement('em')
      tag.textContent = choice.category
      item.append(name, tag)
      item.addEventListener('click', () => selectFont(choice))
      return item
    }),
  )
  fontShown += next.length

  // Previews are wired up only once the rows are in the document, so the
  // observer that drives them has something real to measure.
  for (const name of list.querySelectorAll<HTMLElement>('span[data-preview]')) {
    const family = name.dataset.preview
    if (family) previewOnView(name, family)
  }
}

/** Pull in the next chunk once the list is scrolled close to its end. */
function bindFontScroll(): void {
  const picker = document.querySelector<HTMLElement>('.picker')
  if (!picker) return
  picker.addEventListener('scroll', () => {
    if (fontShown >= fontMatches.length) return
    if (picker.scrollTop + picker.clientHeight >= picker.scrollHeight - 240) appendFontRows()
  })
}

function renderWeights(): void {
  const select = el<HTMLSelectElement>('fontWeight')
  const weights = currentChoice()?.weights ?? [cfg.fontWeight]
  select.replaceChildren(
    ...weights.map((weight) => {
      const option = document.createElement('option')
      option.value = String(weight)
      option.textContent = String(weight)
      return option
    }),
  )
  if (!weights.includes(cfg.fontWeight)) cfg.fontWeight = preferredWeight(weights)
  select.value = String(cfg.fontWeight)
  select.disabled = cfg.fontId === CUSTOM_FONT || weights.length < 2
}

function selectFont(choice: FontChoice): void {
  cfg.fontId = choice.id
  if (!choice.weights.includes(cfg.fontWeight)) cfg.fontWeight = preferredWeight(choice.weights)
  renderFontList()
  renderWeights()
  setFontPanel(false)
  void applyFont()
}

async function applyFont(): Promise<void> {
  if (cfg.fontId === CUSTOM_FONT) {
    font = customFont
    loadedFontId = CUSTOM_FONT
    scheduleRebuild()
    return
  }
  const choice = currentChoice()
  if (!choice) {
    // A shared link can name a Google font before the catalog has arrived.
    // Loading it is deferred until the catalog lands rather than failing here.
    if (catalogReady) report(new Error(`Font "${cfg.fontId}" is not in the catalog.`))
    scheduleRebuild()
    return
  }
  try {
    font = await withBusy(`Loading ${choice.family}`, loadFont(choice, cfg.fontWeight, cfg.italic))
    loadedFontId = choice.id
  } catch (error) {
    font = null
    report(error, `Could not load ${choice.family}.`)
  }
  scheduleRebuild()
}

async function loadCatalog(): Promise<void> {
  try {
    const google = await withBusy('Loading font catalogue', googleFonts())
    catalog = [...BUNDLED_FONTS, ...google]
  } catch {
    note('Google Fonts could not be reached, so only the bundled faces are listed.')
  }
  catalogReady = true
  renderFontList()
  renderWeights()
  if (loadedFontId !== cfg.fontId) await applyFont()
}

async function loadCustomFont(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0]
  if (!file) return
  try {
    customFont = parseFontFile(await file.arrayBuffer())
    loadedFontId = CUSTOM_FONT
    customFontName = file.name
    cfg.fontId = CUSTOM_FONT
    catalog = catalog.filter((choice) => choice.id !== CUSTOM_FONT)
    catalog.unshift({
      id: CUSTOM_FONT,
      family: customFontName,
      category: 'uploaded',
      weights: [cfg.fontWeight],
      subset: 'latin',
      // Whatever the file is, it is the only cut of it there is.
      italic: false,
    })
    renderFontList()
    renderWeights()
    font = customFont
    scheduleRebuild()
  } catch (error) {
    report(error, 'Could not read that font file.')
  }
}

async function loadSvg(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0]
  if (!file) return
  svgSource = await file.text()
  svgName = file.name
  clearQr()
  el('svgName').textContent = file.name
  recordStep()
  scheduleRebuild()
}

/** A code in the box takes the artwork slot, whatever else is loaded. */
const hasQr = (): boolean => cfg.qrText.trim().length > 0

/** Choosing an icon or a file is a decision to stop showing a code. */
function clearQr(): void {
  if (!cfg.qrText) return
  cfg.qrText = ''
  el<HTMLInputElement>('qrText').value = ''
}

/** What the panel calls the artwork currently on the sign. */
const artworkName = (): string | null => (hasQr() ? 'QR code' : svgName)

// --- icons -----------------------------------------------------------------

let iconTimer: number | undefined

function runIconSearch(query: string): void {
  window.clearTimeout(iconTimer)
  const token = ++iconSearchToken
  iconTimer = window.setTimeout(async () => {
    const results = el('iconResults')
    if (query.trim().length < 2) {
      results.replaceChildren()
      el('iconCount').textContent = ''
      return
    }
    try {
      const hits = await withBusy('Searching icons', searchIcons(query))
      // A slower earlier search must not overwrite a newer one.
      if (token !== iconSearchToken) return
      renderIcons(hits)
    } catch (error) {
      if (token !== iconSearchToken) return
      report(error, 'Icon search is unavailable.')
    }
  }, 250)
}

function renderIcons(hits: IconHit[]): void {
  const results = el('iconResults')
  el('iconCount').textContent = hits.length > 0 ? `${hits.length} found` : ''
  if (hits.length === 0) {
    const empty = document.createElement('p')
    empty.textContent = 'No icon matches that search.'
    results.replaceChildren(empty)
    return
  }
  results.replaceChildren(
    ...hits.map((hit) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.title = hit.name
      button.setAttribute('aria-pressed', String(svgName === hit.name))
      const image = document.createElement('img')
      image.src = hit.preview
      image.alt = hit.name
      image.loading = 'lazy'
      button.append(image)
      button.addEventListener('click', () => void chooseIcon(hit))
      return button
    }),
  )
}

/**
 * Take an icon straight from its Iconify id, so anything found in the icon set
 * browser can be pasted in even when the search does not surface it.
 */
async function addIconById(): Promise<void> {
  const field = el<HTMLInputElement>('iconId')
  const raw = field.value.trim().replace(/^["'\s]+|["'\s]+$/g, '')
  if (!raw) return
  // The browser writes ids either as mdi:home or mdi-home.
  const name = raw.includes(':') ? raw : raw.replace('-', ':')
  try {
    svgSource = await withBusy(`Loading ${name}`, fetchIconSvg(name))
    svgName = name
    clearQr()
    field.value = ''
    el<HTMLInputElement>('svgFile').value = ''
    recordStep()
    scheduleRebuild()
  } catch (error) {
    report(error, `Could not load "${raw}". Check the id in the Iconify browser.`)
  }
}

async function chooseIcon(hit: IconHit): Promise<void> {
  try {
    svgSource = await withBusy('Loading icon', fetchIconSvg(hit.name))
    svgName = hit.name
    clearQr()
    el<HTMLInputElement>('svgFile').value = ''
    for (const button of el('iconResults').querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.title === hit.name))
    }
    recordStep()
    scheduleRebuild()
  } catch (error) {
    report(error, `Could not load ${hit.name}.`)
  }
}

// --- busy, history, presets ------------------------------------------------

/** Show a quiet marker while a font or an icon search is in flight. */
async function withBusy<T>(label: string, work: Promise<T>): Promise<T> {
  busyCount++
  const marker = el('busy')
  marker.textContent = label
  marker.hidden = false
  try {
    return await work
  } finally {
    busyCount--
    if (busyCount === 0) marker.hidden = true
  }
}

const stateJson = (): string => JSON.stringify({ cfg, svgSource, svgName })

/**
 * Record a step for undo. Rapid changes such as dragging a slider are collapsed
 * into one entry, so a single undo takes back a whole gesture rather than one
 * pixel of it.
 */
function recordStep(): void {
  if (restoring) return
  window.clearTimeout(snapshotTimer)
  snapshotTimer = window.setTimeout(() => {
    const next = stateJson()
    if (next === lastSnapshot) return
    if (lastSnapshot) {
      past.push(lastSnapshot)
      if (past.length > 60) past.shift()
      future.length = 0
    }
    lastSnapshot = next
    refreshHistoryButtons()
  }, 400)
}

function refreshHistoryButtons(): void {
  el<HTMLButtonElement>('undo').disabled = past.length === 0
  el<HTMLButtonElement>('redo').disabled = future.length === 0
}

function applyState(json: string): void {
  const parsed = JSON.parse(json) as { cfg: SignConfig; svgSource: string | null; svgName: string | null }
  restoring = true
  Object.assign(cfg, parsed.cfg)
  svgSource = parsed.svgSource
  svgName = parsed.svgName
  lastSnapshot = json
  syncControls()
  void applyFont()
  restoring = false
  refreshHistoryButtons()
  scheduleRebuild()
}

function undo(): void {
  const previous = past.pop()
  if (!previous) return
  future.push(stateJson())
  applyState(previous)
}

function redo(): void {
  const next = future.pop()
  if (!next) return
  past.push(stateJson())
  applyState(next)
}

/** Push every setting back into its control, after an undo or a preset. */
function syncControls(): void {
  for (const key of BOUND_KEYS) {
    const input = el<HTMLInputElement>(key)
    writeInput(input, cfg[key])
    const slider = sliders.get(key)
    if (slider) slider.value = String(cfg[key])
  }
  el<HTMLSelectElement>('bed').value = `${cfg.bedX}x${cfg.bedY}`
  // The grid is part of the design as much as any control is, and every restore
  // path comes through here: a short link, an undo, a preset.
  viewer.setBed(cfg.bedX, cfg.bedY)
  renderFontList()
  renderWeights()
}

function buildPresets(): void {
  el('presets').replaceChildren(
    ...PRESETS.map((preset) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = preset.name
      button.addEventListener('click', () => void applyPreset(preset))
      return button
    }),
  )
}

async function applyPreset(preset: Preset): Promise<void> {
  Object.assign(cfg, preset.cfg)
  // A preset that declares its artwork speaks for the code as well as the icon.
  if (preset.icon !== undefined && preset.cfg.qrText === undefined) cfg.qrText = ''
  if (preset.icon === null) {
    svgSource = null
    svgName = null
  } else if (preset.icon) {
    try {
      svgSource = await withBusy('Loading icon', fetchIconSvg(preset.icon))
      svgName = preset.icon
    } catch {
      svgSource = null
      svgName = null
    }
  }
  el<HTMLInputElement>('svgFile').value = ''
  syncControls()
  recordStep()
  scheduleRebuild()
}

/** Remember which groups the user left open. */
function bindPanes(): void {
  for (const pane of document.querySelectorAll<HTMLDetailsElement>('details.pane')) {
    const key = `pane:${pane.dataset.pane}`
    const stored = readStored(key)
    if (stored !== null) pane.open = stored === '1'
    pane.addEventListener('toggle', () => writeStored(key, pane.open ? '1' : '0'))
  }
}

const readStored = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const writeStored = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private windows and blocked site data are fine, the choice just is not kept.
  }
}

// --- output ----------------------------------------------------------------

/**
 * Errors live in their own slot rather than alongside the build warnings, which
 * are replaced wholesale on every redraw. Reporting into that slot meant a
 * failure could vanish before it was read.
 */
function report(error: unknown, fallback = 'Something went wrong.'): void {
  const alert = document.createElement('div')
  alert.className = 'alert error'
  const text = document.createElement('p')
  text.textContent = error instanceof Error ? error.message : fallback
  alert.append(text, dismissButton(alert))
  el('alerts').replaceChildren(alert)
}

function dismissButton(alert: HTMLElement): HTMLButtonElement {
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = 'Dismiss'
  close.addEventListener('click', () => alert.remove())
  return close
}

/**
 * Copying after an await is unreliable. Chrome allows it, but Firefox and
 * Safari treat the user gesture as spent by the time a network round trip has
 * finished, and reject the write. So the async API is tried first, then the old
 * synchronous command, and if neither lands the caller shows the text instead.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Falls through to the command below.
  }
  try {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0'
    document.body.append(field)
    field.select()
    const copied = document.execCommand('copy')
    field.remove()
    return copied
  } catch {
    return false
  }
}

/** Always put the link somewhere it can be grabbed, copied or not. */
function showLink(url: string, copied: boolean): void {
  const alert = document.createElement('div')
  alert.className = 'alert'
  const text = document.createElement('p')
  text.textContent = copied ? 'Short link copied' : 'Short link ready, copy it here'
  const field = document.createElement('input')
  field.type = 'text'
  field.readOnly = true
  field.value = url
  field.addEventListener('focus', () => field.select())
  alert.append(text, field, dismissButton(alert))
  el('alerts').replaceChildren(alert)
  if (!copied) {
    field.focus()
    field.select()
  }
}

function note(text: string): void {
  const node = document.createElement('p')
  node.textContent = text
  messages.append(node)
}

/** A short line describing the sign, used as the text on a share. */
/** A `#s=` fragment names a stored design rather than holding one. */
async function resolveShortLink(): Promise<void> {
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash.startsWith(SHORT_PREFIX)) return
  try {
    const payload = await withBusy('Loading shared sign', expandId(hash.slice(SHORT_PREFIX.length)))
    const state = decodeState(payload)
    if (!state.cfg) throw new Error('That link did not contain a sign.')
    Object.assign(cfg, state.cfg)
    svgSource = state.svg ?? null
    svgName = state.svgName ?? null
    syncControls()
    void applyFont()
    scheduleRebuild()
  } catch (error) {
    report(error, 'Could not open that short link.')
  }
}

function shareText(): string {
  const label = cfg.text.replace(/\s+/g, ' ').trim()
  return label ? `"${label}" sign, made with Emboss` : 'A sign made with Emboss'
}

function buildShareMenu(): void {
  const menu = el('shareMenu')
  const items: HTMLElement[] = []

  if (shorteningAvailable()) {
    const short = document.createElement('button')
    short.type = 'button'
    short.textContent = 'Copy short link'
    short.addEventListener('click', () => void copyShortLink())
    items.push(short)
  }

  if (canShareNatively()) {
    const native = document.createElement('button')
    native.type = 'button'
    native.textContent = 'Share…'
    native.addEventListener('click', () => {
      void shareNatively(window.location.href, 'Emboss', shareText())
      setShareMenu(false)
    })
    items.push(native)
  }

  for (const target of SHARE_TARGETS) {
    const link = document.createElement('a')
    link.textContent = target.name
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    // The link is rebuilt on open, because the design changes as you work.
    link.dataset.target = target.name
    items.push(link)
  }
  menu.replaceChildren(...items)
}

function setShareMenu(open: boolean): void {
  const menu = el('shareMenu')
  menu.hidden = !open
  el('shareToggle').setAttribute('aria-expanded', String(open))
  if (!open) return
  const url = window.location.href
  const text = shareText()
  for (const link of menu.querySelectorAll<HTMLAnchorElement>('a[data-target]')) {
    const target = SHARE_TARGETS.find((t) => t.name === link.dataset.target)
    if (target) link.href = target.href(url, text)
  }
}

/**
 * Swap the long fragment for a short id held by the shortener Worker. The full
 * link keeps working either way, so a failure here is not fatal.
 */
async function copyShortLink(): Promise<void> {
  setShareMenu(false)
  try {
    const payload = window.location.hash.replace(/^#/, '')
    const id = await withBusy('Shortening link', shortenPayload(payload))
    const url = `${window.location.origin}${window.location.pathname}#${SHORT_PREFIX}${id}`
    showLink(url, await copyToClipboard(url))
  } catch (error) {
    report(error, 'Could not shorten that link. The full link still works.')
  }
}

async function copyLink(): Promise<void> {
  const button = el<HTMLButtonElement>('copyLink')
  try {
    await navigator.clipboard.writeText(window.location.href)
    button.textContent = 'Link copied'
  } catch {
    button.textContent = 'Copy failed, select the address bar'
  }
  setTimeout(() => {
    button.textContent = 'Copy link to this sign'
  }, 2000)
}

function scheduleRebuild(): void {
  if (pending) return
  pending = requestAnimationFrame(() => {
    pending = 0
    rebuild()
  })
}

function rebuild(): void {
  el('modeHint').textContent =
    cfg.mode === 'raised'
      ? 'Artwork and border sit on top of the plate. Total height is plate plus art.'
      : 'Artwork and border fill a pocket cut into the plate top, flush with the surface.'

  refreshSliders()
  refreshAspectLock()
  el('svgName').textContent = artworkName() ?? 'No artwork loaded'
  const linkLength = writeStateToUrl({ cfg, svg: svgSource, svgName })

  try {
    const sign = buildSign({ cfg, font, svgSource })
    viewer.setGeometry(sign.parts)
    viewer.setDimensions(
      showDimensions
        ? { width: sign.plateWidth, height: sign.plateHeight, depth: sign.totalHeight }
        : null,
    )
    refreshColorFields(sign.parts)
    refreshSummaries(sign)
    refreshItalicHint()
    el('qrCount').textContent = sign.qr
      ? `${sign.qr.modules} modules, ${sign.qr.moduleSize.toFixed(2)} mm each`
      : ''
    stats.textContent = `${sign.plateWidth.toFixed(1)} x ${sign.plateHeight.toFixed(
      1,
    )} x ${sign.totalHeight.toFixed(1)} mm  ·  ${sign.triangles.toLocaleString()} triangles`
    messages.replaceChildren(
      ...sign.warnings.map((text) => {
        const node = document.createElement('p')
        node.textContent = text
        return node
      }),
    )
    if (linkLength > 30_000) {
      note('This SVG makes for a very long link. Some apps may cut it short when you share it.')
    }
    downloadButton.disabled = false
  } catch (error) {
    downloadButton.disabled = true
    report(error, 'Could not build the sign.')
  }
}

function exportSign(): void {
  try {
    const sign = buildSign({ cfg, font, svgSource })
    // Slots run in part order, so a sign with no icon does not leave a gap.
    const parts = sign.parts.map((part, index) => ({
      name: part.name,
      mesh: part.mesh,
      extruder: index + 1,
    }))

    const name = cfg.name.trim() || 'sign'
    const zipped = buildThreeMF(parts, { name, bedX: cfg.bedX, bedY: cfg.bedY })
    const url = URL.createObjectURL(
      new Blob([zipped as unknown as BlobPart], { type: 'model/3mf' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `${name}.3mf`
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    report(error, 'Export failed.')
  }
}

initPanel({
  app: el('app'),
  resizer: el('resizer'),
  collapse: el('collapse'),
  expand: el('expand'),
  onResize: () => viewer.resize(),
})
initPreviews(document.querySelector<HTMLElement>('.picker')!)
bindFontScroll()
buildPresets()
buildShareMenu()
bindPanes()
bindControls()
void resolveShortLink()
renderFontList()
renderWeights()
refreshHistoryButtons()
lastSnapshot = stateJson()
viewer.setBed(cfg.bedX, cfg.bedY)
void applyFont()
void loadCatalog()
