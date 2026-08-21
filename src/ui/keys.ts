import { noteName } from '../audio/clock'
import type { IgniteBinding } from '../types/patch'
/**
 * Shared rules for keyboard shortcuts.
 *
 * Extracted so the copy/paste and undo hooks decide the same way. Two hooks each answering "is the
 * caret in a text field" is two chances to answer differently.
 */

/**
 * Where the caret is decides whose keystroke this is.
 *
 * Selecting a patch code and pressing Cmd+C has to copy the text, not the node behind it. Anything
 * typeable gets the keystroke, and the canvas only takes what is left.
 */
export function editing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** Cmd on a Mac, Ctrl everywhere else. */
export function withModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey
}

/**
 * A key code as somebody would say it: `KeyA` reads as A, `Digit4` as 4.
 *
 * Anything stranger keeps its own name — `BracketLeft` is ugly but unambiguous, and inventing a
 * prettier label for every key on every layout is a worse trade than showing the code.
 */
/**
 * What a binding says on screen, whichever kind it is.
 *
 * A key shows the letter on it and a note shows its name: `60` means nothing to anybody and `C4` means
 * exactly one thing. Beside `keyLabel` rather than beside the component that uses it, because a file
 * exporting both a component and a function breaks Fast Refresh — the same reason the logo's geometry
 * is a module of its own.
 */
export function bindingLabel(binding: IgniteBinding | null | undefined): string {
  if (!binding) return ''
  if (binding.source === 'midi') {
    const note = Number(binding.code)
    return Number.isFinite(note) ? noteName(note) : binding.code
  }
  return keyLabel(binding.code)
}

export function keyLabel(code: string | undefined | null): string {
  if (!code) return ''
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code === 'Space') return 'SPACE'
  return code
}
