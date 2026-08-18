import { getBezierPath, type EdgeProps } from '@xyflow/react'

/**
 * An audio cable. Static and grey, unlike the event cables.
 *
 * It carries no travelling pulse on purpose: nothing discrete happens on it. Audio is continuous,
 * so animating it would be saying something false about what it carries — and the contrast is what
 * makes the two graphs legible on one canvas.
 */
export function SignalEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  return (
    <>
      <path d={path} className="edge-hit" fill="none">
        <title>Click to remove</title>
      </path>
      <path d={path} className="edge-signal" fill="none" />
    </>
  )
}
