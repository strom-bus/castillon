import { useHistoryStore } from '../history/patchHistory'

/**
 * Undo and redo, beside Reset because all three undo work of one kind or another.
 *
 * Drawn rather than imported: every other icon here is a few strokes of its own, and a set from a
 * library would arrive with a licence and an attribution for two arrows.
 *
 * Dimmed and unclickable when there is nothing to go back to, which is the only way to see that the
 * history is empty — the keystroke gives no answer at all when it does nothing.
 */

/** A left-pointing arrow whose tail curves up. Mirrored for redo, so the pair cannot disagree. */
function Arrow({ mirrored }: { mirrored?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        transform={mirrored ? 'translate(20 0) scale(-1 1)' : undefined}
      >
        <path d="M 4.5 12 H 11" />
        <path d="M 11 12 A 4.5 4.5 0 0 1 15.5 7.5" />
        <path d="M 8 8.5 L 4.5 12 L 8 15.5" />
      </g>
    </svg>
  )
}

export function UndoRedo() {
  const undo = useHistoryStore((s) => s.undo)
  const redo = useHistoryStore((s) => s.redo)
  const canUndo = useHistoryStore((s) => s.canUndo)
  const canRedo = useHistoryStore((s) => s.canRedo)

  return (
    <>
      <button
        type="button"
        className="btn btn-icon"
        onClick={undo}
        disabled={!canUndo}
        aria-label="Undo"
        title="Undo (Cmd+Z)"
      >
        <Arrow />
      </button>
      <button
        type="button"
        className="btn btn-icon"
        onClick={redo}
        disabled={!canRedo}
        aria-label="Redo"
        title="Redo (Cmd+Shift+Z)"
      >
        <Arrow mirrored />
      </button>
    </>
  )
}
