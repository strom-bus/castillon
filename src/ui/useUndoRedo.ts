import { useEffect } from 'react'
import { useHistoryStore } from '../history/patchHistory'
import { editing, withModifier } from './keys'

/**
 * Cmd+Z and Cmd+Shift+Z, with Ctrl+Y for the Windows habit.
 *
 * Keyboard only, and deliberately: this is the one shortcut everybody already knows, and a pair of
 * buttons would put a third job back into a transport row that was just cleared of two (§13).
 *
 * Undo has to lose to a text field the same way copy does. Cmd+Z inside the patch code should undo
 * the typing, not the last thing done to the patch — the browser already handles the former and
 * would be overruled without this.
 */
export function useUndoRedo(): void {
  const undo = useHistoryStore((s) => s.undo)
  const redo = useHistoryStore((s) => s.redo)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!withModifier(event) || event.altKey) return
      if (editing(event.target)) return

      const key = event.key.toLowerCase()
      if (key === 'z') {
        // Shift+Z is redo on every platform that has undo on Z.
        if (event.shiftKey) redo()
        else undo()
      } else if (key === 'y') {
        redo()
      } else {
        return
      }
      event.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [redo, undo])
}
