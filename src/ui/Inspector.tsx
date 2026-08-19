import type { ReactNode } from 'react'
import { DIVISIONS } from '../audio/clock'
import { MAX_BITS, MIN_BITS } from '../audio/dsp'
import { EFFECTS, effectOr } from '../audio/effects'
import {
  cutoffToSlider,
  FILTER_NAMES,
  FILTER_TYPES,
  formatCutoff,
  MAX_RESONANCE,
  MIN_RESONANCE,
  sliderToCutoff,
} from '../audio/filter'
import { MAX_PULSE_WIDTH, MIN_PULSE_WIDTH, WAVEFORM_NAMES, WAVEFORMS } from '../audio/waveforms'
import { DEFAULT_DELAY_MS, DEFAULT_STEP_COUNT, STEP_COUNTS } from '../nodes/registry'
import { formatOrdinal, nodeOrdinal } from '../state/ordinals'
import { usePatchStore } from '../state/patchStore'
import { NumberInput } from './NumberInput'
import {
  MAX_DECAY,
  MAX_DELAY_MS,
  MAX_FEEDBACK,
  MAX_RATE,
  MAX_SWEEP,
  MIN_RATE,
  MIN_SWEEP,
  MIN_DECAY,
  MIN_DELAY_MS,
  type DelayParams,
  type DistortionShape,
  type Division,
  type EffectKind,
  type FxParams,
  type FilterType,
  type OscParams,
  type PropagateMode,
  type Waveform,
} from '../types/patch'

const SHAPE_LABELS: [DistortionShape, string][] = [
  ['overdrive', 'Overdrive'],
  ['distortion', 'Distortion'],
  ['fuzz', 'Fuzz'],
  ['octave', 'Octave up'],
]

