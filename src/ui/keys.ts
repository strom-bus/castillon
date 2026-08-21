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
export function keyLabel(code: string | undefined | null): string {
  if (!code) return ''
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code === 'Space') return 'SPACE'
  return code
}
