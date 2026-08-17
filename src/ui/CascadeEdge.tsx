import { getBezierPath, type EdgeProps } from '@xyflow/react'
import { useEdgeColors } from '../viz/depth'
import { useEdgeActivity } from '../viz/useActivity'

/**
 * Event cable. Two stacked strokes: a dim resting one and a bright pulse that runs along it
 * when a trigger passes.
 *
 * Both are painted with an SVG gradient going from the source node's outgoing hue to the
 * target's incoming one, which is what makes the cascade read as a continuous sweep of colour
 * rather than a stack of flat levels.
 */
export function CascadeEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const active = useEdgeActivity(id)
  const { from, to } = useEdgeColors(source, target)
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  const gradientId = `cascade-gradient-${id}`

  return (
    <>
      <defs>
        {/* userSpaceOnUse so the gradient follows the cable's real endpoints on the canvas. */}
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
      </defs>
      {/* Inline styles, not attributes: a stylesheet rule would win over an attribute. */}
      <path d={path} className="edge-base" style={{ stroke: `url(#${gradientId})` }} fill="none" />
      <path
        d={path}
        className={`edge-pulse${active ? ' active' : ''}`}
        style={{ stroke: `url(#${gradientId})` }}
        fill="none"
      />
    </>
  )
}
