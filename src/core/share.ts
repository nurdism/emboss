import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import { defaultConfig, type SignConfig } from './types'

export interface SignState {
  cfg: SignConfig
  svg: string | null
  svgName: string | null
}

interface Payload {
  /** Only settings that differ from the defaults, so links stay short. */
  c: Record<string, unknown>
  s?: string
  n?: string
}

/**
 * A link carries the whole design: the settings plus the SVG itself. The
 * payload is deflated and base64 encoded, which takes an SVG of a few kilobytes
 * down to a few hundred characters. It lives in the fragment, so it never
 * reaches a server.
 *
 * An uploaded font file is still left out. Those run to hundreds of kilobytes
 * and would not survive the trip.
 */
export function encodeState(state: SignState): string {
  const changed: Record<string, unknown> = {}
  for (const key of Object.keys(defaultConfig) as (keyof SignConfig)[]) {
    const value = state.cfg[key]
    if (value === defaultConfig[key]) continue
    if (typeof value === 'number' && !Number.isFinite(value)) continue
    changed[key] = value
  }

  const payload: Payload = { c: changed }
  if (state.svg) payload.s = state.svg
  if (state.svgName) payload.n = state.svgName

  const packed = deflateSync(strToU8(JSON.stringify(payload)), { level: 9 })
  return toBase64Url(packed)
}

export function decodeState(hash: string): Partial<SignState> {
  const raw = hash.replace(/^[#?]/, '')
  if (!raw) return {}
  try {
    const payload = JSON.parse(strFromU8(inflateSync(fromBase64Url(raw)))) as Payload
    return {
      cfg: { ...defaultConfig, ...coerce(payload.c ?? {}) },
      svg: payload.s ?? null,
      svgName: payload.n ?? null,
    }
  } catch {
    return {}
  }
}

/** Trust the shape of the payload no further than the defaults allow. */
function coerce(source: Record<string, unknown>): Partial<SignConfig> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(defaultConfig) as (keyof SignConfig)[]) {
    const value = source[key]
    if (value === undefined) continue
    const fallback = defaultConfig[key]
    if (typeof fallback === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
    } else if (typeof fallback === 'boolean') {
      if (typeof value === 'boolean') out[key] = value
    } else if (typeof value === 'string') {
      out[key] = value
    }
  }
  return out as Partial<SignConfig>
}

export function readStateFromUrl(): Partial<SignState> {
  return decodeState(window.location.hash)
}

/** Replace rather than push, so dragging a slider does not fill the back button. */
export function writeStateToUrl(state: SignState): number {
  const encoded = encodeState(state)
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${encoded}`)
  return encoded.length
}

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = ''
  // Chunked so a large SVG does not blow the argument limit.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
