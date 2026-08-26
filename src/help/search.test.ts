import { describe, expect, it } from 'vitest'
import { MANUAL, detailTerms } from './manual'
import { alsoMentionedIn, findTerms, MIN_QUERY } from './search'

/**
 * Looking a term up, which is what somebody does when a control on screen says a word they do not know.
 *
 * The whole value is in what it *does not* return. A search that answers "reps" with the eleven
 * paragraphs containing those letters has technically found it and practically buried it, and that is
 * the failure this is shaped to avoid — names first, and the prose kept in a separate pile.
 */

describe('looking up a term', () => {
  it('answers a name with that name and nothing else', () => {
    // The case that motivated it: REPS is a word on the export panel and nowhere else in the language.
    const hits = findTerms('reps')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.term.term.en).toContain('REPS')
    expect(hits[0]!.sectionId).toBe('sharing')
  })

  it('gives the entry itself, not a pointer to a chapter', () => {
    // "What is this called thing" is answered by the entry. A link to the page it lives on is a
    // different, worse answer to the same question.
    const [hit] = findTerms('reps')
    expect(hit!.term.text.en.length).toBeGreaterThan(40)
    expect(hit!.term.text.es.length).toBeGreaterThan(40)
  })

  it('puts an exact name above one that merely contains it', () => {
    /*
     * Three bands rather than a score: the same name, a name that begins with it, a name that contains
     * it. Without the ranking, "Swing" answers with "Swing on an odd length" as readily as with Swing,
     * and the reader has to pick — which is the work they came here to avoid.
     */
    const hits = findTerms('swing').map((one) => one.term.term.en)
    expect(hits.length).toBeGreaterThan(1)
    expect(hits[0]).toBe('Swing')
  })

  it('finds a term in either language, whichever is being read', () => {
    // A term is nearly always the interface's own word and the same in both, and this rescues the ones
    // that are not — a reader typing what they see should find it whatever the manual is set to.
    const spanish = MANUAL.flatMap((s) => [...(s.terms ?? []), ...detailTerms(s)]).find(
      (t) => t.term.es !== t.term.en,
    )
    expect(spanish, 'no term differs between languages, so this checks nothing').toBeTruthy()
    expect(findTerms(spanish!.term.es).length).toBeGreaterThan(0)
    expect(findTerms(spanish!.term.en).length).toBeGreaterThan(0)
  })

  it('ignores an accent, in the direction that matters', () => {
    // Typing the accent is optional; a search that demanded it would fail for exactly the readers the
    // Spanish half exists for.
    const accented = MANUAL.flatMap((s) => [...(s.terms ?? []), ...detailTerms(s)]).find((t) =>
      /[áéíóúñ]/i.test(t.term.es),
    )
    if (!accented) return
    const plain = accented.term.es.normalize('NFD').replace(/[̀-ͯ]/g, '')
    expect(findTerms(plain).length).toBeGreaterThan(0)
  })

  it('says nothing at all until there is something to say', () => {
    // One letter matches most of the book, which is a list rather than an answer.
    expect(findTerms('c')).toEqual([])
    expect(findTerms(' ')).toEqual([])
    expect(MIN_QUERY).toBeGreaterThan(1)
  })
})

describe('the chapters that merely use a word', () => {
  it('offers somewhere to look when nothing is named that', () => {
    // A search that finds nothing is a dead end; a word used in the prose is at least a direction.
    expect(findTerms('darker')).toEqual([])
    expect(alsoMentionedIn('darker').length).toBeGreaterThan(0)
  })

  it('never repeats a chapter that already answered', () => {
    /*
     * The separation is the whole design. A chapter that holds the entry must not also appear under
     * "also mentioned in", or the one exact answer is immediately followed by a pointer back to itself.
     */
    const answered = new Set(findTerms('cutoff').map((one) => one.sectionId))
    expect(answered.size).toBeGreaterThan(0)
    for (const section of alsoMentionedIn('cutoff')) {
      expect(answered.has(section.id), `${section.id} both answers and is a pointer`).toBe(false)
    }
  })

  it('holds its tongue on a query too short to mean anything', () => {
    expect(alsoMentionedIn('a')).toEqual([])
  })
})
