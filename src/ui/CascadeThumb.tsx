import { layoutThumb, THUMB_NODE_SIZE } from '../gallery/thumb'
import type { Patch } from '../types/patch'

/**
 * A patch drawn small: its cascade, in the same depth colours the canvas uses.
 *
 * Squares for nodes, matching the isotype, and straight lines for cables rather than the canvas's
 * beziers — at this size a curve costs detail and buys nothing. Audio cables are dimmed, since they
 * are not part of the descent and would otherwise read as extra branches.
 */
export function CascadeThumb({ patch }: { patch: Patch }) {
  const thumb = layoutThumb(patch)
  const half = THUMB_NODE_SIZE / 2

  return (
    <svg
      className="thumb"
      viewBox={`0 0 ${thumb.size} ${thumb.size}`}
      aria-hidden="true"
      focusable="false"
    >
      {thumb.cables.map((cable, i) => (
        <line
          key={i}
          x1={cable.x1}
          y1={cable.y1}
          x2={cable.x2}
          y2={cable.y2}
          stroke={cable.audio ? 'var(--border-strong)' : cable.color}
          strokeWidth={cable.audio ? 1 : 1.6}
        />
      ))}
      {thumb.nodes.map((node, i) => (
        <rect
          key={i}
          x={node.x - half}
          y={node.y - half}
          width={THUMB_NODE_SIZE}
          height={THUMB_NODE_SIZE}
          fill={node.color}
        />
      ))}
    </svg>
  )
}
