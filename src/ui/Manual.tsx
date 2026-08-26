import { useEffect, useMemo, useRef, useState } from 'react'
import { LANGUAGE_LABELS, LANGUAGES, useLanguage } from '../help/language'
import { MANUAL } from '../help/manual'
import { alsoMentionedIn, findTerms, MIN_QUERY } from '../help/search'

/**
 * The manual, as a window over the app.
 *
 * The same shape as the gallery and for the same reason (PLAN §12.5): no route, no second page, and the
 * patch you were building is still underneath when you close it. A manual you have to navigate away
 * from is one you read once.
 *
 * Only the manual has a language. The interface stays in English — its labels are three words each and
 * technical, and translating `DIV` would make it longer without making it clearer. Prose is the part
 * that needs a language, so prose is the part that has one.
 */
export function Manual({ onClose }: { onClose: () => void }) {
  const language = useLanguage((s) => s.language)
  const setLanguage = useLanguage((s) => s.set)
  const closer = useRef<HTMLButtonElement>(null)
  const body = useRef<HTMLDivElement>(null)

  /**
   * Which section has been opened out, if any.
   *
   * One at a time and in place of the list rather than expanded inside it. Detail folded into a long page
   * pushes everything after it out of reach, and the reader loses where they were; replacing the page
   * keeps both views short and makes going back a single thing to press.
   */
  const [opened, setOpened] = useState<string | null>(null)
  const section = opened ? MANUAL.find((one) => one.id === opened) : null

  /**
   * Looking something up, which is a different act from reading and gets a different view.
   *
   * It takes over the body rather than filtering the page underneath, because the two are answers to
   * different questions and showing both at once would answer neither: a reader who typed a word wants
   * that word, and a page that merely dimmed everything else still has everything else on it.
   */
  const [query, setQuery] = useState('')
  const searching = query.trim().length >= MIN_QUERY
  const results = useMemo(() => (searching ? findTerms(query) : []), [query, searching])
  const elsewhere = useMemo(() => (searching ? alsoMentionedIn(query) : []), [query, searching])

  /*
   * Focus lands on the way in, and **only** on the way in.
   *
   * It used to share an effect with the key handler below, which needs the current query — so adding
   * the search meant `query` joined this effect's dependencies and every keystroke pulled the caret out
   * of the box and onto CLOSE. Typing two letters took three clicks. Two concerns in one effect, and
   * the dependency list is where that stops being free.
   */
  useEffect(() => {
    closer.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      /*
       * Escape lets go of one thing at a time, outermost last: the search, then the page, then the
       * manual. A key that closed everything would make a mistyped word cost the whole book.
       */
      if (event.key !== 'Escape') return
      if (query) setQuery('')
      else if (opened) setOpened(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, opened, query])

  // Back to the top on the way in and on the way out: arriving halfway down a page nobody scrolled is
  // disorienting, and returning to the list at the depth of a page that is gone is worse.
  useEffect(() => {
    // Assigned rather than scrolled: `scrollTo` is not on every element everywhere, and this needs no
    // animation — the page it would animate across has already been replaced.
    if (body.current) body.current.scrollTop = 0
  }, [opened, searching])

  return (
    // The backdrop closes on its own click, but not on one that started inside.
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal manual"
        role="dialog"
        aria-modal="true"
        aria-label="Manual"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="gallery-head">
          <h2>MANUAL</h2>
          {/* In the header for the same reason BACK is: the header does not scroll and the body does, so
              a box in the body would be reachable at the top of a page and gone by the bottom — which is
              where somebody who has read enough and wants to look one thing up actually is. */}
          <input
            type="search"
            className="manual-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={language === 'es' ? 'Buscar un término' : 'Look up a term'}
            aria-label={language === 'es' ? 'Buscar en el manual' : 'Search the manual'}
          />
          {/* A toggle rather than two buttons: choosing a language is one decision with two answers,
              and two full-sized buttons gave it the weight of a section heading. */}
          <div className="language-toggle" role="group" aria-label="Manual language">
            {LANGUAGES.map((option) => (
              <button
                key={option}
                type="button"
                className={language === option ? 'on' : ''}
                onClick={() => setLanguage(option)}
                aria-pressed={language === option}
              >
                {LANGUAGE_LABELS[option]}
              </button>
            ))}
          </div>
          {/* Beside CLOSE rather than above the text, and for one reason that settles it: the header
              does not scroll and the body does. In the body it was reachable at the top of a detail page
              and gone by the bottom, which is where somebody who has read enough actually is.

              A word and not a glyph, because every other control here is a word — an arrow and a cross
              would be the only two symbols in the interface, and an unlabelled icon asks the reader to
              guess, which is a poor thing to ask of the beginner this page exists for. The arrow stays
              in front of it: direction from the symbol, certainty from the word. */}
          {section && !searching && (
            <button type="button" className="manual-back" onClick={() => setOpened(null)}>
              {language === 'es' ? '\u2190 VOLVER' : '\u2190 BACK'}
            </button>
          )}
          <button ref={closer} type="button" className="manual-close" onClick={onClose}>
            CLOSE
          </button>
        </header>

        {/* `lang` on the scrolling body rather than on every paragraph: it is what tells a screen
            reader which voice to read in, and hyphenation which rules to use. */}
        <div className="manual-body" lang={language} ref={body}>
          {searching ? (
            <section className="manual-results">
              {results.length === 0 && elsewhere.length === 0 && (
                <p className="manual-empty">
                  {language === 'es'
                    ? 'Nada con ese nombre. Prueba con la palabra que aparece en el panel.'
                    : 'Nothing by that name. Try the word as the panel spells it.'}
                </p>
              )}

              {/* The answers: the entry itself, whole, because the question was "what is this thing" and
                  a link to a chapter is not a reply to that. */}
              <dl>
                {results.map((hit, i) => (
                  <div key={i}>
                    <dt>
                      {hit.term.term[language]}
                      {/* Where it came from, which is the reader's way on: a term is often clearer with
                          the page around it, and this is how to go and get it. */}
                      <button
                        type="button"
                        className="manual-from"
                        onClick={() => {
                          setOpened(hit.sectionId)
                          setQuery('')
                        }}
                      >
                        {hit.sectionTitle[language]}
                      </button>
                    </dt>
                    <dd>{hit.term.text[language]}</dd>
                  </div>
                ))}
              </dl>

              {/* And the chapters that merely use the word — somewhere to look, kept apart from the
                  answers so one exact hit is never buried under every paragraph that mentions it. */}
              {elsewhere.length > 0 && (
                <div className="manual-elsewhere">
                  <h4>{language === 'es' ? 'También se menciona en' : 'Also mentioned in'}</h4>
                  {elsewhere.map((one) => (
                    <button
                      key={one.id}
                      type="button"
                      className="manual-more"
                      onClick={() => {
                        setOpened(one.id)
                        setQuery('')
                      }}
                    >
                      {one.title[language]}
                    </button>
                  ))}
                </div>
              )}
            </section>
          ) : section ? (
            <section>
              <h3>{section.title[language]}</h3>
              {/* Grouped under the same headings the panel uses, which is what makes reading the manual
                  and looking at the panel the same act. A chapter with twenty controls in one flat list
                  is a list; the same twenty under SEQUENCE, VOICE, SHAPE, FILTER and NEXT is the panel.

                  The headings are not translated: they are words printed on the screen, and a manual
                  naming a group the panel does not have would be worse than one in the wrong language. */}
              {(section.detail ?? []).map((group, g) => (
                <div key={g} className="manual-group">
                  {group.title && <h4>{group.title}</h4>}
                  <dl>
                    {group.terms.map((term, i) => (
                      <div key={i}>
                        <dt>{term.term[language]}</dt>
                        <dd>{term.text[language]}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </section>
          ) : (
            MANUAL.map((one) => (
              <section key={one.id}>
                <h3>{one.title[language]}</h3>
                {one.body.map((passage, i) => (
                  <p key={i}>{passage[language]}</p>
                ))}
                {one.terms && (
                  <dl>
                    {one.terms.map((term, i) => (
                      <div key={i}>
                        <dt>{term.term[language]}</dt>
                        <dd>{term.text[language]}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {/* Only where there is more to read. A button that opens an empty page teaches the reader
                    to stop pressing them. */}
                {one.detail && one.detail.length > 0 && (
                  <button type="button" className="manual-more" onClick={() => setOpened(one.id)}>
                    {language === 'es' ? 'Leer más \u2192' : 'Read more \u2192'}
                  </button>
                )}
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
