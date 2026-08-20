import { describe, expect, it } from 'vitest'
import { popularity } from '../gallery/score'
import {
  cleanField,
  handleGallery,
  looksLikeSpam,
  MAX_AUTHOR_LENGTH,
  MAX_NAME_LENGTH,
  normaliseCountry,
  PUBLISH_LIMIT,
  WITHDRAW_WINDOW_MS,
  type GalleryRequest,
} from './galleryRoutes'
import type { GalleryStore, StoredEntry } from './galleryStore'

/**
 * The routes hold every decision about who may do what, so they are tested against a store in memory
 * rather than a database. The SQL that mirrors it is thin by design and verified against the real
 * thing end to end.
 */

function memoryStore(): GalleryStore {
  const rows: StoredEntry[] = []
  const stars = new Set<string>()
  const key = (id: string, voter: string) => `${id} ${voter}`
  const count = (id: string) => [...stars].filter((k) => k.startsWith(`${id} `)).length

  return {
    async list(order, limit, now) {
      const withStars = rows.map((row) => ({ ...row, stars: count(row.id) }))
      const sorted =
        order === 'popular'
          ? withStars.sort(
              (a, b) =>
                popularity(b.stars, now - b.createdAt) - popularity(a.stars, now - a.createdAt) ||
                b.createdAt - a.createdAt,
            )
          : withStars.sort((a, b) => b.createdAt - a.createdAt)
      return sorted.slice(0, limit)
    },
    async insert(entry) {
      rows.push({ ...entry, stars: 0 })
    },
    async find(id) {
      const row = rows.find((candidate) => candidate.id === id)
      return row ? { ...row, stars: count(id) } : null
    },
    async hasStarred(id, voter) {
      return stars.has(key(id, voter))
    },
    async toggleStar(id, voter) {
      if (stars.has(key(id, voter))) stars.delete(key(id, voter))
      else stars.add(key(id, voter))
      return count(id)
    },
    async remove(id) {
      const at = rows.findIndex((row) => row.id === id)
      if (at >= 0) rows.splice(at, 1)
      for (const k of [...stars]) if (k.startsWith(`${id} `)) stars.delete(k)
    },
    async countByPublisherSince(publisher, since) {
      return rows.filter((row) => row.publisher === publisher && row.createdAt >= since).length
    },
  }
}

const CODE = 'FGJaABAJBSMEAoUjiuuaDszNV6oJ5QAM'
const NOW = 1_700_000_000_000

function ask(
  method: string,
  path: string,
  options: { body?: unknown; query?: string; country?: string | null } = {},
): GalleryRequest {
  return {
    method,
    path,
    query: new URLSearchParams(options.query ?? ''),
    body: async () => options.body ?? {},
    country: options.country ?? null,
  }
}

let counter = 0
const ids = () => `g${++counter}`

function publishOne(
  store: GalleryStore,
  overrides: Record<string, unknown> = {},
  now = NOW,
  country: string | null = null,
) {
  return handleGallery(
    ask('POST', '', {
      body: { code: CODE, name: 'Thing', author: 'nick', publisher: 'hash-a', ...overrides },
      country,
    }),
    store,
    now,
    ids,
  )
}

const idOf = (result: { body: unknown }) => (result.body as { id: string }).id
const entriesOf = (result: { body: unknown }) =>
  (result.body as { entries: Record<string, unknown>[] }).entries

describe('cleanField', () => {
  it('collapses, trims and cuts', () => {
    expect(cleanField('  a   b  ', 40)).toBe('a b')
    expect(cleanField('x'.repeat(99), 10)).toHaveLength(10)
  })

  it('refuses anything that is not a string rather than coercing it', () => {
    expect(cleanField(42, 10)).toBe('')
    expect(cleanField(null, 10)).toBe('')
    expect(cleanField({ toString: () => 'sneaky' }, 10)).toBe('')
  })
})

describe('looksLikeSpam', () => {
  it('catches the thing gallery spam actually is: a link', () => {
    expect(looksLikeSpam('best deals http://x.ru')).toBe(true)
    expect(looksLikeSpam('visit www.example.com')).toBe(true)
    expect(looksLikeSpam('cheap-shoes.shop')).toBe(true)
  })

  it('catches markup, which has no business in a name either', () => {
    expect(looksLikeSpam('<script>')).toBe(true)
  })

  it('leaves ordinary names alone', () => {
    expect(looksLikeSpam('Cascada de mayo')).toBe(false)
    expect(looksLikeSpam('3 voices + reverb')).toBe(false)
  })
})

