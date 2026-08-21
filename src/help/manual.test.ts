import { describe, expect, it } from 'vitest'
import { MANUAL, type Passage } from './manual'
import { preferredLanguage } from './language'

/**
 * That the manual says the same things in both languages.
 *
 * The two sit adjacent in one file precisely so a half-done edit is visible in the diff, and this is
 * the other half of that: a passage with one language empty, or one language much shorter than the
 * other, is a translation somebody started and did not finish. Neither would break the app — it would
 * simply have a blank where a paragraph belongs, which nobody would notice until a reader did.
 */

const passages = (): Passage[] =>
  MANUAL.flatMap((section) => [
    section.title,
    ...section.body,
    ...(section.terms ?? []).flatMap((term) => [term.term, term.text]),
  ])

describe('the manual', () => {
  it('has something to say in every section', () => {
    // A section with neither prose nor terms is a heading over nothing.
    for (const section of MANUAL) {
      expect(section.body.length + (section.terms?.length ?? 0)).toBeGreaterThan(0)
    }
  })

  it('says everything in both languages', () => {
    for (const passage of passages()) {
      expect(passage.en.trim().length, `English missing: ${passage.es}`).toBeGreaterThan(0)
      expect(passage.es.trim().length, `Spanish missing: ${passage.en}`).toBeGreaterThan(0)
    }
  })

  it('says roughly as much in one as in the other', () => {
    // The check that catches a translation left half-written. Generous — Spanish runs longer than
    // English and a term can legitimately be the same word in both — but a passage at a third of its
    // pair's length is a sentence somebody trimmed and forgot to finish.
    for (const passage of passages()) {
      const ratio = passage.es.length / passage.en.length
      expect(ratio, `lopsided: ${passage.en}`).toBeGreaterThan(0.5)
      expect(ratio, `lopsided: ${passage.en}`).toBeLessThan(2)
    }
  })

  it('starts with the idea the rest depends on', () => {
    // Order is the teaching. Somebody who does not know execution runs downward cannot make sense of
    // anything else in here.
    expect(MANUAL[0].id).toBe('idea')
  })

  it('gives every section its own id, since they key the rendered list', () => {
    const ids = MANUAL.map((section) => section.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('the language it opens in', () => {
  it('is one of the two, whatever the browser says', () => {
    expect(['en', 'es']).toContain(preferredLanguage())
  })
})
