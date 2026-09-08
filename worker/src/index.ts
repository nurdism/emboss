/**
 * Link shortener for Emboss.
 *
 * A sign travels in the page fragment, which is fine to paste but too long for
 * places that trim links. This stores that fragment under a short id so the app
 * can offer emboss.example/#s=ab12cd instead.
 *
 * Payloads are opaque to the Worker. They are the same deflated, base64 encoded
 * blob the app puts in the fragment, so nothing here needs to understand a sign.
 */

/**
 * Ten characters from a 32 letter alphabet is about 1e15 ids, drawn at random
 * rather than counted up, so one link tells you nothing about the next. The
 * letters that read alike (i, l, o, u) are left out.
 */
const ID_LENGTH = 10
const ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

/** Roughly the largest fragment worth storing, which is a generous SVG. */
const MAX_PAYLOAD_BYTES = 128 * 1024

/** Unused links expire rather than accumulating forever. */
const TTL_SECONDS = 60 * 60 * 24 * 365

interface StoredLink {
  payload: string
  created: number
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH))
  let id = ''
  for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length]
  return id
}

/** Any port on the loopback host, so local development needs no config. */
const isLocalOrigin = (origin: string): boolean =>
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') ?? ''
  const allowed = env.ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)
  const permitted = allowed.includes('*') || allowed.includes(origin) || isLocalOrigin(origin)
  return {
    'Access-Control-Allow-Origin': permitted ? origin || '*' : allowed[0] ?? '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

const json = (body: unknown, status: number, headers: Record<string, string>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  })

/** Payloads are base64url, so anything else is a bad request rather than a store. */
const isBase64Url = (value: string): boolean => /^[A-Za-z0-9_-]+$/.test(value)

async function shorten(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const length = Number(request.headers.get('Content-Length') ?? '0')
  if (length > MAX_PAYLOAD_BYTES) {
    return json({ error: 'That design is too large to shorten.' }, 413, cors)
  }

  let payload: unknown
  try {
    // Bounded by the length check above, so reading it whole is safe.
    const body = (await request.json()) as { payload?: unknown }
    payload = body.payload
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400, cors)
  }

  if (typeof payload !== 'string' || payload.length === 0 || !isBase64Url(payload)) {
    return json({ error: 'Expected a base64url payload.' }, 400, cors)
  }
  if (payload.length > MAX_PAYLOAD_BYTES) {
    return json({ error: 'That design is too large to shorten.' }, 413, cors)
  }

  // A collision is vanishingly unlikely, but silently overwriting somebody
  // else's link would be bad enough to be worth one read to rule out.
  let id = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = newId()
    if ((await env.LINKS.get(candidate)) === null) {
      id = candidate
      break
    }
  }
  if (!id) return json({ error: 'Could not allocate a link. Try again.' }, 503, cors)

  const stored: StoredLink = { payload, created: Date.now() }
  await env.LINKS.put(id, JSON.stringify(stored), { expirationTtl: TTL_SECONDS })
  return json({ id }, 201, cors)
}

async function expand(id: string, env: Env, cors: Record<string, string>): Promise<Response> {
  const raw = await env.LINKS.get(id, 'json')
  if (!raw) return json({ error: 'That link has expired or never existed.' }, 404, cors)
  const stored = raw as StoredLink
  return json({ payload: stored.payload }, 200, {
    ...cors,
    // Links never change once written, so they cache hard.
    'Cache-Control': 'public, max-age=31536000, immutable',
  })
}

export default {
  async fetch(request, env): Promise<Response> {
    const cors = corsHeaders(request, env)
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    try {
      if (request.method === 'POST' && url.pathname === '/api/shorten') {
        return await shorten(request, env, cors)
      }

      const match = /^\/api\/expand\/([0-9a-z]{4,32})$/.exec(url.pathname)
      if (request.method === 'GET' && match) {
        return await expand(match[1], env, cors)
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        return json({ ok: true }, 200, cors)
      }

      return json({ error: 'Not found.' }, 404, cors)
    } catch (error) {
      // Explicit handling, so a failure is visible in logs and to the caller.
      console.error(JSON.stringify({ message: 'shortener failed', path: url.pathname, error: String(error) }))
      return json({ error: 'Something went wrong.' }, 500, cors)
    }
  },
} satisfies ExportedHandler<Env>