const PROPAGATE_LABELS: Record<PropagateMode, string> = {
  onEnd: 'When it ends (cascade)',
  onStart: 'When it starts (parallel)',
  onStep: 'On every step (dense)',
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <label className="inspector-field">
      <span className="inspector-label">
        {label}
        <em>
          {value}
          {suffix}
        </em>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

/**
 * A slider whose readout is an editable field, for values worth reaching exactly rather than by
 * dragging. It is a div rather than a label because it holds two controls, and a label would
 * bind clicks on its text to whichever came first.
 */
function TypedSlider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <div className="inspector-field">
      <span className="inspector-label">
        {label}
        <span className="inspector-typed">
          <NumberInput
            value={value}
            min={min}
            max={max}
            step={step}
            ariaLabel={label}
            onCommit={onChange}
          />
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={`${label} slider`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

/**
 * Cutoff has its own control because it is edited in log space: the slider carries a 0–1
 * position while the patch stores Hz, so every octave gets the same travel.
 */
function CutoffSlider({
  value,
  onChange,
  label = 'Cutoff',
}: {
  value: number
  onChange: (hz: number) => void
  label?: string
}) {
  return (
    <label className="inspector-field">
      <span className="inspector-label">
        {label}
        <em>{formatCutoff(value)} Hz</em>
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={cutoffToSlider(value)}
        onChange={(e) => onChange(Math.round(sliderToCutoff(Number(e.target.value))))}
      />
    </label>
  )
}

/**
 * Renders whichever control a parameter needs. An effect declares its parameters and the panel
 * follows, so adding one is a row in the effects table rather than a branch in here.
 */
function EffectControl({
  param,
  params,
  labels,
  onChange,
}: {
  param: keyof FxParams
  params: FxParams
  labels?: Partial<Record<keyof FxParams, string>>
  onChange: (partial: Partial<FxParams>) => void
}) {
  /** An effect may rename any of its controls, so every one of them asks. */
  const name = (fallback: string) => labels?.[param] ?? fallback

  switch (param) {
    case 'shape':
      return (
        <label className="inspector-field">
          <span className="inspector-label">{name('Shape')}</span>
          <select
            value={params.shape ?? 'overdrive'}
            onChange={(e) => onChange({ shape: e.target.value as DistortionShape })}
          >
            {SHAPE_LABELS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )
    case 'filterType':
      return (
        <label className="inspector-field">
          <span className="inspector-label">{name('Type')}</span>
          <select
            value={params.filterType ?? 'lowpass'}
            onChange={(e) => onChange({ filterType: e.target.value as FilterType })}
          >
            {FILTER_TYPES.filter((type) => type !== 'off').map((type) => (
              <option key={type} value={type}>
                {FILTER_NAMES[type]}
              </option>
            ))}
          </select>
        </label>
      )
    case 'bits':
      return (
        <TypedSlider
          label={name('Bits')}
          value={params.bits ?? MAX_BITS}
          min={MIN_BITS}
          max={MAX_BITS}
          step={1}
          onChange={(bits) => onChange({ bits })}
        />
      )
    case 'sweep':
      return (
        <TypedSlider
          label={name('Sweep')}
          value={params.sweep ?? 6}
          min={MIN_SWEEP}
          max={MAX_SWEEP}
          step={0.1}
          suffix="ms"
          onChange={(sweep) => onChange({ sweep })}
        />
      )
    case 'rate':
      return (
        <TypedSlider
          label={name('Rate')}
          value={params.rate ?? 1.5}
          min={MIN_RATE}
          max={MAX_RATE}
          step={0.1}
          suffix="Hz"
          onChange={(rate) => onChange({ rate })}
        />
      )
    case 'depth':
      return (
        <TypedSlider
          label={name('Depth')}
          value={params.depth ?? 0.4}
          min={0}
          max={1}
          step={0.01}
          onChange={(depth) => onChange({ depth })}
        />
      )
    case 'pan':
      return (
        <TypedSlider
          label={name('Pan')}
          value={params.pan ?? 0}
          min={-1}
          max={1}
          step={0.01}
          onChange={(pan) => onChange({ pan })}
        />
      )
    case 'width':
      return (
        <TypedSlider
          label={name('Width')}
          value={params.width ?? 0}
          min={0}
          max={1}
          step={0.01}
          onChange={(width) => onChange({ width })}
        />
      )
    case 'decay':
      return (
        <TypedSlider
          label={name('Decay')}
          value={params.decay ?? 2}
          min={MIN_DECAY}
          max={MAX_DECAY}
          step={0.1}
          suffix="s"
          onChange={(decay) => onChange({ decay })}
        />
      )
    case 'drive':
      return (
        <TypedSlider
          label={name('Drive')}
          value={params.drive ?? 0.4}
          min={0}
          max={1}
          step={0.01}
          onChange={(drive) => onChange({ drive })}
        />
      )
    case 'time':
      return (
        <label className="inspector-field">
          <span className="inspector-label">{name('Time')}</span>
          <select
            value={params.time ?? '1/8'}
            onChange={(e) => onChange({ time: e.target.value as Division })}
          >
            {DIVISIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      )
    case 'feedback':
      return (
        <TypedSlider
          label={name('Feedback')}
          value={params.feedback ?? 0.35}
          min={0}
          max={MAX_FEEDBACK}
          step={0.01}
          onChange={(feedback) => onChange({ feedback })}
        />
      )
    case 'cutoff':
      // Tone on a shaping stage, Cutoff on a filter, Freq on a ring modulator: the effect says
      // which, because the same number means a different thing in each.
      return (
        <CutoffSlider
          label={name('Tone')}
          value={params.cutoff ?? 6000}
          onChange={(cutoff) => onChange({ cutoff })}
        />
      )
    case 'resonance':
      return (
        <TypedSlider
          label={name('Resonance')}
          value={params.resonance ?? 1}
          min={MIN_RESONANCE}
          max={MAX_RESONANCE}
          step={0.1}
          onChange={(resonance) => onChange({ resonance })}
        />
      )
    default:
      return null
  }
}

/**
 * The frame every panel shares, which is also where the source link lives.
 *
 * Not decoration: this is published under the AGPL, and §13 requires that anyone using the hosted
 * app can reach its source. Putting it in the shared frame means a panel added later cannot
 * accidentally drop it.
 */
function Panel({ children }: { children: ReactNode }) {
  return (
    <aside className="inspector">
      <div className="inspector-body">{children}</div>
      <a
        className="inspector-source"
        href="https://github.com/strom-bus/castillon"
        target="_blank"
        rel="noreferrer"
      >
        source
      </a>
    </aside>
  )
}

export function Inspector() {
  const node = usePatchStore((s) => s.nodes.find((n) => n.id === s.selectedId))
  // The same number the node shows on the canvas, so the panel and the node agree on which one
  // you are looking at.
  const ordinal = usePatchStore((s) =>
    s.selectedId ? formatOrdinal(nodeOrdinal(s.nodes, s.selectedId)) : '',
  )
  const updateParams = usePatchStore((s) => s.updateParams)
  const setStepCount = usePatchStore((s) => s.setStepCount)
  const setEffect = usePatchStore((s) => s.setEffect)

  if (!node) {
    return (
      <Panel>
        <p className="inspector-empty">Select a node to edit it.</p>
        <p className="inspector-empty">
          <strong>Top and bottom ports carry triggers.</strong> Ignite, Osc and Delay wire into each
          other that way, and the cascade runs downward.
        </p>
        <p className="inspector-empty">
          <strong>Side ports carry audio.</strong> An oscillator's side feeds an FX node. Several
          effects can share one oscillator, and one effect can take several.
        </p>
        <p className="inspector-empty">
          Drag vertically on a bar to tune a step; the square underneath mutes it. Click a cable to
          remove it.
        </p>
        <p className="inspector-empty">
          Shift-drag selects several nodes. <strong>Copy and paste</strong> brings them back with
          their parameters, and the cables between them.
        </p>
      </Panel>
    )
  }

  if (node.type === 'start') {
    return (
      <Panel>
        <h2 className="inspector-title">
          IGNITE <span className="node-ordinal">{ordinal}</span>
        </h2>
        <p className="inspector-empty">
          Fires the cascade on Play. A patch can hold several: each one is an independent cascade.
        </p>
      </Panel>
    )
  }

  if (node.type === 'fx') {
    const fxParams = node.data.params as FxParams
    const descriptor = effectOr(fxParams.effect)
    const setFx = (partial: Partial<FxParams>) => updateParams(node.id, partial)

    return (
      <Panel>
        <h2 className="inspector-title">
          FX <span className="node-ordinal">{ordinal}</span>
        </h2>

        <label className="inspector-field">
          <span className="inspector-label">Effect</span>
          <select
            value={fxParams.effect ?? 'gain'}
            onChange={(e) => setEffect(node.id, e.target.value as EffectKind)}
          >
            {EFFECTS.map((effect) => (
              <option key={effect.kind} value={effect.kind}>
                {effect.label}
              </option>
            ))}
          </select>
        </label>

        <TypedSlider
          label="Mix"
          value={fxParams.mix ?? 0.8}
          min={0}
          max={1}
          step={0.01}
          onChange={(mix) => setFx({ mix })}
        />

        {descriptor.params.length > 0 && (
          <div className="inspector-section">
            {descriptor.params.map((param) => (
              <EffectControl
                key={param}
                param={param}
                params={fxParams}
                labels={descriptor.labels}
                onChange={setFx}
              />
            ))}
          </div>
        )}

        <p className="inspector-empty">
          Wire an oscillator's side port into this to feed it. Several effects can share one
          oscillator, and one effect can take several.
        </p>
        <p className="inspector-empty">
          Mix runs from all clean to all effect. An oscillator with nothing attached is heard whole;
          once something is, it is heard through it.
        </p>
      </Panel>
    )
  }

  if (node.type === 'delay') {
    const delayParams = node.data.params as DelayParams
    return (
      <Panel>
        <h2 className="inspector-title">
          DELAY <span className="node-ordinal">{ordinal}</span>
        </h2>
        <TypedSlider
          label="Wait"
          value={delayParams.delayMs ?? DEFAULT_DELAY_MS}
          min={MIN_DELAY_MS}
          max={MAX_DELAY_MS}
          step={10}
          suffix="ms"
          onChange={(delayMs) => updateParams(node.id, { delayMs })}
        />
        <p className="inspector-empty">
          Holds the trigger and passes it on later. It makes no sound of its own — it shifts when
          the branch below it starts, so it is how two branches are pulled out of step.
        </p>
      </Panel>
    )
  }

  const params = node.data.params as OscParams
  const waveform = params.waveform ?? 'square'
  const set = (partial: Partial<OscParams>) => updateParams(node.id, partial)

  return (
    <Panel>
      <h2 className="inspector-title">
        OSC <span className="node-ordinal">{ordinal}</span>
      </h2>

      <label className="inspector-field">
        <span className="inspector-label">Waveform</span>
        <select value={waveform} onChange={(e) => set({ waveform: e.target.value as Waveform })}>
          {WAVEFORMS.map((w) => (
            <option key={w} value={w}>
              {WAVEFORM_NAMES[w]}
            </option>
          ))}
        </select>
      </label>

      {waveform === 'pulse' && (
        <Slider
          label="Pulse width"
          value={params.pulseWidth ?? 0.5}
          min={MIN_PULSE_WIDTH}
          max={MAX_PULSE_WIDTH}
          step={0.01}
          onChange={(pulseWidth) => set({ pulseWidth })}
        />
      )}

      <label className="inspector-field">
        <span className="inspector-label">Steps</span>
        <select
          value={params.steps?.length ?? DEFAULT_STEP_COUNT}
          onChange={(e) => setStepCount(node.id, Number(e.target.value))}
        >
          {STEP_COUNTS.map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>
      </label>

      <label className="inspector-field">
        <span className="inspector-label">Division</span>
        <select
          value={params.division}
          onChange={(e) => set({ division: e.target.value as Division })}
        >
          {DIVISIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>

      <label className="inspector-field">
        <span className="inspector-label">Filter</span>
        <select
          value={params.filterType ?? 'off'}
          onChange={(e) => set({ filterType: e.target.value as FilterType })}
        >
          {FILTER_TYPES.map((type) => (
            <option key={type} value={type}>
              {FILTER_NAMES[type]}
            </option>
          ))}
        </select>
      </label>

      {(params.filterType ?? 'off') !== 'off' && (
        <>
          <CutoffSlider value={params.cutoff ?? 2000} onChange={(cutoff) => set({ cutoff })} />
          <Slider
            label="Resonance"
            value={params.resonance ?? 1}
            min={MIN_RESONANCE}
            max={MAX_RESONANCE}
            step={0.1}
            onChange={(resonance) => set({ resonance })}
          />
        </>
      )}

      <label className="inspector-field">
        <span className="inspector-label">Propagation</span>
        <select
          value={params.propagateMode}
          onChange={(e) => set({ propagateMode: e.target.value as PropagateMode })}
        >
          {(Object.keys(PROPAGATE_LABELS) as PropagateMode[]).map((mode) => (
            <option key={mode} value={mode}>
              {PROPAGATE_LABELS[mode]}
            </option>
          ))}
        </select>
      </label>

      <Slider
        label="Gain"
        value={params.gain}
        min={0}
        max={1}
        step={0.01}
        onChange={(gain) => set({ gain })}
      />
      <Slider
        label="Gate"
        value={params.gate}
        min={0.05}
        max={1}
        step={0.05}
        onChange={(gate) => set({ gate })}
      />
      <Slider
        label="Attack"
        value={params.attack}
        min={1}
        max={500}
        step={1}
        suffix=" ms"
        onChange={(attack) => set({ attack })}
      />
      <Slider
        label="Release"
        value={params.release}
        min={5}
        max={2000}
        step={5}
        suffix=" ms"
        onChange={(release) => set({ release })}
      />
    </Panel>
  )
}
