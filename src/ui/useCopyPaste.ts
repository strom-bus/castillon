import { useEffect } from 'react'
import { usePatchStore } from '../state/patchStore'

/**
 * Where the caret is decides whose copy this is.
 *
 * Selecting a patch code and pressing Cmd+C has to copy the text, not the node behind it. Anything
 * typeable gets the keystroke, and the canvas only takes what is left.
 */
function editing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** Cmd on a Mac, Ctrl everywhere else. */
function withModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey
}

export function useCopyPaste(): void {
  const copySelection = usePatchStore((s) => s.copySelection)
  const pasteClipboard = usePatchStore((s) => s.pasteClipboard)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!withModifier(event) || event.altKey) return
      if (editing(event.target)) return

      const key = event.key.toLowerCase()
      if (key === 'c') {
        copySelection()
      } else if (key === 'v') {
        pasteClipboard()
      } else {
        return
      }
      // Only once we have acted: a keystroke we ignored belongs to the browser.
      event.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [copySelection, pasteClipboard])
}
