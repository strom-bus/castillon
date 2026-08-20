/**
 * The gallery's HTTP surface.
 *
 * Four things a browser can ask for: the wall, a place on it, a star, and to take an entry back.
 * Written against `GalleryStore` so all of it is testable without a database.
 *
 * What is guarded here is not the patches — a patch cannot be anything but a patch, the sharing
 * service already sees to that — but the two free-text fields, which are the only place arbitrary
 * writing reaches a public page (PLAN §12.4).
 */
import type { GalleryStore, SortOrder, StoredEntry } from './galleryStore'

export const MAX_NAME_LENGTH = 48
export const MAX_AUTHOR_LENGTH = 24
export const MAX_CODE_BYTES = 4096
/** How many entries one publisher may add in an hour. */
export const PUBLISH_LIMIT = 10
export const PUBLISH_WINDOW_MS = 60 * 60 * 1000
/** How long an author may withdraw their own entry (PLAN §12.6). */
export const WITHDRAW_WINDOW_MS = 24 * 60 * 60 * 1000
/** One screen's worth. A gallery that needs paging can grow one later. */
export const PAGE_SIZE = 60

/**
 * Text that has no business in a public name.
 *
 * A blocklist is a speed bump, not a wall — one substitution walks around it — and it is not what
 * makes the pair in §12.4 proportionate; the withdrawal path is. What earns its place here is the
 * link check: gallery spam is almost always a URL, and no patch needs one in its name.
 */
const FORBIDDEN = [
  /https?:\/\//i,
  /\bwww\./i,
  /[a-z0-9-]+\.(com|net|org|io|ru|xyz|top|shop|link)\b/i,
  /<[a-z/]/i,
]

export interface GalleryRequest {
  method: string
  /** Path with the `gallery` prefix already removed, no leading slash. */
  path: string
  query: URLSearchParams
  body(): Promise<unknown>
  /** Two letters from the edge, or null. Never stored as an address (PLAN §12.3). */
  country: string | null
}

export interface GalleryResult {
  status: number
  body: unknown
}

function fail(status: number, message: string): GalleryResult {
  return { status, body: { error: message } }
}

/** Collapsed, trimmed and cut. Cut rather than refused: a long name is clumsy, not hostile. */
export function cleanField(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, limit)
}

export function looksLikeSpam(text: string): boolean {
  return FORBIDDEN.some((pattern) => pattern.test(text))
}

/** Two letters, or null. `XX` and `T1` mean Cloudflare could not tell, and neither is a place. */
export function normaliseCountry(country: string | null): string | null {
  if (!country || !/^[A-Za-z]{2}$/.test(country)) return null
  const code = country.toUpperCase()
  return code === 'XX' || code === 'T1' ? null : code
}

/** What a browser is told. The publisher hash never leaves the server. */
function present(entry: StoredEntry, starred: boolean, mine: boolean): unknown {
  return {
    id: entry.id,
    code: entry.code,
    name: entry.name,
    author: entry.author,
    country: entry.country,
    createdAt: entry.createdAt,
    stars: entry.stars,
    starred,
    mine,
  }
}

interface Identified {
  /** Already hashed by the caller: this module never sees the browser's secret. */
  publisher: string
}

function identity(body: unknown): Identified | null {
  if (typeof body !== 'object' || body === null) return null
  const publisher = (body as { publisher?: unknown }).publisher
  return typeof publisher === 'string' && publisher.length > 0 ? { publisher } : null
}

async function list(
  store: GalleryStore,
  order: SortOrder,
  viewer: string | null,
  now: number,
): Promise<GalleryResult> {
  const entries = await store.list(order, PAGE_SIZE, now)
  const decorated = await Promise.all(
    entries.map(async (entry) => {
      const starred = viewer ? await store.hasStarred(entry.id, viewer) : false
      const mine = viewer === entry.publisher && now - entry.createdAt < WITHDRAW_WINDOW_MS
      return present(entry, starred, mine)
    }),
  )
  return { status: 200, body: { entries: decorated } }
}

