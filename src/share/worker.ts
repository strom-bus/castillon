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
async function galleryRequest(
  request: Request,
  path: string,
  adminKey: string | undefined,
): Promise<GalleryRequest> {
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
    admin: isAdmin(request, adminKey),
  }
}

/** The key on the request, if any. Empty when the header is absent. */
function presentedKey(request: Request): string {
  return (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
}

/** Cloudflare's rate limiter, when one is bound. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

/**
 * Whether this request is inside its limit, keyed by where it came from.
 *
 * Keyed by a digest of the address rather than the address itself, and the limiter keeps nothing
 * beyond its window — which is what lets it use an address at all without breaking the promise that
 * none is stored. Absent binding means no limit rather than no request: these are second lines behind
 * the per-identity rules, not the only ones.
 */
export async function withinRate(
  request: Request,
  limiter: RateLimiter | undefined,
): Promise<boolean> {
  if (!limiter) return true
  const from = request.headers.get('cf-connecting-ip') ?? ''
  if (from === '') return true
  const { success } = await limiter.limit({ key: await hashed(from) })
  return success
}

/**
 * Whether the request carries the maintainer's key.
 *
 * Compared in constant time, which matters little for a key nobody is timing but costs nothing, and
 * false whenever no key is configured — a service without a secret set has no administrator rather
 * than an open door.
 */
export function isAdmin(request: Request, adminKey: string | undefined): boolean {
  if (!adminKey) return false
  const presented = presentedKey(request)
  if (presented.length !== adminKey.length) return false
  let same = 0
  for (let i = 0; i < adminKey.length; i++) {
    same |= presented.charCodeAt(i) ^ adminKey.charCodeAt(i)
  }
  return same === 0
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
async function register(store: PatchStore, code: string): Promise<string | null> {
  for (let length = 6; length <= MAX_SHORT_CODE_LENGTH; length++) {
    const key = shortCodeFor(code, length)
    const existing = await store.get(key)

    if (existing === null) {
      await store.put(key, code)
      return key
    }
    if (existing === code) return key
    // Taken by a different patch: try one character longer.
  }
  return null
}

/**
 * Puts a patch on the sharing service without answering as a route.
 *
 * Split out so the gallery can use it: a card shows its patch's short code, and a code shown that
 * nobody can redeem is worse than showing none. Swallows its failures — a gallery entry works from
 * the long code it already holds, so a KV problem must not stop somebody publishing.
 */
async function registerQuietly(store: PatchStore, code: unknown): Promise<void> {
  if (typeof code !== 'string') return
  const trimmed = code.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_PATCH_BYTES) return
  try {
    await register(store, trimmed)
  } catch {
    // Best effort by design.
  }
}

async function publish(store: PatchStore, code: string): Promise<Response> {
  const trimmed = code.trim()

  if (trimmed.length === 0) return text('empty', 400)
  if (trimmed.length > MAX_PATCH_BYTES) return text('too large', 413)
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return text('not a patch code', 400)
  // The real gate. Without it this is free hosting for arbitrary text, which is what would attract
  // abuse; with it the store can only ever hold patches.
  if (!decodePatch(trimmed)) return text('not a patch code', 400)

  const key = await register(store, trimmed)
  return key === null ? text('could not find a free code', 507) : text(key)
}

async function resolve(store: PatchStore, id: string): Promise<Response> {
  const key = normaliseShortCode(id)
  if (key.length === 0 || key.length > MAX_SHORT_CODE_LENGTH) return text('no such code', 404)

  const code = await store.get(key)
  return code === null ? text('no such code', 404) : text(code)
}

export async function handle(
  request: Request,
  store: PatchStore,
  db?: D1Like,
  adminKey?: string,
  limiters?: { publish?: RateLimiter; star?: RateLimiter },
): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const path = new URL(request.url).pathname.replace(/^\/+|\/+$/g, '')

  // Checked before the code lookup below, which would otherwise read `gallery` as a short code.
  if (path === 'gallery' || path.startsWith('gallery/')) {
    if (!db) return json({ error: 'no gallery configured' }, 503)
    const rest = path.slice('gallery'.length).replace(/^\/+/, '')

    // Writing is limited, reading is not: a limit on the wall itself would punish somebody browsing
    // rather than somebody flooding. Publishing and starring get their own, because one is a
    // deliberate act somebody does rarely and the other happens as fast as a finger can click.
    if (
      request.method === 'POST' &&
      rest === '' &&
      !(await withinRate(request, limiters?.publish))
    ) {
      return json({ error: 'Too many patches published just now. Try later.' }, 429)
    }
    if (
      request.method === 'POST' &&
      rest.endsWith('/star') &&
      !(await withinRate(request, limiters?.star))
    ) {
      return json({ error: 'Too many stars just now. Try again in a minute.' }, 429)
    }

    // A key that was offered and does not match is a refusal, not a malformed request. Without this
    // the answer was 400 "no publisher", which describes the body rather than the problem and reads
    // as though the key had been accepted.
    if (presentedKey(request) !== '' && !isAdmin(request, adminKey)) {
      return json({ error: 'not allowed' }, 403)
    }

    const gallery = await galleryRequest(request, rest, adminKey)
    const result = await handleGallery(gallery, d1Gallery(db), Date.now(), () =>
      crypto.randomUUID(),
    )

    // Published: make sure the short code its card will show can actually be redeemed. After the
    // entry rather than before, so a problem here can never cost somebody their publish.
    if (result.status === 201) {
      const body = (await gallery.body()) as { code?: unknown }
      await registerQuietly(store, body.code)
    }
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
  fetch(
    request: Request,
    env: {
      PATCHES: PatchStore
      GALLERY?: D1Like
      GALLERY_ADMIN_KEY?: string
      PUBLISH_LIMITER?: RateLimiter
      STAR_LIMITER?: RateLimiter
    },
  ): Promise<Response> {
    return handle(request, env.PATCHES, env.GALLERY, env.GALLERY_ADMIN_KEY, {
      publish: env.PUBLISH_LIMITER,
      star: env.STAR_LIMITER,
    })
  },
}
