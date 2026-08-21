import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CSSProperties } from 'react'
import { FILTER_LABELS } from '../audio/filter'
import { WAVEFORM_LABELS } from '../audio/waveforms'
import { EFFECTS } from '../audio/effects'
import { DEFAULT_DELAY_MS } from '../nodes/registry'
import { EVENT_IN, EVENT_OUT, SIGNAL_LEFT, SIGNAL_RIGHT } from '../state/connections'
import { formatOrdinal, nodeOrdinal } from '../state/ordinals'
import { usePatchStore, type FlowNode } from '../state/patchStore'
import { targetOf } from '../audio/modulation'
import type {
  DelayParams,
  EffectKind,
  FxParams,
  ModParams,
  OscParams,
  StartParams,
} from '../types/patch'
import { useNodeColors, type NodeColors } from '../viz/depth'
import { useNodeActivity } from '../viz/useActivity'
import { keyLabel } from './keys'
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

export function StartNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { pulsing } = useNodeActivity(id)
  const colors = useNodeColors(id)
  const ordinal = useOrdinal(id)
  const params = data.params as StartParams
  // Shown on the node rather than only in the inspector: with several bound Ignites, which key is
  // which has to be readable without selecting each one to find out.
  const key = params.trigger === 'bound' ? keyLabel(params.binding?.code) || '—' : ''

  return (
    <div
      className={`node node-start${pulsing ? ' pulsing' : ''}${selected ? ' selected' : ''}`}
      style={depthStyle(colors)}
      data-testid="start-node"
    >
      <div className="node-title">
        IGNITE <span className="node-ordinal">{ordinal}</span>
        {key && <span className="node-key">{key}</span>}
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
      {/* One port per side, taking any signal cable either way: audio out to an effect, modulation
          in from a MOD. Which it is comes from what is at the other end. There is a port on each side
          so a neighbour can sit wherever there is room and the cable stays short. */}
      <Handle
        type="source"
        id={SIGNAL_LEFT}
        position={Position.Left}
        className="port port-signal"
      />
      <Handle
        type="source"
        id={SIGNAL_RIGHT}
        position={Position.Right}
        className="port port-signal"
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
  const setEffect = usePatchStore((s) => s.setEffect)
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
      <Handle
        type="source"
        id={SIGNAL_LEFT}
        position={Position.Left}
        className="port port-signal"
      />
      <Handle
        type="source"
        id={SIGNAL_RIGHT}
        position={Position.Right}
        className="port port-signal"
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
          onChange={(e) => setEffect(id, e.target.value as EffectKind)}
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

/**
 * A modulator.
 *
 * White and grey like the FX node and for the same reason: it is not part of the cascade, so a depth
 * hue would claim it was. What it shows is its rate, because that is the number that decides what the
 * patch sounds like and what its cable is doing.
 */
export function ModNode({ id, data, selected }: NodeProps<FlowNode>) {
  const wired = usePatchStore((s) => s.edges.some((e) => e.source === id && e.data?.kind === 'mod'))
  const ordinal = useOrdinal(id)
  const params = data.params as ModParams
  const rate = params.rate ?? 2
  const target = targetOf(params.target)

  return (
    <div className={`node node-mod${wired ? ' wired' : ' idle'}${selected ? ' selected' : ''}`}>
      <Handle
        type="source"
        id={SIGNAL_LEFT}
        position={Position.Left}
        className="port port-signal"
      />
      <Handle
        type="source"
        id={SIGNAL_RIGHT}
        position={Position.Right}
        className="port port-signal"
      />
      <div className="node-header">
        <span className="node-title">
          MOD <span className="node-ordinal">{ordinal}</span>
        </span>
        <span className="node-meta">{target?.label ?? '—'}</span>
      </div>
      <div className="mod-body">
        <span className="mod-rate">{rate < 1 ? rate.toFixed(2) : rate.toFixed(1)}</span>
        <span className="mod-unit">Hz</span>
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
