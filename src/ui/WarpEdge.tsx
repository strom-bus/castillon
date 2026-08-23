import { getBezierPath, type EdgeProps } from '@xyflow/react'

/**
 * A warp cable: dashed, and still.
 *
 * It reused the modulation cable at first and inherited its breathing, which said something untrue.
 * A modulation cable breathes because a modulator is moving — one cycle of the cable is one cycle of
 * the LFO, which is the whole reason to draw it that way. A warp does not move. It is a standing offset,
 * applying whether or not anything is playing and staying at whatever it is set to, so a cable that
 * pulsed would be showing a rhythm that does not exist.
 *
 * Told apart from modulation by the dash rather than by colour, since colour already means cascade
 * depth: a modulation cable is dotted and breathes, this one is dashed and does not. Event cables flow,
 * audio cables glow, modulation breathes, and a warp simply holds.
 */
export function WarpEdge({
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

  // Nothing is subscribed to here, which is the point: there is no state this cable could be in other
  // than attached. A component that watched the destination would repaint on every note for nothing.
  return (
    <>
      <path d={path} className="edge-hit" fill="none">
        <title>Click to remove</title>
      </path>
      <path d={path} className="edge-warp" fill="none" />
    </>
  )
}
