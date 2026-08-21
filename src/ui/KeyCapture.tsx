import { useEffect, useRef, useState } from 'react'
import { keyLabel } from './keys'

/**
 * Assigns a key by pressing it.
 *
 * Typing the name of a key is asking somebody to spell `BracketLeft`. Pressing it is the only way
 * anyone actually thinks about a binding, and it is how every program that binds keys does it.
 *
 * What is stored is the physical `code`, not the character: a binding lands on the same key on a
 * QWERTY and an AZERTY board rather than following the letter printed on it.
 */

export function KeyCapture({
  code,
  onChange,
}: {
  code: string | null
  onChange: (code: string | null) => void
}) {
  const [listening, setListening] = useState(false)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!listening) return

    function onKeyDown(event: KeyboardEvent) {
      event.preventDefault()
      event.stopPropagation()
      // Escape leaves it as it was; anything else becomes the binding.
      if (event.key !== 'Escape') onChange(event.code)
      setListening(false)
    }

    // Capture, so the binding is taken before the shortcut handlers and the bound Ignites themselves
    // see the keystroke — otherwise assigning a key would also fire whatever is already on it.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [listening, onChange])

  return (
    <div className="key-capture">
      <button
        ref={button}
        type="button"
        className={`btn${listening ? ' on' : ''}`}
        onClick={() => setListening((was) => !was)}
        // Blur ends it, so a click elsewhere is not swallowed as a binding.
        onBlur={() => setListening(false)}
        aria-label="Bound key"
      >
        {listening ? 'PRESS A KEY' : keyLabel(code) || 'NONE'}
      </button>
      {code && !listening && (
        <button
          type="button"
          className="btn btn-icon key-clear"
          onClick={() => onChange(null)}
          aria-label="Clear the key"
          title="Clear the key"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <g fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M 6 6 L 14 14" />
              <path d="M 14 6 L 6 14" />
            </g>
          </svg>
        </button>
      )}
    </div>
  )
}
