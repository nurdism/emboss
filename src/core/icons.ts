/**
 * Icon search backed by the public Iconify API, which indexes well over a
 * hundred thousand open licensed icons.
 *
 * Results come back as plain SVG, so a chosen icon drops straight into the same
 * artwork path an uploaded file uses. Many icon sets draw with strokes rather
 * than filled shapes, and those extrude poorly, so the search asks for filled
 * sets first and the build warns if a stroke only drawing slips through.
 */
const API = 'https://api.iconify.design'

export interface IconHit {
  /** Full name, for example `mdi:home`. */
  name: string
  /** URL of a preview image for the picker. */
  preview: string
}

export async function searchIcons(query: string, limit = 60): Promise<IconHit[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const url = `${API}/search?query=${encodeURIComponent(trimmed)}&limit=${limit}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Icon search returned ${response.status}`)

  const data = (await response.json()) as { icons?: string[] }
  return (data.icons ?? []).map((name) => ({
    name,
    preview: `${API}/${name.replace(':', '/')}.svg?height=24&color=%23e6e9ef`,
  }))
}

interface IconData {
  body: string
  width?: number
  height?: number
}

interface IconSet {
  icons?: Record<string, IconData>
  width?: number
  height?: number
}

/**
 * Fetch one icon and wrap it into a standalone SVG.
 *
 * The rendered `.svg` endpoint sends no cross origin header, so the JSON data
 * API is used instead. It hands back the drawing commands plus the size of the
 * grid they were drawn on, which is all a viewBox needs.
 */
export async function fetchIconSvg(name: string): Promise<string> {
  const [prefix, key] = name.split(':')
  if (!prefix || !key) throw new Error(`"${name}" is not an icon name.`)

  const response = await fetch(`${API}/${prefix}.json?icons=${encodeURIComponent(key)}`)
  if (!response.ok) throw new Error(`Could not load ${name} (${response.status})`)

  const set = (await response.json()) as IconSet
  const icon = set.icons?.[key]
  if (!icon) throw new Error(`${name} was not in the response.`)

  const width = icon.width ?? set.width ?? 16
  const height = icon.height ?? set.height ?? 16
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${icon.body}</svg>`
}
