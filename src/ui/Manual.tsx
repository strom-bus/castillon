import { useEffect, useRef } from 'react'
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

  useEffect(() => {
    closer.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
          <div className="gallery-sort">
            {LANGUAGES.map((option) => (
              <button
                key={option}
                type="button"
                className={`btn${language === option ? ' on' : ''}`}
                onClick={() => setLanguage(option)}
                // Each in its own name: somebody looking for Spanish is looking for "Español".
                lang={option}
              >
                {LANGUAGE_LABELS[option]}
              </button>
            ))}
          </div>
          <button ref={closer} type="button" className="btn" onClick={onClose}>
            CLOSE
          </button>
        </header>

        {/* `lang` on the scrolling body rather than on every paragraph: it is what tells a screen
            reader which voice to read in, and hyphenation which rules to use. */}
        <div className="manual-body" lang={language}>
          {MANUAL.map((section) => (
            <section key={section.id}>
              <h3>{section.title[language]}</h3>
              {section.body.map((passage, i) => (
                <p key={i}>{passage[language]}</p>
              ))}
              {section.terms && (
                <dl>
                  {section.terms.map((term, i) => (
                    <div key={i}>
                      <dt>{term.term[language]}</dt>
                      <dd>{term.text[language]}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
