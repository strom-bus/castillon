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
  const { active, up } = useEdgeActivity(id)
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
      {/* A wide transparent stroke: without it a 2 px bezier is almost impossible to click.
          It comes first so the visible strokes below can react to hovering it. */}
      <path d={path} className="edge-hit" fill="none">
        <title>Click to remove</title>
      </path>
      {/* Inline styles, not attributes: a stylesheet rule would win over an attribute. */}
      <path d={path} className="edge-base" style={{ stroke: `url(#${gradientId})` }} fill="none" />
      {/* `climbing` runs the same dash animation in reverse, so the pulse travels from the target back to
          the source — which is the way the trigger actually went. The class is on the pulse and not on
          the cable because the same cable carries both waves in a patch wired from both Ignite ports. */}
      <path
        d={path}
        className={`edge-pulse${active ? ' active' : ''}${up ? ' climbing' : ''}`}
        style={{ stroke: `url(#${gradientId})` }}
        fill="none"
      />
    </>
  )
}
