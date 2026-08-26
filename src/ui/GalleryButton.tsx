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
    >
      {/*
       * The word slides out from under the icon on a hover, leftwards into the empty half of the
       * titlebar. Hidden from readers rather than announced: the button already has an accessible name
       * and this is the same word said twice.
       *
       * Before the icon in the markup so that it reads in the order it appears once it is out — the
       * label then the mark — though it is taken out of the flow and placed by the stylesheet, so the
       * order here changes nothing on screen.
       *
       * The `title` that used to be here is gone. A native tooltip would arrive a second after this
       * one, in the operating system's own type, saying the same thing in different words.
       */}
      <span className="gallery-label" aria-hidden="true">
        Gallery
      </span>
      <GridIcon />
    </button>
  )
}
