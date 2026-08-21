import { useEffect, useRef, useState } from 'react'
import { learnFrom } from '../input/learn'
import type { IgniteBinding } from '../types/patch'
import { bindingLabel } from './keys'

/**
 * Assigns a trigger by playing it — a key, or a note on a MIDI keyboard.
 *
 * Typing the name of a key is asking somebody to spell `BracketLeft`. Pressing it is the only way
 * anyone actually thinks about a binding, and it is how every program that binds keys does it.
 *
 * **Whichever arrives first wins**, so there is no source to choose. That matters more than it looks:
 * a dropdown asking "keyboard or MIDI?" makes you answer a question you have already answered by
 * reaching for one of them.
 *
 * What a key stores is the physical `code`, not the character, so a binding lands on the same key on a
 * QWERTY and an AZERTY board. What a note stores is the note number and not the channel — a channel is
 * a setting most people never look at, and one that would otherwise produce a keyboard that had
 * mysteriously stopped working.
 */

export function BindingCapture({
  binding,
  onChange,
}: {
  binding: IgniteBinding | null
  onChange: (binding: IgniteBinding | null) => void
}) {
  const [listening, setListening] = useState(false)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!listening) return

    function onKeyDown(event: KeyboardEvent) {
      event.preventDefault()
      event.stopPropagation()
      // Escape leaves it as it was; anything else becomes the binding.
      if (event.key !== 'Escape') onChange({ source: 'key', code: event.code })
      setListening(false)
    }

    // Capture, so the binding is taken before the shortcut handlers and the bound Ignites themselves
    // see the keystroke — otherwise assigning a key would also fire whatever is already on it.
    window.addEventListener('keydown', onKeyDown, true)
    // And the same for a note, which has no DOM event to be taken before.
    learnFrom((identity) => {
      const [source, code] = identity.split(':')
      onChange({ source, code } as IgniteBinding)
      setListening(false)
    })

    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      learnFrom(null)
    }
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
        aria-label="Bound trigger"
      >
        {listening ? 'PRESS A KEY OR NOTE' : bindingLabel(binding) || 'NONE'}
      </button>
      {binding && !listening && (
        <button
          type="button"
          className="btn btn-icon key-clear"
          onClick={() => onChange(null)}
          aria-label="Clear the trigger"
          title="Clear the trigger"
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
