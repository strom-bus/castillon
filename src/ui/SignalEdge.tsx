import { getBezierPath, type EdgeProps } from '@xyflow/react'
import { useNodeActivity } from '../viz/useActivity'

/**
 * An audio cable. Grey while idle, white while its oscillator sounds.
 *
 * It brightens but does not flow, and that distinction is the point: something is passing through
 * it, so it should not look dead — but nothing *discrete* is passing, so a travelling pulse would
 * say something false about what it carries. Event cables flow; audio cables glow.
 */
export function SignalEdge({
  source,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  // Keyed off the oscillator feeding it, which is what is actually putting signal on the cable.
  const { pulsing: live } = useNodeActivity(source)
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
      <path d={path} className={`edge-signal${live ? ' active' : ''}`} fill="none" />
    </>
  )
}
