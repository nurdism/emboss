const WIDTH_KEY = 'panel:width'
const COLLAPSED_KEY = 'panel:collapsed'
const MIN_WIDTH = 260
const MAX_WIDTH = 720

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Blocked site data only costs the remembered size.
  }
}

/**
 * Lets the panel be dragged wider or hidden entirely, and remembers both.
 * A wide panel helps when browsing fonts and icons, and hiding it gives the
 * preview the whole window.
 */
export function initPanel(options: {
  app: HTMLElement
  resizer: HTMLElement
  collapse: HTMLElement
  expand: HTMLElement
  onResize: () => void
}): void {
  const { app, resizer, collapse, expand, onResize } = options

  const setWidth = (width: number) => {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)))
    app.style.setProperty('--panel-width', `${clamped}px`)
    write(WIDTH_KEY, String(clamped))
    onResize()
  }

  const stored = Number(read(WIDTH_KEY))
  if (Number.isFinite(stored) && stored > 0) setWidth(stored)

  const setCollapsed = (collapsed: boolean) => {
    app.classList.toggle('collapsed', collapsed)
    expand.hidden = !collapsed
    write(COLLAPSED_KEY, collapsed ? '1' : '0')
    onResize()
  }
  setCollapsed(read(COLLAPSED_KEY) === '1')

  collapse.addEventListener('click', () => setCollapsed(true))
  expand.addEventListener('click', () => setCollapsed(false))

  resizer.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    resizer.setPointerCapture(event.pointerId)
    resizer.classList.add('dragging')
    document.body.classList.add('resizing')

    const move = (moveEvent: PointerEvent) => setWidth(moveEvent.clientX - app.getBoundingClientRect().left)
    const stop = () => {
      resizer.classList.remove('dragging')
      document.body.classList.remove('resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  })

  // Keyboard nudging, so the handle is not mouse only.
  resizer.addEventListener('keydown', (event) => {
    const current = app.getBoundingClientRect().width - app.querySelector('.stage')!.getBoundingClientRect().width
    const width = Number(read(WIDTH_KEY)) || Math.abs(current) || 320
    if (event.key === 'ArrowLeft') setWidth(width - 16)
    else if (event.key === 'ArrowRight') setWidth(width + 16)
    else return
    event.preventDefault()
  })
}
