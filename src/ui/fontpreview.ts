/**
 * Draws each row of the font list in its own typeface.
 *
 * The whole catalogue is far too much to download, so a row only asks for a
 * face once it scrolls into view, and the request is limited to the characters
 * in the family name. Google returns a subset of a few hundred bytes for that,
 * which keeps browsing the list cheap. Previews are cosmetic, so a blocked or
 * failed request just leaves the row in the interface font.
 */
const BATCH_DELAY = 120
const BATCH_SIZE = 40

const requested = new Set<string>()
let queue: string[] = []
let timer: number | undefined

function flush(): void {
  timer = undefined
  const batch = queue.splice(0, BATCH_SIZE)
  if (batch.length === 0) return

  const characters = new Set<string>()
  for (const family of batch) {
    for (const character of family) characters.add(character)
  }
  const params = batch
    .map((family) => `family=${encodeURIComponent(family).replace(/%20/g, '+')}`)
    .join('&')
  const text = encodeURIComponent([...characters].join(''))

  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?${params}&text=${text}&display=swap`
  document.head.append(link)

  if (queue.length > 0) timer = window.setTimeout(flush, BATCH_DELAY)
}

function request(family: string): void {
  if (requested.has(family)) return
  requested.add(family)
  queue.push(family)
  timer ??= window.setTimeout(flush, BATCH_DELAY)
}

let observer: IntersectionObserver | null = null

/**
 * The list scrolls inside its own box, so that box has to be the observer root.
 * Against the viewport every row below the box counts as hidden, and nothing
 * would ever load.
 */
export function initPreviews(root: HTMLElement): void {
  if (typeof IntersectionObserver === 'undefined') return
  observer?.disconnect()
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const family = (entry.target as HTMLElement).dataset.family
        if (family) request(family)
        observer?.unobserve(entry.target)
      }
    },
    { root, rootMargin: '200px' },
  )
}

/** Show this element in its own face once it is scrolled into view. */
export function previewOnView(element: HTMLElement, family: string): void {
  element.style.fontFamily = `"${family}", system-ui, sans-serif`
  if (requested.has(family)) return
  element.dataset.family = family
  if (observer) observer.observe(element)
  else request(family)
}

export function resetPreviews(): void {
  queue = []
}
