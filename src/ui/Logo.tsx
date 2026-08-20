import { CABLES, CABLE_WIDTH, NODES, NODE_RADIUS } from './logoGeometry'

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
 *
 * The coordinates live in `logoGeometry.ts` rather than in this markup, so the favicon's second copy
 * of the drawing can be checked against them.
 */

export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={CABLE_WIDTH}
        // Butt ends, not round: square nodes with rounded cables would be two minds about one
        // drawing. It also puts the mark inside §8's rule against rounded corners, which every
        // other surface in the app already follows.
        strokeLinecap="butt"
      >
        {CABLES.map((cable) => (
          <path key={cable} d={cable} />
        ))}
      </g>
      <g fill="currentColor">
        {NODES.map((node) => (
          <rect
            key={`${node.cx}-${node.cy}`}
            x={node.cx - NODE_RADIUS}
            y={node.cy - NODE_RADIUS}
            width={NODE_RADIUS * 2}
            height={NODE_RADIUS * 2}
          />
        ))}
      </g>
    </svg>
  )
}
