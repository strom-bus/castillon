import { useEffect } from 'react'
import { usePatchStore } from '../state/patchStore'
import { editing, withModifier } from './keys'

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
