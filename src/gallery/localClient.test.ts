import { beforeEach, describe, expect, it } from 'vitest'
import { cleanField, createLocalGallery } from './localClient'
import { MAX_AUTHOR_LENGTH, MAX_NAME_LENGTH, PAGE_SIZE, WITHDRAW_WINDOW_MS } from './types'

/**
 * The local gallery is what the window runs against until the service exists, and it is also where
 * the rules live: what a field may contain, that a star is a toggle rather than a counter, and that
 * an entry can only be withdrawn by whoever published it and only for a day.
 */

const CODE = 'FGJaABAJBSMEAoUjiuuaDszNV6oJ5QAM'

let clock = 1_700_000_000_000
const gallery = () => createLocalGallery(() => clock)

beforeEach(() => {
  localStorage.clear()
  clock = 1_700_000_000_000
})

describe('cleanField', () => {
  it('collapses whitespace and trims', () => {
    expect(cleanField('  two   words  ', 40)).toBe('two words')
  })

  it('cuts to the limit rather than refusing', () => {
    expect(cleanField('x'.repeat(200), 10)).toHaveLength(10)
  })

  it('turns a field of only spaces into nothing, which publishing then rejects', () => {
    expect(cleanField('     ', 40)).toBe('')
  })
})

describe('publishing', () => {
  it('needs a name', async () => {
    await expect(gallery().publish({ code: CODE, name: '  ', author: 'nick' })).rejects.toThrow(
      /name/i,
    )
  })

  it('needs a nickname, so no patch is anonymous', async () => {
    await expect(gallery().publish({ code: CODE, name: 'Thing', author: '' })).rejects.toThrow(
      /nickname/i,
    )
  })

  it('holds the fields to their limits', async () => {
    const entry = await gallery().publish({
      code: CODE,
      name: 'n'.repeat(MAX_NAME_LENGTH + 50),
      author: 'a'.repeat(MAX_AUTHOR_LENGTH + 50),
    })
    expect(entry.name).toHaveLength(MAX_NAME_LENGTH)
    expect(entry.author).toHaveLength(MAX_AUTHOR_LENGTH)
  })

  it('keeps the patch code, which is what a card draws and loads from', async () => {
    const entry = await gallery().publish({ code: CODE, name: 'Thing', author: 'nick' })
    expect(entry.code).toBe(CODE)
  })

  it('stands in for the country with the browser locale, since only a server can know it', async () => {
    // A guess, and labelled as one in the client: a browser cannot see its own address, so the real
    // value can only come from the request. Two letters or nothing — never a language tag, and never
    // something a card would print as if it were a place.
    const entry = await gallery().publish({ code: CODE, name: 'Thing', author: 'nick' })
    expect(entry.country === null || /^[A-Z]{2}$/.test(entry.country)).toBe(true)
  })
})

describe('listing', () => {
  it('puts the newest first when asked for recent', async () => {
    const client = gallery()
    await client.publish({ code: CODE, name: 'First', author: 'nick' })
    clock += 60_000
    await client.publish({ code: CODE, name: 'Second', author: 'nick' })

    expect((await client.list('recent', 0)).entries.map((entry) => entry.name)).toEqual([
      'Second',
      'First',
    ])
  })

  it('lets a starred entry rise when asked for popular', async () => {
    const client = gallery()
    const first = await client.publish({ code: CODE, name: 'First', author: 'nick' })
    clock += 60_000
    await client.publish({ code: CODE, name: 'Second', author: 'nick' })
    await client.star(first.id)

    expect((await client.list('popular', 0)).entries[0].name).toBe('First')
  })
})

