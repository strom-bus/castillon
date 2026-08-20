/**
 * The gallery's storage, behind an interface.
 *
 * SQL lives only in the D1 implementation at the bottom; everything with a decision in it is written
 * against this interface and tested against an in-memory version. The same arrangement as
 * `PatchStore`, and for the same reason: a platform dependency has no business in the part that
 * decides who may delete what.
 */

export interface StoredEntry {
  id: string
  code: string
  name: string
  author: string
  country: string | null
  createdAt: number
  /** Hashed. Never an address, and never the raw browser secret (PLAN §12.6). */
  publisher: string
  stars: number
}

export type SortOrder = 'recent' | 'popular'

export interface GalleryStore {
  /**
   * `offset` pages through. Offset rather than a cursor because the popular ordering moves as stars
   * arrive, so a cursor into it would point at a row that has since shifted; at this scale the cost
   * of counting past skipped rows is nothing.
   */
  list(order: SortOrder, limit: number, offset: number, now: number): Promise<StoredEntry[]>
  insert(entry: Omit<StoredEntry, 'stars'>): Promise<void>
  find(id: string): Promise<StoredEntry | null>
  /** Adds or removes one browser's star. Resolves to the count afterwards. */
  toggleStar(id: string, voter: string): Promise<number>
  hasStarred(id: string, voter: string): Promise<boolean>
  remove(id: string): Promise<void>
  /** How many entries this publisher has added since a moment, for the rate limit. */
  countByPublisherSince(publisher: string, since: number): Promise<number>
}

/**
 * Popularity that decays with age, in SQL.
 *
 * The same shape as the client's `popularity`: stars over a power of the age, so a raw count cannot
 * rank by seniority. Kept here rather than sorted in the app because the whole point of using SQLite
 * is that "the best twenty" is a question the database can answer without shipping every row.
 */
const AGE = '(((?1 - e.created_at) / 3600000.0) + 4.0)'

/**
 * `x * SQRT(x)` rather than `POWER(x, 1.5)`.
 *
 * **D1 does not authorise `POWER`** — it answers "not authorized to use function" — and the unit
 * tests could not see that, because the store they run against does the arithmetic in JavaScript.
 * The popular ordering returned a 500 in production while every test passed. `SQRT` is authorised, so
 * the same exponent survives and the client's `popularity` still agrees with this.
 */
const POPULAR_ORDER = `
  ORDER BY
    (CAST(COUNT(s.voter) AS REAL) / (${AGE} * SQRT(${AGE}))) DESC,
    e.created_at DESC
`

/** Column list shared by every read, so a shape change cannot drift between queries. */
const COLUMNS = `
  e.id, e.code, e.name, e.author, e.country, e.created_at, e.publisher,
  COUNT(s.voter) AS stars
`

interface Row {
  id: string
  code: string
  name: string
  author: string
  country: string | null
  created_at: number
  publisher: string
  stars: number
}

function toEntry(row: Row): StoredEntry {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    author: row.author,
    country: row.country,
    createdAt: row.created_at,
    publisher: row.publisher,
    stars: row.stars,
  }
}

/** The subset of D1 this uses, named so the dependency is visible rather than ambient. */
export interface D1Like {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results: T[] }>
      first<T>(): Promise<T | null>
      run(): Promise<unknown>
    }
    all<T>(): Promise<{ results: T[] }>
    first<T>(): Promise<T | null>
    run(): Promise<unknown>
  }
}

export function d1Gallery(db: D1Like): GalleryStore {
  return {
    async list(order, limit, offset, now) {
      // Stars are counted rather than kept in a column: a count that is derived cannot drift from
      // the rows it is meant to describe.
      const query =
        order === 'popular'
          ? `SELECT ${COLUMNS} FROM entries e LEFT JOIN stars s ON s.entry_id = e.id
             GROUP BY e.id ${POPULAR_ORDER} LIMIT ?2 OFFSET ?3`
          : `SELECT ${COLUMNS} FROM entries e LEFT JOIN stars s ON s.entry_id = e.id
             GROUP BY e.id ORDER BY e.created_at DESC LIMIT ?2 OFFSET ?3`
      const { results } = await db.prepare(query).bind(now, limit, offset).all<Row>()
      return results.map(toEntry)
    },

    async insert(entry) {
      await db
        .prepare(
          `INSERT INTO entries (id, code, name, author, country, created_at, publisher)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          entry.id,
          entry.code,
          entry.name,
          entry.author,
          entry.country,
          entry.createdAt,
          entry.publisher,
        )
        .run()
    },

    async find(id) {
      const row = await db
        .prepare(
          `SELECT ${COLUMNS} FROM entries e LEFT JOIN stars s ON s.entry_id = e.id
           WHERE e.id = ? GROUP BY e.id`,
        )
        .bind(id)
        .first<Row>()
      return row ? toEntry(row) : null
    },

    async hasStarred(id, voter) {
      const row = await db
        .prepare('SELECT 1 AS found FROM stars WHERE entry_id = ? AND voter = ?')
        .bind(id, voter)
        .first<{ found: number }>()
      return row !== null
    },

    async toggleStar(id, voter) {
      const starred = await this.hasStarred(id, voter)
      if (starred) {
        await db.prepare('DELETE FROM stars WHERE entry_id = ? AND voter = ?').bind(id, voter).run()
      } else {
        // OR IGNORE, so two clicks racing each other cannot fail the second one.
        await db
          .prepare('INSERT OR IGNORE INTO stars (entry_id, voter) VALUES (?, ?)')
          .bind(id, voter)
          .run()
      }
      const row = await db
        .prepare('SELECT COUNT(voter) AS stars FROM stars WHERE entry_id = ?')
        .bind(id)
        .first<{ stars: number }>()
      return row?.stars ?? 0
    },

    async remove(id) {
      // The stars go with it. SQLite will not cascade without the pragma, so it is done explicitly.
      await db.prepare('DELETE FROM stars WHERE entry_id = ?').bind(id).run()
      await db.prepare('DELETE FROM entries WHERE id = ?').bind(id).run()
    },

    async countByPublisherSince(publisher, since) {
      const row = await db
        .prepare('SELECT COUNT(id) AS n FROM entries WHERE publisher = ? AND created_at >= ?')
        .bind(publisher, since)
        .first<{ n: number }>()
      return row?.n ?? 0
    },
  }
}