describe('normaliseCountry', () => {
  it('keeps two letters, in capitals', () => {
    expect(normaliseCountry('de')).toBe('DE')
  })

  it('drops what Cloudflare says when it does not know', () => {
    expect(normaliseCountry('XX')).toBeNull()
    expect(normaliseCountry('T1')).toBeNull()
  })

  it('drops anything that is not two letters', () => {
    expect(normaliseCountry(null)).toBeNull()
    expect(normaliseCountry('Germany')).toBeNull()
  })
})

describe('publishing', () => {
  it('takes the patch and answers with the entry', async () => {
    const result = await publishOne(memoryStore())
    expect(result.status).toBe(201)
    expect(result.body).toMatchObject({ name: 'Thing', author: 'nick', stars: 0, mine: true })
  })

  it('takes the country from the edge rather than from the browser', async () => {
    const result = await publishOne(memoryStore(), {}, NOW, 'cl')
    expect(result.body).toMatchObject({ country: 'CL' })
  })

  it('never hands back the publisher hash', async () => {
    const result = await publishOne(memoryStore())
    expect(JSON.stringify(result.body)).not.toContain('hash-a')
  })

  it('needs a name and a nickname', async () => {
    const store = memoryStore()
    expect((await publishOne(store, { name: '   ' })).status).toBe(400)
    expect((await publishOne(store, { author: '' })).status).toBe(400)
  })

  it('holds the fields to their limits instead of refusing', async () => {
    const result = await publishOne(memoryStore(), {
      name: 'n'.repeat(MAX_NAME_LENGTH + 20),
      author: 'a'.repeat(MAX_AUTHOR_LENGTH + 20),
    })
    expect(result.body).toMatchObject({
      name: 'n'.repeat(MAX_NAME_LENGTH),
      author: 'a'.repeat(MAX_AUTHOR_LENGTH),
    })
  })

  it('refuses a name carrying a link', async () => {
    expect((await publishOne(memoryStore(), { name: 'free stuff at x.shop' })).status).toBe(400)
  })

  it('refuses anything that is not a patch code', async () => {
    const store = memoryStore()
    expect((await publishOne(store, { code: '' })).status).toBe(400)
    expect((await publishOne(store, { code: 'has spaces' })).status).toBe(400)
    expect((await publishOne(store, { code: 'x'.repeat(5000) })).status).toBe(413)
  })

  it('refuses to publish with no publisher, since nothing could be withdrawn', async () => {
    const result = await handleGallery(
      ask('POST', '', { body: { code: CODE, name: 'A', author: 'b' } }),
      memoryStore(),
      NOW,
      ids,
    )
    expect(result.status).toBe(400)
  })

  it('stops one publisher flooding the wall', async () => {
    const store = memoryStore()
    for (let i = 0; i < PUBLISH_LIMIT; i++) {
      expect((await publishOne(store, { name: `Thing ${i}` })).status).toBe(201)
    }
    expect((await publishOne(store, { name: 'One more' })).status).toBe(429)
  })

  it('lets the same publisher back once the hour has passed', async () => {
    const store = memoryStore()
    for (let i = 0; i < PUBLISH_LIMIT; i++) await publishOne(store, { name: `Thing ${i}` })
    expect((await publishOne(store, { name: 'Later' }, NOW + 61 * 60 * 1000)).status).toBe(201)
  })
})

