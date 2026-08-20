/**
 * A way into the patch gallery (PLAN §12).
 *
 * Four squares rather than a picture of anything: the mark's nodes are squares now, so a grid of
 * them reads as many patches in the project's own vocabulary. Flat and filled, in the same orange as
 * the wordmark's `_ON`, which is the deepest colour on the cascade ramp.
 *
 * Orange rather than the chrome's white because it is the one thing in the titlebar that leads
 * somewhere rather than doing something.
 */
function GridIcon() {
  const cells = [
    [1, 1],
    [11, 1],
    [1, 11],
    [11, 11],
  ]
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="8" height="8" fill="currentColor" />
      ))}
    </svg>
  )
}

export function GalleryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn btn-icon gallery-button"
      onClick={onClick}
      aria-label="Patch gallery"
      title="Browse shared patches"
    >
      <GridIcon />
    </button>
  )
}
