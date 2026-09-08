import * as opentype from 'opentype.js'

export interface FontChoice {
  id: string
  family: string
  category: string
  weights: number[]
  /** Character set the file is cut for, for example latin or japanese. */
  subset: string
}

export interface LoadedFont {
  font: opentype.Font
  label: string
}

/** Faces shipped with the app so it still works with no network. */
export const BUNDLED_FONTS: FontChoice[] = [
  { id: 'bundled:DejaVuSans-Bold', family: 'DejaVu Sans Bold', category: 'bundled', weights: [700], subset: 'latin' },
  { id: 'bundled:DejaVuSans', family: 'DejaVu Sans', category: 'bundled', weights: [400], subset: 'latin' },
  { id: 'bundled:DejaVuSerif-Bold', family: 'DejaVu Serif Bold', category: 'bundled', weights: [700], subset: 'latin' },
  { id: 'bundled:DejaVuSansMono-Bold', family: 'DejaVu Sans Mono Bold', category: 'bundled', weights: [700], subset: 'latin' },
  { id: 'bundled:LiberationSans-Bold', family: 'Liberation Sans Bold', category: 'bundled', weights: [700], subset: 'latin' },
  { id: 'bundled:LiberationSerif-Bold', family: 'Liberation Serif Bold', category: 'bundled', weights: [700], subset: 'latin' },
]

const CATALOG_URL = 'https://api.fontsource.org/v1/fonts'

interface CatalogEntry {
  id: string
  family: string
  category: string
  weights: number[]
  styles: string[]
  subsets: string[]
  defSubset: string
  type: string
}

let catalogPromise: Promise<FontChoice[]> | null = null

/**
 * The Google Fonts catalog, fetched once and kept for the session. Fontsource
 * mirrors it with a CORS friendly index, and serves the matching TrueType files
 * from a jsDelivr path built from the same ids.
 */
export function googleFonts(): Promise<FontChoice[]> {
  catalogPromise ??= fetch(CATALOG_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`Font catalog returned ${response.status}`)
      return response.json() as Promise<CatalogEntry[]>
    })
    .then((entries) =>
      entries
        .filter((entry) => entry.type === 'google' && entry.styles.includes('normal'))
        .map((entry) => ({
          id: entry.id,
          family: entry.family,
          category: entry.category,
          weights: [...entry.weights].sort((a, b) => a - b),
          subset: entry.subsets.includes('latin') ? 'latin' : entry.defSubset,
        }))
        .sort((a, b) => a.family.localeCompare(b.family)),
    )
    .catch((error) => {
      catalogPromise = null
      throw error
    })
  return catalogPromise
}

/** Bold reads better on a sign, so prefer it when the family offers it. */
export function preferredWeight(weights: number[]): number {
  for (const wanted of [700, 600, 800, 500, 400, 900]) {
    if (weights.includes(wanted)) return wanted
  }
  return weights[0] ?? 400
}

export function fontFileUrl(choice: FontChoice, weight: number): string {
  if (choice.id.startsWith('bundled:')) {
    return `${import.meta.env.BASE_URL}fonts/${choice.id.slice('bundled:'.length)}.ttf`
  }
  return `https://cdn.jsdelivr.net/fontsource/fonts/${choice.id}@latest/${choice.subset}-${weight}-normal.ttf`
}

const cache = new Map<string, opentype.Font>()

export async function loadFont(choice: FontChoice, weight: number): Promise<opentype.Font> {
  const url = fontFileUrl(choice, weight)
  const cached = cache.get(url)
  if (cached) return cached

  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load ${choice.family} (${response.status})`)
  const font = opentype.parse(await response.arrayBuffer())
  cache.set(url, font)
  return font
}

export function parseFontFile(buffer: ArrayBuffer): opentype.Font {
  return opentype.parse(buffer)
}