describe('paging', () => {
  it('hands out a page at a time and says whether there is another', async () => {
    const client = gallery()
    for (let i = 0; i < PAGE_SIZE + 3; i++) {
      clock += 1000
      await client.publish({ code: CODE, name: `Thing ${i}`, author: 'nick' })
    }

    const first = await client.list('recent', 0)
    expect(first.entries).toHaveLength(PAGE_SIZE)
    expect(first.hasMore).toBe(true)

    const second = await client.list('recent', 1)
    expect(second.entries).toHaveLength(3)
    expect(second.hasMore).toBe(false)
  })

  it('does not repeat an entry between pages', async () => {
    const client = gallery()
    for (let i = 0; i < PAGE_SIZE + 3; i++) {
      clock += 1000
      await client.publish({ code: CODE, name: `Thing ${i}`, author: 'nick' })
    }
    const first = await client.list('recent', 0)
    const second = await client.list('recent', 1)
    const ids = new Set([...first.entries, ...second.entries].map((entry) => entry.id))
    expect(ids.size).toBe(PAGE_SIZE + 3)
  })

  it('answers an empty page past the end rather than failing', async () => {
    const client = gallery()
    await client.publish({ code: CODE, name: 'Thing', author: 'nick' })
    const far = await client.list('recent', 9)
    expect(far.entries).toHaveLength(0)
    expect(far.hasMore).toBe(false)
  })
})

describe('stars', () => {
  it('is a toggle, so one browser cannot run the count up', async () => {
    const client = gallery()
    const entry = await client.publish({ code: CODE, name: 'Thing', author: 'nick' })

    expect((await client.star(entry.id)).stars).toBe(1)
    expect((await client.star(entry.id)).stars).toBe(0)
    expect((await client.star(entry.id)).stars).toBe(1)
  })

  it('remembers that this browser gave it', async () => {
    const client = gallery()
    const entry = await client.publish({ code: CODE, name: 'Thing', author: 'nick' })
    await client.star(entry.id)
    expect((await client.list('recent', 0)).entries[0].starred).toBe(true)
  })

  it('never goes below zero, whatever state it was left in', async () => {
    const client = gallery()
    const entry = await client.publish({ code: CODE, name: 'Thing', author: 'nick' })
    await client.star(entry.id)
    await client.star(entry.id)
    expect((await client.list('recent', 0)).entries[0].stars).toBe(0)
  })

  it('says so rather than failing silently on an entry that is gone', async () => {
    await expect(gallery().star('nope')).rejects.toThrow()
  })
})

describe('withdrawing', () => {
  it('is offered on an entry this browser published', async () => {
    const client = gallery()
    await client.publish({ code: CODE, name: 'Thing', author: 'nick' })
    expect((await client.list('recent', 0)).entries[0].mine).toBe(true)
  })

  it('removes it', async () => {
    const client = gallery()
    const entry = await client.publish({ code: CODE, name: 'Thing', author: 'nick' })
    await client.remove(entry.id)
    expect((await client.list('recent', 0)).entries).toHaveLength(0)
  })

  it('stops being offered after a day, so the wall settles', async () => {
    const client = gallery()
    await client.publish({ code: CODE, name: 'Thing', author: 'nick' })
    clock += WITHDRAW_WINDOW_MS + 1
    expect((await client.list('recent', 0)).entries[0].mine).toBe(false)
  })

  it('refuses once the window has closed, rather than quietly doing it anyway', async () => {
    const client = gallery()
    const entry = await client.publish({ code: CODE, name: 'Thing', author: 'nick' })
    clock += WITHDRAW_WINDOW_MS + 1
    await expect(client.remove(entry.id)).rejects.toThrow(/day/i)
  })

  it('is not offered on an entry somebody else published', async () => {
    const client = gallery()
    const entry = await client.publish({ code: CODE, name: 'Thing', author: 'nick' })
    // A different browser: same storage in a test, different publisher id.
    localStorage.setItem('castillon.gallery.publisher', 'p-someone-else')
    expect((await client.list('recent', 0)).entries[0].mine).toBe(false)
    await expect(client.remove(entry.id)).rejects.toThrow(/someone else/i)
  })
})
