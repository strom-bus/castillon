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
    // Detail included, and it is the larger half of the manual by weight. Left out, everything written
    // for a beginner could drift out of one language without a single test noticing — which is the exact
    // failure the two languages were put side by side to prevent.
    ...(section.detail ?? []).flatMap((term) => [term.term, term.text]),
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

  it('goes further on every section a beginner would need it on', () => {
    /*
     * Every section but one, and the exception earns it: shortcuts is already a list of specifics, so a
     * page behind a button would only be the same list again. The rest each hide the part somebody who
     * has never used a synthesiser needs — what each control actually does — from somebody who does not.
     */
    const without = MANUAL.filter((section) => !section.detail?.length).map((section) => section.id)
    expect(without).toEqual([])
  })

  it('spends the detail on controls rather than on more prose', () => {
    // It is a reference, and a reference is read by looking something up. Named entries can be scanned;
    // paragraphs have to be read from the top to find out whether they answer the question.
    for (const section of MANUAL) {
      for (const term of section.detail ?? []) {
        expect(term.term.en.length, `unnamed detail in ${section.id}`).toBeGreaterThan(0)
        expect(term.term.en.length, `heading not a name in ${section.id}`).toBeLessThan(40)
      }
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
  it('is English, whatever the browser is set to', () => {
    // Guessing from the locale was the first version and it is the wrong default: the interface around
    // the manual is in English, so opening in another language leaves somebody reading two at once.
    localStorage.clear()
    expect(preferredLanguage()).toBe('en')
  })

  it('is whatever was chosen last, once anything has been', () => {
    localStorage.setItem('castillon.manual.language', 'es')
    expect(preferredLanguage()).toBe('es')
    localStorage.clear()
  })

  it('ignores a stored value that is not a language', () => {
    localStorage.setItem('castillon.manual.language', 'klingon')
    expect(preferredLanguage()).toBe('en')
    localStorage.clear()
  })
})
