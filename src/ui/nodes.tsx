import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CSSProperties } from 'react'
import { FILTER_LABELS } from '../audio/filter'
import { WAVEFORM_LABELS } from '../audio/waveforms'
import { EFFECTS } from '../audio/effects'
import { DEFAULT_DELAY_MS } from '../nodes/registry'
import { AUDIO_LEFT, AUDIO_RIGHT, EVENT_IN, EVENT_OUT } from '../state/connections'
import { formatOrdinal, nodeOrdinal } from '../state/ordinals'
import { usePatchStore, type FlowNode } from '../state/patchStore'
import type { DelayParams, EffectKind, FxParams, OscParams } from '../types/patch'
import { useNodeColors, type NodeColors } from '../viz/depth'
import { useNodeActivity } from '../viz/useActivity'
import { StepBars } from './StepBars'

/**
 * The depth hues go in as local custom properties. `--accent` drives everything the node paints
 * with the accent colour, while `--depth-top` and `--depth-bottom` feed the gradient border,
 * so the hue flows through the node and continues into its outgoing cable.
 */
/**
 * The node's number within its kind. A selector returning a number rather than the node list, so a
 * node repaints when its own number changes and not whenever any node moves.
 */
function useOrdinal(id: string): string {
  return formatOrdinal(usePatchStore((s) => nodeOrdinal(s.nodes, id)))
}

function depthStyle(colors: NodeColors): CSSProperties {
  return {
    '--accent': colors.mid,
    '--depth-top': colors.top,
    '--depth-bottom': colors.bottom,
  } as CSSProperties
}

export function StartNode({ id, selected }: NodeProps<FlowNode>) {
  const { pulsing } = useNodeActivity(id)
  const colors = useNodeColors(id)
  const ordinal = useOrdinal(id)

  return (
    <div
      className={`node node-start${pulsing ? ' pulsing' : ''}${selected ? ' selected' : ''}`}
      style={depthStyle(colors)}
      data-testid="start-node"
    >
      <div className="node-title">
        IGNITE <span className="node-ordinal">{ordinal}</span>
      </div>
      <Handle type="source" id={EVENT_OUT} position={Position.Bottom} className="port port-out" />
    </div>
  )
}

export function OscNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { pulsing, currentStep } = useNodeActivity(id)
  const colors = useNodeColors(id)
  const ordinal = useOrdinal(id)
  const params = data.params as OscParams
  const waveform = params.waveform ?? 'square'
  const filter = FILTER_LABELS[params.filterType ?? 'off']

  return (
    <div
      className={`node node-osc${pulsing ? ' pulsing' : ''}${selected ? ' selected' : ''}`}
      style={depthStyle(colors)}
    >
      <Handle type="target" id={EVENT_IN} position={Position.Top} className="port port-in" />
      {/* Audio leaves on both sides, so an effect can sit wherever there is room and the cable
          stays short. Events run down the node, audio runs across it. */}
      <Handle type="source" id={AUDIO_LEFT} position={Position.Left} className="port port-audio" />
      <Handle
        type="source"
        id={AUDIO_RIGHT}
        position={Position.Right}
        className="port port-audio"
      />
      <div className="node-header">
        <span className="node-title">
          OSC <span className="node-ordinal">{ordinal}</span>
        </span>
        <span className="node-meta">
          {WAVEFORM_LABELS[waveform]}
          {filter && ` ${filter}`} · {params.division}
        </span>
      </div>
      <StepBars nodeId={id} steps={params.steps} currentStep={currentStep} />
      <Handle type="source" id={EVENT_OUT} position={Position.Bottom} className="port port-out" />
    </div>
  )
}

/**
 * An effect. Its dropdown lives in the node rather than only in the inspector, so what a node does
 * is readable without selecting it.
 *
 * White and grey rather than a cascade hue, and deliberately so: the colour is what says this is
 * not part of the cascade. It has no event ports at all — nothing triggers it, it processes
 * whatever passes through — so it lights up with whichever oscillators feed it.
 */
export function FxNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { pulsing } = useNodeActivity(id)
  const updateParams = usePatchStore((s) => s.updateParams)
  // A boolean rather than the edge list, so this only repaints when the answer actually flips.
  const wired = usePatchStore((s) =>
    s.edges.some((e) => e.target === id && e.data?.kind === 'audio'),
  )
  const ordinal = useOrdinal(id)
  const params = data.params as FxParams

  // Three states, and each has to be readable on its own: nothing attached, attached and waiting,
  // and passing signal. Told apart by weight in white and grey rather than by hue, since colour
  // here means cascade depth and an effect is not in the cascade.
  const state = pulsing ? ' active' : wired ? ' wired' : ' idle'

  return (
    <div
      className={`node node-fx${state}${pulsing ? ' pulsing' : ''}${selected ? ' selected' : ''}`}
    >
      <Handle type="target" id={AUDIO_LEFT} position={Position.Left} className="port port-audio" />
      <Handle
        type="target"
        id={AUDIO_RIGHT}
        position={Position.Right}
        className="port port-audio"
      />
      <div className="node-header">
        <span className="node-title">
          FX <span className="node-ordinal">{ordinal}</span>
        </span>
        <span className="node-meta">{Math.round((params.mix ?? 0.8) * 100)}%</span>
      </div>
      <div className="fx-body">
        <select
          className="nodrag nopan"
          value={params.effect ?? 'gain'}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => updateParams(id, { effect: e.target.value as EffectKind })}
        >
          {EFFECTS.map((effect) => (
            <option key={effect.kind} value={effect.kind}>
              {effect.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

export function DelayNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { pulsing, runId, duration } = useNodeActivity(id)
  const colors = useNodeColors(id)
  const ordinal = useOrdinal(id)
  const params = data.params as DelayParams
  const ms = params.delayMs ?? DEFAULT_DELAY_MS

  return (
    <div
      className={`node node-delay${pulsing ? ' pulsing' : ''}${selected ? ' selected' : ''}`}
      style={depthStyle(colors)}
    >
      <Handle type="target" id={EVENT_IN} position={Position.Top} className="port port-in" />
      <div className="node-header">
        <span className="node-title">
          DELAY <span className="node-ordinal">{ordinal}</span>
        </span>
        <span className="node-meta">ms</span>
      </div>
      <div className="delay-body">
        <span className="delay-value">{ms}</span>
        {/* Keyed by runId so the fill animation restarts from zero on every trigger. */}
        <div className="delay-track">
          {pulsing && (
            <div key={runId} className="delay-fill" style={{ animationDuration: `${duration}s` }} />
          )}
        </div>
      </div>
      <Handle type="source" id={EVENT_OUT} position={Position.Bottom} className="port port-out" />
    </div>
  )
}
