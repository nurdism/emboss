/**
 * Optional link shortening, backed by the Worker in `worker/`.
 *
 * The fragment holding a sign runs to hundreds of characters, and more once an
 * SVG is in it. Some apps trim long links, so the shortener trades that blob for
 * a short id. It is entirely optional: without VITE_SHORTENER_URL the app just
 * offers the full link.
 */
const BASE = (import.meta.env.VITE_SHORTENER_URL as string | undefined)?.replace(/\/+$/, '')

export const shorteningAvailable = (): boolean => Boolean(BASE)

/** Fragment marker for a shortened design, as in `#s=ab12cd`. */
export const SHORT_PREFIX = 's='

/** A dropped request reads as "Failed to fetch", which tells nobody anything. */
const unreachable = () =>
  new Error('Could not reach the link shortener. The full link still works.')

export async function shortenPayload(payload: string): Promise<string> {
  if (!BASE) throw new Error('Link shortening is not configured.')

  let response: Response
  try {
    response = await fetch(`${BASE}/api/shorten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload }),
    })
  } catch {
    throw unreachable()
  }

  const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string }
  if (!response.ok || !body.id) {
    throw new Error(body.error ?? `The link shortener returned ${response.status}.`)
  }
  return body.id
}

export async function expandId(id: string): Promise<string> {
  if (!BASE) throw new Error('Link shortening is not configured.')

  let response: Response
  try {
    response = await fetch(`${BASE}/api/expand/${encodeURIComponent(id)}`)
  } catch {
    throw unreachable()
  }

  const body = (await response.json().catch(() => ({}))) as { payload?: string; error?: string }
  if (!response.ok || !body.payload) {
    throw new Error(body.error ?? `The link shortener returned ${response.status}.`)
  }
  return body.payload
}
