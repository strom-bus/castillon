/**
 * A gallery that lives in this browser.
 *
 * It exists so the window can be built, used and tested before the Worker and its database are in
 * place, and it is not throwaway: with no service configured it is what the gallery falls back to, so
 * the feature degrades to a private shelf rather than to an error.
 *
 * The browser secret it keeps is the same idea the real client will use for withdrawing an entry
 * (PLAN §12.6): an id the app holds on your behalf, rather than a token you have to keep.
 */
import { publisherId } from './identity'
import { byPopularity } from './score'
import {
  MAX_AUTHOR_LENGTH,
  MAX_NAME_LENGTH,
  PAGE_SIZE,
  WITHDRAW_WINDOW_MS,
  type GalleryClient,
  type GalleryEntry,
  type GallerySort,
  type PublishRequest,
} from './types'

const ENTRIES_KEY = 'castillon.gallery.entries'
const STARS_KEY = 'castillon.gallery.stars'

/** What is actually stored: `starred` and `mine` are worked out per browser, not kept on the row. */
interface StoredEntry {
  id: string
  code: string
  name: string
  author: string
  country: string | null
  createdAt: number
  stars: number
  publisher: string
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

/**
 * The region of the browser's own locale, or null.
 *
 * `maximize()` fills in the likely region for a language that gave none — "en" becomes "en-US" — so
 * this answers for a plain language tag rather than giving up on it. A guess either way, and only
 * ever used by the local gallery.
 */
function guessCountry(): string | null {
  try {
    return new Intl.Locale(navigator.language).maximize().region ?? null
  } catch {
    return null
  }
}

/** Trimmed and cut to length. The two text fields are the gallery's risk surface (PLAN §12.4). */
export function cleanField(value: string, limit: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit)
}

export function createLocalGallery(now: () => number = Date.now): GalleryClient {
  function decorate(stored: StoredEntry, stars: Set<string>, me: string): GalleryEntry {
    return {
      id: stored.id,
      code: stored.code,
      name: stored.name,
      author: stored.author,
      country: stored.country,
      createdAt: stored.createdAt,
      stars: stored.stars,
      starred: stars.has(stored.id),
      mine: stored.publisher === me && now() - stored.createdAt < WITHDRAW_WINDOW_MS,
    }
  }

  return {
    async list(sort: GallerySort, page = 0) {
      const stored = read<StoredEntry[]>(ENTRIES_KEY, [])
      const stars = new Set(read<string[]>(STARS_KEY, []))
      const me = publisherId()
      const all = stored.map((entry) => decorate(entry, stars, me))
      const at = now()
      const sorted =
        sort === 'recent'
          ? all.sort((a, b) => b.createdAt - a.createdAt)
          : all.sort((a, b) => byPopularity(a, b, at))
      const from = Math.max(0, page) * PAGE_SIZE
      return {
        entries: sorted.slice(from, from + PAGE_SIZE),
        hasMore: sorted.length > from + PAGE_SIZE,
      }
    },

    async publish(request: PublishRequest) {
      const name = cleanField(request.name, MAX_NAME_LENGTH)
      const author = cleanField(request.author, MAX_AUTHOR_LENGTH)
      if (!name) throw new Error('The patch needs a name.')
      if (!author) throw new Error('Add a nickname so people know whose it is.')

      const entry: StoredEntry = {
        id: `g-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
        code: request.code,
        name,
        author,
        // A stand-in. A country can only honestly come from the request — a browser cannot see its
        // own address — so this is the browser's own locale, guessed, and the service's value
        // supersedes it the moment there is one. Kept because a card with no country at all makes
        // the gallery look broken while it is still a private shelf.
        country: guessCountry(),
        createdAt: now(),
        stars: 0,
        publisher: publisherId(),
      }
      write(ENTRIES_KEY, [entry, ...read<StoredEntry[]>(ENTRIES_KEY, [])])
      return decorate(entry, new Set(read<string[]>(STARS_KEY, [])), entry.publisher)
    },

    async star(id: string) {
      const stored = read<StoredEntry[]>(ENTRIES_KEY, [])
      const stars = new Set(read<string[]>(STARS_KEY, []))
      const target = stored.find((entry) => entry.id === id)
      if (!target) throw new Error('That patch is no longer in the gallery.')

      // A toggle, not a counter: one browser, one star, and it can be taken back.
      if (stars.has(id)) {
        stars.delete(id)
        target.stars = Math.max(0, target.stars - 1)
      } else {
        stars.add(id)
        target.stars += 1
      }
      write(ENTRIES_KEY, stored)
      write(STARS_KEY, [...stars])
      return decorate(target, stars, publisherId())
    },

    async remove(id: string) {
      const stored = read<StoredEntry[]>(ENTRIES_KEY, [])
      const me = publisherId()
      const target = stored.find((entry) => entry.id === id)
      if (!target) return
      if (target.publisher !== me) throw new Error('That entry belongs to someone else.')
      if (now() - target.createdAt >= WITHDRAW_WINDOW_MS) {
        throw new Error('An entry can only be withdrawn within a day of publishing it.')
      }
      write(
        ENTRIES_KEY,
        stored.filter((entry) => entry.id !== id),
      )
    },
  }
}
