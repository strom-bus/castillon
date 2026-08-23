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
  TransformParams,
  EffectKind,
  FxParams,
  ModParams,
  OscParams,
  StartParams,
} from '../types/patch'
import { useNodeColors, type NodeColors } from '../viz/depth'
import { useNodeActivity } from '../viz/useActivity'
import { bindingLabel } from './keys'
import { StepBars } from './StepBars'
import { useTransposedBy } from './useTransposedBy'

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
  const key = params.trigger === 'bound' ? bindingLabel(params.binding) || '—' : ''

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
  const moved = useTransposedBy(id)

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
          {/* What a TRANSFORM somewhere above is doing to this oscillator, said on the oscillator.
              Otherwise it sounds moved with nothing on it saying why — a delay has the same reach and
              gets away with it, because a shift in time is heard from where it came and a shift in
              pitch is silent about its cause. */}
          {moved !== 0 && (
            <span className="node-moved" title="Moved by a TRANSFORM above it">
              {moved > 0 ? `+${moved}` : moved}
            </span>
          )}
        </span>
        <span className="node-meta">
          {WAVEFORM_LABELS[waveform]}
          {filter && ` ${filter}`} · {params.division}
        </span>
      </div>
      <StepBars
        nodeId={id}
        steps={params.steps}
        currentStep={currentStep}
        useChance={params.useChance}
        useRatchet={params.useRatchet}
        scale={params.scale}
        scaleRoot={params.scaleRoot}
      />
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
 * White and grey like the FX node, and for the same reason where an LFO is concerned: it keeps its own
 * clock, so a depth hue would claim it was part of the cascade. An **envelope** is a different matter
 * — it runs only when triggered, so it pulses like the nodes around it and shows how long its sweep
 * lasts.
 *
 * **Its event ports only appear when they mean something.** An LFO keeps its own clock and a trigger
 * says nothing to it, so a port there is a promise nothing keeps — and the first thing anyone asked
 * about them was what they were for. They show for an envelope, which needs a trigger to run at all,
 * and they also show whenever a cable is already attached: switching kind must never orphan a cable
 * by taking away the port it was drawn to.
 */
export function ModNode({ id, data, selected }: NodeProps<FlowNode>) {
  const wired = usePatchStore((s) => s.edges.some((e) => e.source === id && e.data?.kind === 'mod'))
  const ordinal = useOrdinal(id)
  const params = data.params as ModParams
  const envelope = params.kind === 'env'
  // A cable already there keeps its port, whatever the kind says.
  const inCascade = usePatchStore((s) =>
    s.edges.some(
      (e) => (e.source === id || e.target === id) && (e.data?.kind ?? 'event') === 'event',
    ),
  )
  // A per-note envelope has no use for a trigger either: its clock is the notes it is pointed at.
  const ports = (envelope && params.fires !== 'note') || inCascade
  const target = targetOf(params.target)
  const { pulsing } = useNodeActivity(id)

  return (
    <div
      className={`node node-mod${wired ? ' wired' : ' idle'}${
        envelope && pulsing ? ' pulsing' : ''
      }${selected ? ' selected' : ''}`}
    >
      {ports && (
        <Handle type="target" id={EVENT_IN} position={Position.Top} className="port port-in" />
      )}
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
      {ports && (
        <Handle type="source" id={EVENT_OUT} position={Position.Bottom} className="port port-out" />
      )}
      <div className="node-header">
        <span className="node-title">
          MOD <span className="node-ordinal">{ordinal}</span>
        </span>
        <span className="node-meta">{target?.label ?? '—'}</span>
      </div>
      <div className="mod-body">
        {envelope ? (
          <>
            {/* The whole length of the sweep, since that is the number that decides what it does. */}
            <span className="mod-rate">
              {((params.attack ?? 40) + (params.decay ?? 600)) / 1000 < 1
                ? (((params.attack ?? 40) + (params.decay ?? 600)) / 1000).toFixed(2)
                : (((params.attack ?? 40) + (params.decay ?? 600)) / 1000).toFixed(1)}
            </span>
            <span className="mod-unit">s</span>
          </>
        ) : (
          <>
            <span className="mod-rate">
              {(params.rate ?? 2) < 1
                ? (params.rate ?? 2).toFixed(2)
                : (params.rate ?? 2).toFixed(1)}
            </span>
            <span className="mod-unit">Hz</span>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * A TRANSFORM on the canvas: a number and a sign, and nothing else to look at.
 *
 * The same shape as a DELAY because it is the same kind of thing — a node that makes no sound and changes
 * what happens beneath it. One moves a branch in time and the other moves it in pitch.
 */
export function TransformNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { pulsing } = useNodeActivity(id)
  const colors = useNodeColors(id)
  const ordinal = useOrdinal(id)
  const params = data.params as TransformParams
  const steps = Math.round(params.transpose ?? 0)

  return (
    <div
      className={`node node-transform${pulsing ? ' pulsing' : ''}${selected ? ' selected' : ''}`}
      style={depthStyle(colors)}
    >
      {/* Side ports only, like a MOD: it attaches to what it moves rather than standing in the cascade,
          so nothing triggers it and nothing hangs below it. Standing in the cascade meant the cable
          between two nodes had to be broken to get one between them — and one wired beside that cable
          instead of in place of it does nothing you can hear. */}
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
          TRANSFORM <span className="node-ordinal">{ordinal}</span>
        </span>
        <span className="node-meta">{steps === 0 ? 'off' : 'steps'}</span>
      </div>
      <div className="delay-body">
        {/* Signed even when positive, because the sign is the whole reading: +2 and 2 look alike at a
            glance and only one of them says which way. */}
        <span className="delay-value">{steps > 0 ? `+${steps}` : steps}</span>
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