describe('listing', () => {
  it('answers newest first by default', async () => {
    const store = memoryStore()
    await publishOne(store, { name: 'First' }, NOW)
    await publishOne(store, { name: 'Second' }, NOW + 1000)

    const result = await handleGallery(ask('GET', ''), store, NOW + 2000, ids)
    expect(entriesOf(result).map((entry) => entry.name)).toEqual(['Second', 'First'])
  })

  it('lets a star lift an entry when asked for popular', async () => {
    const store = memoryStore()
    const first = await publishOne(store, { name: 'First' }, NOW)
    await publishOne(store, { name: 'Second' }, NOW + 1000)
    await handleGallery(
      ask('POST', `${idOf(first)}/star`, { body: { publisher: 'hash-b' } }),
      store,
      NOW,
      ids,
    )

    const result = await handleGallery(
      ask('GET', '', { query: 'sort=popular' }),
      store,
      NOW + 2000,
      ids,
    )
    expect(entriesOf(result)[0].name).toBe('First')
  })

  it('reads without identifying yourself, and marks nothing as yours', async () => {
    const store = memoryStore()
    await publishOne(store)
    const result = await handleGallery(ask('GET', ''), store, NOW, ids)
    expect(entriesOf(result)[0]).toMatchObject({ mine: false, starred: false })
  })

  it('marks your own entry and your own star when you say who you are', async () => {
    const store = memoryStore()
    const published = await publishOne(store)
    await handleGallery(
      ask('POST', `${idOf(published)}/star`, { body: { publisher: 'hash-a' } }),
      store,
      NOW,
      ids,
    )

    const result = await handleGallery(ask('GET', '', { query: 'viewer=hash-a' }), store, NOW, ids)
    expect(entriesOf(result)[0]).toMatchObject({ mine: true, starred: true })
  })

  it('stops calling an old entry yours once the day is up', async () => {
    const store = memoryStore()
    await publishOne(store)
    const result = await handleGallery(
      ask('GET', '', { query: 'viewer=hash-a' }),
      store,
      NOW + WITHDRAW_WINDOW_MS + 1,
      ids,
    )
    expect(entriesOf(result)[0].mine).toBe(false)
  })
})

describe('stars', () => {
  it('goes on and off with the same request', async () => {
    const store = memoryStore()
    const id = idOf(await publishOne(store))
    const on = ask('POST', `${id}/star`, { body: { publisher: 'hash-b' } })

    expect(((await handleGallery(on, store, NOW, ids)).body as { stars: number }).stars).toBe(1)
    expect(((await handleGallery(on, store, NOW, ids)).body as { stars: number }).stars).toBe(0)
  })

  it('counts two browsers separately', async () => {
    const store = memoryStore()
    const id = idOf(await publishOne(store))
    await handleGallery(ask('POST', `${id}/star`, { body: { publisher: 'b' } }), store, NOW, ids)
    const second = await handleGallery(
      ask('POST', `${id}/star`, { body: { publisher: 'c' } }),
      store,
      NOW,
      ids,
    )
    expect((second.body as { stars: number }).stars).toBe(2)
  })

  it('says so on an entry that has gone', async () => {
    const result = await handleGallery(
      ask('POST', 'nope/star', { body: { publisher: 'b' } }),
      memoryStore(),
      NOW,
      ids,
    )
    expect(result.status).toBe(404)
  })
})

describe('withdrawing', () => {
  it('removes your own entry, and its stars with it', async () => {
    const store = memoryStore()
    const id = idOf(await publishOne(store))
    await handleGallery(ask('POST', `${id}/star`, { body: { publisher: 'b' } }), store, NOW, ids)

    const result = await handleGallery(
      ask('DELETE', id, { body: { publisher: 'hash-a' } }),
      store,
      NOW,
      ids,
    )
    expect(result.status).toBe(204)
    expect(await store.find(id)).toBeNull()
  })

  it('refuses an entry somebody else published', async () => {
    const store = memoryStore()
    const id = idOf(await publishOne(store))
    const result = await handleGallery(
      ask('DELETE', id, { body: { publisher: 'hash-stranger' } }),
      store,
      NOW,
      ids,
    )
    expect(result.status).toBe(403)
    expect(await store.find(id)).not.toBeNull()
  })

  it('refuses once the day is up, so the wall settles', async () => {
    const store = memoryStore()
    const id = idOf(await publishOne(store))
    const result = await handleGallery(
      ask('DELETE', id, { body: { publisher: 'hash-a' } }),
      store,
      NOW + WITHDRAW_WINDOW_MS + 1,
      ids,
    )
    expect(result.status).toBe(410)
  })

  it('treats an entry that is already gone as success', async () => {
    const result = await handleGallery(
      ask('DELETE', 'never-existed', { body: { publisher: 'hash-a' } }),
      memoryStore(),
      NOW,
      ids,
    )
    expect(result.status).toBe(204)
  })
})

describe('anything else', () => {
  it('is a 404 rather than a surprise', async () => {
    const store = memoryStore()
    expect((await handleGallery(ask('PUT', ''), store, NOW, ids)).status).toBe(404)
    expect((await handleGallery(ask('GET', 'a/b/c'), store, NOW, ids)).status).toBe(404)
  })
})
