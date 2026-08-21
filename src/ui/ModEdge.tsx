import { getBezierPath, type EdgeProps } from '@xyflow/react'
import { PULSE_RATE_CEILING } from '../audio/modulation'
import { usePatchStore } from '../state/patchStore'
import { useNodeActivity } from '../viz/useActivity'
import type { ModParams } from '../types/patch'

/**
 * A modulation cable. Grey while the thing it drives is quiet, breathing grey-to-white while it works.
 *
 * Three states, the same three the FX node has and for the same reason: a cable that pulses the moment
 * it is drawn says something false — that modulation is happening — when the destination is silent.
 * Nothing is being shaped until there is something to shape.
 *
 * The pulse runs at the modulator's rate, so one cycle of the cable is one cycle of the LFO. Above
 * `PULSE_RATE_CEILING` it stops accelerating and stays lit (PLAN §18.6): nobody sees twenty cycles a
 * second, and a strobe reads as broken rather than as fast.
 *
 * Told apart from an audio cable by behaviour rather than colour, since colour already means cascade
 * depth. Event cables flow, audio cables glow, these breathe.
 */
export function ModEdge({
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  // A number, not the node: this repaints when the rate moves and not when anything else does.
  const rate = usePatchStore((s) => {
    const params = s.nodes.find((node) => node.id === source)?.data.params as ModParams | undefined
    return params?.rate ?? 2
  })

  // Keyed off the destination, not the modulator: what makes this cable matter is whether the thing
  // at the far end is sounding.
  const { pulsing: live } = useNodeActivity(target)

  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  const tooFast = rate > PULSE_RATE_CEILING
  const breathing = live && !tooFast

  return (
    <>
      <path d={path} className="edge-hit" fill="none">
        <title>Click to remove</title>
      </path>
      <path
        d={path}
        className={`edge-mod${live ? ' active' : ''}${breathing ? ' breathing' : ''}`}
        // One cycle of the cable is one cycle of the modulator, which is the whole point of showing it.
        style={breathing ? { animationDuration: `${1 / rate}s` } : undefined}
        fill="none"
      />
    </>
  )
}
