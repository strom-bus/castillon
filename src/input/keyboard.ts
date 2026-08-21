/**
 * The keyboard as a trigger source.
 *
 * Deliberately thin, and everything it knows is here: a `code` is the physical key, so a binding is
 * the same on a QWERTY and an AZERTY board rather than following the letter printed on it.
 *
 * It reuses the rule the other shortcuts follow — a keystroke belongs to a text field if the caret is
 * in one. Binding a key must not fire a cascade while somebody types a patch name.
 */
import { editing } from '../ui/keys'

export const KEY_SOURCE = 'key'

/** The identity a key answers to, matching what `bindingKey` builds from a stored binding. */
export function keyIdentity(code: string): string {
  return `${KEY_SOURCE}:${code}`
}

export interface KeyboardHandlers {
  press(identity: string): void
  release(identity: string): void
}

/**
 * Starts listening. Returns a teardown.
 *
 * Auto-repeat is dropped here rather than downstream: a held key emits `keydown` over and over, and
 * only the first of them is a press.
 */
export function listenToKeyboard(handlers: KeyboardHandlers): () => void {
  const down = new Set<string>()

  function onKeyDown(event: KeyboardEvent) {
    if (editing(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
    if (down.has(event.code)) return
    down.add(event.code)
    handlers.press(keyIdentity(event.code))
  }

  function onKeyUp(event: KeyboardEvent) {
    if (!down.delete(event.code)) return
    handlers.release(keyIdentity(event.code))
  }

  /**
   * A key held while the window loses focus never reports its release, so it would stay down for
   * ever — and a cascade bound to it would never stop.
   */
  function onBlur() {
    for (const code of [...down]) {
      down.delete(code)
      handlers.release(keyIdentity(code))
    }
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)

  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
  }
}
