import { useEffect, useRef, useState } from 'react'
import { LANGUAGE_LABELS, LANGUAGES, useLanguage } from '../help/language'
import { MANUAL } from '../help/manual'

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

  useEffect(() => {
    closer.current?.focus()
    function onKey(event: KeyboardEvent) {
      // Escape steps back out of a section first, and only closes the manual from the list. Otherwise
      // reading one page costs the whole manual to leave.
      if (event.key !== 'Escape') return
      if (opened) setOpened(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, opened])

  // Back to the top on the way in and on the way out: arriving halfway down a page nobody scrolled is
  // disorienting, and returning to the list at the depth of a page that is gone is worse.
  useEffect(() => {
    // Assigned rather than scrolled: `scrollTo` is not on every element everywhere, and this needs no
    // animation — the page it would animate across has already been replaced.
    if (body.current) body.current.scrollTop = 0
  }, [opened])

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
          {section && (
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
          {section ? (
            <section>
              <h3>{section.title[language]}</h3>
              <dl>
                {(section.detail ?? []).map((term, i) => (
                  <div key={i}>
                    <dt>{term.term[language]}</dt>
                    <dd>{term.text[language]}</dd>
                  </div>
                ))}
              </dl>
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