async function publish(
  store: GalleryStore,
  body: unknown,
  country: string | null,
  now: number,
  newId: () => string,
): Promise<GalleryResult> {
  const who = identity(body)
  if (!who) return fail(400, 'no publisher')

  const fields = body as { code?: unknown; name?: unknown; author?: unknown }
  const code = typeof fields.code === 'string' ? fields.code.trim() : ''
  const name = cleanField(fields.name, MAX_NAME_LENGTH)
  const author = cleanField(fields.author, MAX_AUTHOR_LENGTH)

  if (code.length === 0) return fail(400, 'no patch')
  if (code.length > MAX_CODE_BYTES) return fail(413, 'patch too large')
  if (!/^[A-Za-z0-9_-]+$/.test(code)) return fail(400, 'not a patch code')
  if (!name) return fail(400, 'The patch needs a name.')
  if (!author) return fail(400, 'Add a nickname so people know whose it is.')
  if (looksLikeSpam(name) || looksLikeSpam(author)) {
    return fail(400, 'Names cannot contain links or markup.')
  }

  const recent = await store.countByPublisherSince(who.publisher, now - PUBLISH_WINDOW_MS)
  if (recent >= PUBLISH_LIMIT) return fail(429, 'Too many patches published just now. Try later.')

  const entry = {
    id: newId(),
    code,
    name,
    author,
    country: normaliseCountry(country),
    createdAt: now,
    publisher: who.publisher,
  }
  await store.insert(entry)
  return { status: 201, body: present({ ...entry, stars: 0 }, false, true) }
}

async function star(
  store: GalleryStore,
  id: string,
  body: unknown,
  now: number,
): Promise<GalleryResult> {
  const who = identity(body)
  if (!who) return fail(400, 'no voter')

  const existing = await store.find(id)
  if (!existing) return fail(404, 'That patch is no longer in the gallery.')

  const stars = await store.toggleStar(id, who.publisher)
  const starred = await store.hasStarred(id, who.publisher)
  const mine = who.publisher === existing.publisher && now - existing.createdAt < WITHDRAW_WINDOW_MS
  return { status: 200, body: present({ ...existing, stars }, starred, mine) }
}

async function withdraw(
  store: GalleryStore,
  id: string,
  body: unknown,
  now: number,
): Promise<GalleryResult> {
  const who = identity(body)
  if (!who) return fail(400, 'no publisher')

  const existing = await store.find(id)
  // Already gone is the outcome that was asked for.
  if (!existing) return { status: 204, body: null }

  if (existing.publisher !== who.publisher) {
    return fail(403, 'That entry belongs to someone else.')
  }
  if (now - existing.createdAt >= WITHDRAW_WINDOW_MS) {
    return fail(410, 'An entry can only be withdrawn within a day of publishing it.')
  }

  await store.remove(id)
  return { status: 204, body: null }
}

export async function handleGallery(
  request: GalleryRequest,
  store: GalleryStore,
  now: number,
  newId: () => string,
): Promise<GalleryResult> {
  const segments = request.path.split('/').filter(Boolean)

  if (request.method === 'GET' && segments.length === 0) {
    const order: SortOrder = request.query.get('sort') === 'popular' ? 'popular' : 'recent'
    // The viewer is optional: the wall reads without identifying yourself, and only the marks that
    // are personal — your star, your trash icon — need one.
    return list(store, order, request.query.get('viewer'), now)
  }

  if (request.method === 'POST' && segments.length === 0) {
    return publish(store, await request.body(), request.country, now, newId)
  }

  if (request.method === 'POST' && segments.length === 2 && segments[1] === 'star') {
    return star(store, segments[0], await request.body(), now)
  }

  if (request.method === 'DELETE' && segments.length === 1) {
    return withdraw(store, segments[0], await request.body(), now)
  }

  return fail(404, 'no such gallery route')
}
