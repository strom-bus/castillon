import { detailTerms, MANUAL, type Passage, type Section, type Term } from './manual'

/**
 * Looking a term up in the manual, which is a different act from reading it.
 *
 * Somebody who opens the manual to *read* starts at the beginning. Somebody who opens it because a
 * control on screen says REPS and they do not know what that is wants **one answer**, not a chapter
 * with the answer inside it. So this searches the **names of things** rather than the prose, and
 * returns the entries themselves — the question is "what is this called thing", and the entry is the
 * whole reply.
 *
 * The prose is searched too, but separately and only as a list of chapters to go and look in. Mixed
 * into the same list it would bury the one exact answer under every paragraph that happens to use the
 * word, which is the failure mode of every search that treats all matches alike.
 */

export interface Found {
  sectionId: string
  sectionTitle: Passage
  term: Term
}

/** Shorter than this and every term in the book matches, which is a list rather than an answer. */
export const MIN_QUERY = 2

const norm = (text: string) =>
  text
    .toLowerCase()
    // Accents folded, so "posicion" finds "posición" — a search that demands the accent is one that
    // fails for exactly the readers the Spanish half is for.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/**
 * How well a name answers the query, lower being better.
 *
 * Three bands rather than a score: the same name, a name that begins with it, a name that contains it.
 * "Reps" must put REPS first even though Ratchet's text and several other names contain the letters,
 * and beyond those three distinctions there is nothing a reader would notice.
 */
function rank(name: string, query: string): number {
  const a = norm(name)
  const b = norm(query)
  if (a === b) return 0
  if (a.startsWith(b)) return 1
  return a.includes(b) ? 2 : Number.POSITIVE_INFINITY
}

/** Every entry whose name matches, best first, with the chapter it came from. */
export function findTerms(query: string): Found[] {
  if (query.trim().length < MIN_QUERY) return []

  const hits: { found: Found; rank: number }[] = []
  for (const section of MANUAL) {
    // Both the ones on the chapter's front page and the ones inside it: a reader looking up a name has
    // no idea which of the two it is, and the distinction is about layout rather than about meaning.
    for (const term of [...(section.terms ?? []), ...detailTerms(section)]) {
      // Either language, whichever the manual is being read in. A term is nearly always the interface's
      // own word and identical in both, so this costs nothing and rescues the case where it is not.
      const best = Math.min(rank(term.term.en, query), rank(term.term.es, query))
      if (Number.isFinite(best)) {
        hits.push({
          rank: best,
          found: { sectionId: section.id, sectionTitle: section.title, term },
        })
      }
    }
  }

  return hits.sort((a, b) => a.rank - b.rank).map((one) => one.found)
}

/**
 * Chapters whose prose uses the word without having an entry for it — somewhere to go and look rather
 * than an answer.
 *
 * Kept apart from the entries above, and kept as *chapters* rather than as passages: a paragraph out of
 * its page is a quotation, and a reader who needs context is worse off with a fragment than with a
 * pointer to where the fragment lives.
 */
export function alsoMentionedIn(query: string): Section[] {
  if (query.trim().length < MIN_QUERY) return []
  const answered = new Set(findTerms(query).map((one) => one.sectionId))

  return MANUAL.filter((section) => {
    if (answered.has(section.id)) return false
    const prose = [
      section.title.en,
      section.title.es,
      ...section.body.flatMap((one) => [one.en, one.es]),
      ...[...(section.terms ?? []), ...detailTerms(section)].flatMap((one) => [
        one.text.en,
        one.text.es,
      ]),
    ].join('\n')
    return norm(prose).includes(norm(query))
  })
}
