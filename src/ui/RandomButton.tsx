import { usePatchStore } from '../state/patchStore'

/** Flat, five pips, drawn rather than fetched — there is no asset pipeline here and no need for one. */
function DiceIcon() {
  const pips = [
    [5, 5],
    [15, 5],
    [10, 10],
    [5, 15],
    [15, 15],
  ]
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect
        x="1"
        y="1"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {pips.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" fill="currentColor" />
      ))}
    </svg>
  )
}

/**
 * Rolls a whole patch.
 *
 * It sits in the canvas rather than the transport because what it does is replace the thing on the
 * canvas — and because the transport is for what you touch while a patch plays, which this is not.
 *
 * It used to ask first, and no longer does. A confirmation is a question people learn to dismiss
 * without reading; undo is an answer they can give after seeing the result. Rolling the die is the
 * most destructive thing here and also the one most worth doing on impulse, and asking made it
 * neither.
 */
export function RandomButton() {
  const randomisePatch = usePatchStore((s) => s.randomisePatch)

  return (
    <button
      type="button"
      className="btn btn-icon"
      onClick={randomisePatch}
      aria-label="Random patch"
      title="Roll a random patch"
    >
      <DiceIcon />
    </button>
  )
}
