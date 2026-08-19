/**
 * The isotype: one trigger, two branches, falling.
 *
 * Three nodes and two cables is the reduction that still reads at a favicon's size — the mark has
 * to work in a tab strip, and anything with more interior detail turns to grey there. The cables
 * are curved rather than straight because the canvas draws beziers: a straight-edged mark would
 * describe a tidier program than the one that exists.
 *
 * It takes its colour from `currentColor`, so the titlebar paints it white and anything else can
 * paint it with a cascade hue without a second copy of the geometry.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="11" strokeLinecap="round">
        <path d="M 42 27 C 33 41 27 56 24 65" />
        <path d="M 58 27 C 67 41 73 56 76 65" />
      </g>
      <g fill="currentColor">
        <circle cx="50" cy="17" r="13" />
        <circle cx="21" cy="79" r="13" />
        <circle cx="79" cy="79" r="13" />
      </g>
    </svg>
  )
}
