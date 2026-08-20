import { decodePatch } from '../state/patchCode'
import { MAX_SHORT_CODE_LENGTH, normaliseShortCode, shortCodeFor } from '../state/shortCode'
import { handleGallery, type GalleryRequest } from './galleryRoutes'
import { d1Gallery, type D1Like } from './galleryStore'

/**
 * The sharing service: it trades a patch code for a short one and back.
 *
 * Deliberately the least it can be. It holds no format of its own — the value under a key is the
 * same string the app already lets you copy — so if this service ever goes away, nothing exists
 * only inside it and every short code can be cashed out into a long one.
 *
 * The store is an interface rather than Cloudflare's KV type, which keeps the logic testable
 * against a Map and keeps a platform dependency out of the one part that has any decisions in it.
 */
export interface PatchStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

/** Generous against our own codes — the 25-node load test is under 600 — and mean against abuse. */
export const MAX_PATCH_BYTES = 4096

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

function json(body: unknown, status = 200): Response {
  if (body === null) return new Response(null, { status, headers: CORS })
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * The browser's secret, hashed.
 *
 * What arrives is the random id a browser keeps for itself; what is stored is only this digest. So
 * the table cannot be read for the means to delete other people's entries, and the gallery holds
 * nothing that identifies anyone even if it leaks.
 */
async function hashed(secret: unknown): Promise<string> {
  if (typeof secret !== 'string' || secret.length === 0) return ''
  const bytes = new TextEncoder().encode(`castillon.gallery:${secret}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Turns the request into what the routes expect, hashing every identity on the way through so no
 * decision below this line ever sees a raw secret.
 */
async function galleryRequest(request: Request, path: string): Promise<GalleryRequest> {
  const url = new URL(request.url)
  const query = new URLSearchParams(url.search)
  const viewer = query.get('viewer')
  if (viewer) query.set('viewer', await hashed(viewer))

  let parsed: unknown = {}
  if (request.method === 'POST' || request.method === 'DELETE') {
    try {
      parsed = await request.json()
    } catch {
      parsed = {}
    }
    if (typeof parsed === 'object' && parsed !== null) {
      const holder = parsed as { publisher?: unknown }
      holder.publisher = await hashed(holder.publisher)
    }
  }

  return {
    method: request.method,
    path,
    query,
    body: async () => parsed,
    // Cloudflare puts it here. Nothing else about the connection is read, and no address is kept.
    country: (request as { cf?: { country?: string } }).cf?.country ?? null,
  }
}

function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8' },
  })
}

/**
 * Publishing is idempotent because the key is derived from the content: the same patch always lands
 * on the same key holding the same bytes, so sharing twice writes nothing new.
 *
 * A collision — same key, different patch — is settled by asking for one more character rather than
 * overwriting. Codes extend rather than restart, so the longer answer still begins with the short
 * one someone may already have seen.
 */
async function publish(store: PatchStore, code: string): Promise<Response> {
  const trimmed = code.trim()

  if (trimmed.length === 0) return text('empty', 400)
  if (trimmed.length > MAX_PATCH_BYTES) return text('too large', 413)
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return text('not a patch code', 400)
  // The real gate. Without it this is free hosting for arbitrary text, which is what would attract
  // abuse; with it the store can only ever hold patches.
  if (!decodePatch(trimmed)) return text('not a patch code', 400)

  for (let length = 6; length <= MAX_SHORT_CODE_LENGTH; length++) {
    const key = shortCodeFor(trimmed, length)
    const existing = await store.get(key)

    if (existing === null) {
      await store.put(key, trimmed)
      return text(key)
    }
    if (existing === trimmed) return text(key)
    // Taken by a different patch: try one character longer.
  }

  return text('could not find a free code', 507)
}

async function resolve(store: PatchStore, id: string): Promise<Response> {
  const key = normaliseShortCode(id)
  if (key.length === 0 || key.length > MAX_SHORT_CODE_LENGTH) return text('no such code', 404)

  const code = await store.get(key)
  return code === null ? text('no such code', 404) : text(code)
}

export async function handle(request: Request, store: PatchStore, db?: D1Like): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const path = new URL(request.url).pathname.replace(/^\/+|\/+$/g, '')

  // Checked before the code lookup below, which would otherwise read `gallery` as a short code.
  if (path === 'gallery' || path.startsWith('gallery/')) {
    if (!db) return json({ error: 'no gallery configured' }, 503)
    const rest = path.slice('gallery'.length).replace(/^\/+/, '')
    const result = await handleGallery(
      await galleryRequest(request, rest),
      d1Gallery(db),
      Date.now(),
      () => crypto.randomUUID(),
    )
    return json(result.body, result.status)
  }

  if (request.method === 'POST') return publish(store, await request.text())
  if (request.method === 'GET') {
    // A bare GET is the health check; anything else is taken as a code to look up.
    return path === '' ? text('castillon share service') : resolve(store, path)
  }

  return text('method not allowed', 405)
}

export default {
  fetch(request: Request, env: { PATCHES: PatchStore; GALLERY?: D1Like }): Promise<Response> {
    return handle(request, env.PATCHES, env.GALLERY)
  },
}
