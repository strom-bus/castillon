import { describe, expect, it } from 'vitest'
import {
  looksLikeShortCode,
  MAX_SHORT_CODE_LENGTH,
  normaliseShortCode,
  SHORT_CODE_LENGTH,
  shortCodeFor,
} from './shortCode'

const A = 'FGIQEgpMEAoUjldc0HbM1XqhPKABj83frJQY8HXlj66zpANAA0AMZlOZRUEBQwEMjxA'
const B = 'FGIQEgpMEAoUjldc0HbM1XqhPKABj83frJQY8HXlj66zpANAA0AMZlOZRUEBQwEMjxB'

describe('shortCodeFor', () => {
  it('is the length asked for', () => {
    expect(shortCodeFor(A)).toHaveLength(SHORT_CODE_LENGTH)
    expect(shortCodeFor(A, 8)).toHaveLength(8)
  })

  it('gives the same patch the same code, every time', () => {
    // The property the whole design rests on: sharing twice creates nothing new.
    expect(shortCodeFor(A)).toBe(shortCodeFor(A))
  })

  it('changes when the patch changes, down to a single character', () => {
    expect(shortCodeFor(A)).not.toBe(shortCodeFor(B))
  })

  it('ignores surrounding whitespace, since codes get pasted', () => {
    expect(shortCodeFor(`  ${A}\n`)).toBe(shortCodeFor(A))
  })

  it('uses only characters that survive being read aloud', () => {
    // Crockford's alphabet: no I, L, O or U, so there is no 0/O or 1/l to get wrong.
    for (const seed of [A, B, 'x', '', 'a'.repeat(500)]) {
      expect(shortCodeFor(seed, MAX_SHORT_CODE_LENGTH)).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/)
    }
  })

  it('extends by adding characters rather than starting over', () => {
    // The service settles a collision by asking for one more character, so a longer code has to
    // still begin with the shorter one.
    expect(shortCodeFor(A, 8).startsWith(shortCodeFor(A, 6))).toBe(true)
    expect(shortCodeFor(A, 10).startsWith(shortCodeFor(A, 8))).toBe(true)
  })

  it('spreads codes out rather than clustering them', () => {
    // A hash that bunched up would make collisions common enough to notice.
    const codes = new Set(Array.from({ length: 2000 }, (_, i) => shortCodeFor(`${A}${i}`)))
    expect(codes.size).toBe(2000)
  })

  it('does not run out of hash on a long code', () => {
    const long = shortCodeFor(A, MAX_SHORT_CODE_LENGTH)
    expect(long).toHaveLength(MAX_SHORT_CODE_LENGTH)
    expect(new Set(long).size).toBeGreaterThan(1)
  })
})

describe('telling the two kinds of code apart', () => {
  it('recognises a short code', () => {
    expect(looksLikeShortCode(shortCodeFor(A))).toBe(true)
    expect(looksLikeShortCode(` ${shortCodeFor(A).toLowerCase()} `)).toBe(true)
  })

  it('does not mistake a patch code for one', () => {
    // A patch code is long and uses characters the alphabet leaves out.
    expect(looksLikeShortCode(A)).toBe(false)
  })

  it('rejects anything too short or too long to be one', () => {
    expect(looksLikeShortCode('ABC')).toBe(false)
    expect(looksLikeShortCode('A'.repeat(MAX_SHORT_CODE_LENGTH + 1))).toBe(false)
  })

  it('rejects characters outside the alphabet', () => {
    expect(looksLikeShortCode('ABC-DE')).toBe(false)
    expect(looksLikeShortCode('ABC_DE')).toBe(false)
  })
})

describe('normaliseShortCode', () => {
  it('accepts the letters someone would type for the digits', () => {
    // Crockford's point: read aloud, "one" and "zero" get written as letters.
    expect(normaliseShortCode('k7m2ox')).toBe('K7M20X')
    expect(normaliseShortCode('K7M2IX')).toBe('K7M21X')
    expect(normaliseShortCode('K7M2LX')).toBe('K7M21X')
    expect(normaliseShortCode('K7M2UX')).toBe('K7M2VX')
  })

  it('leaves a code that was already right alone', () => {
    const code = shortCodeFor(A)
    expect(normaliseShortCode(code)).toBe(code)
  })
})
