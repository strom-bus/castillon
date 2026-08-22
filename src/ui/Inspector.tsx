import type { ReactNode } from 'react'
import { DIVISIONS } from '../audio/clock'
import { MAX_BITS, MAX_REDUCTION, MIN_BITS, MIN_REDUCTION } from '../audio/dsp'
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
import {
  LFO_SHAPE_LABELS,
  LFO_SHAPES,
  MOD_FIRES,
  MOD_FIRES_HINTS,
  MOD_FIRES_LABELS,
  MOD_KIND_HINTS,
  MOD_KIND_LABELS,
  MOD_KINDS,
  noNotesBecause,
  MAX_RATE as MAX_MOD_RATE,
  MIN_RATE as MIN_MOD_RATE,
  silentBecause,
  targetOf,
  targetsFor,
  type Destination,
  type LfoShape,
  type ModFires,
  type ModKind,
  type ModTarget,
} from '../audio/modulation'
import {
  MAX_MOD_ATTACK,
  MAX_MOD_DECAY,
  MIN_MOD_ATTACK,
  MIN_MOD_DECAY,
  DEFAULT_IGNITE,
  type IgniteBehaviour,
  type IgniteTrigger,
  type ModParams,
  type StartParams,
} from '../types/patch'
import { BindingCapture } from './BindingCapture'
import { formatOrdinal, nodeOrdinal } from '../state/ordinals'
import { useManualWindow } from '../help/window'
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
    case 'reduction':
      return (
        <TypedSlider
          label={name('Decimate')}
          value={params.reduction ?? MIN_REDUCTION}
          min={MIN_REDUCTION}
          max={MAX_REDUCTION}
          step={1}
          suffix="x"
          onChange={(reduction) => onChange({ reduction })}
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
  const showManual = useManualWindow((s) => s.show)
  const node = usePatchStore((s) => s.nodes.find((n) => n.id === s.selectedId))
  // The same number the node shows on the canvas, so the panel and the node agree on which one
  // you are looking at.
  const ordinal = usePatchStore((s) =>
    s.selectedId ? formatOrdinal(nodeOrdinal(s.nodes, s.selectedId)) : '',
  )
  const updateParams = usePatchStore((s) => s.updateParams)
  const setStepCount = usePatchStore((s) => s.setStepCount)
  const setEffect = usePatchStore((s) => s.setEffect)
  /**
   * The kinds of node the selected modulator reaches, which decide what it may point at.
   *
   * A joined string rather than an array, so the selector returns a primitive and the panel repaints
   * when the wiring changes rather than on every store change.
   */
  /** Whether anything triggers the selected node, which is what an envelope needs to run at all. */
  const triggered = usePatchStore((s) =>
    s.edges.some((e) => e.target === s.selectedId && (e.data?.kind ?? 'event') === 'event'),
  )

  const modWiring = usePatchStore((s) => {
    const edge = s.edges.find((e) => e.data?.kind === 'mod' && e.source === s.selectedId)
    const destination = edge ? s.nodes.find((node) => node.id === edge.target) : undefined
    if (!destination) return ''
    // Type, effect and filter together: which parameters exist depends on the first two, and whether
    // they can do anything on the third. Joined into a string so the selector returns a primitive and
    // the panel repaints on a rewiring rather than on every store write.
    const params = destination.data.params as { effect?: string; filterType?: string }
    return [destination.type ?? '', params.effect ?? '', params.filterType ?? ''].join(':')
  })

  if (!node) {
    return (
      <Panel>
        <p className="inspector-empty">Select a node to edit it.</p>
        <p className="inspector-empty">
          <strong>Top and bottom ports carry triggers.</strong> Ignite, Osc and Delay wire into each
          other that way, and the cascade runs downward.
        </p>
        <p className="inspector-empty">
          <strong>Side ports carry audio and modulation.</strong> One port takes either: an
          oscillator's side feeds an FX node, and a MOD feeds either of them. Several effects can
          share one oscillator, and one effect can take several.
        </p>
        <p className="inspector-empty">
          A <strong>MOD</strong> sweeps one parameter of whatever it is wired to, and which
          parameters it offers depends on what that is — a reverb's decay, a chorus's sweep, an
          oscillator's cutoff. Drawing the cable either way round works; it knows which end is
          which.
        </p>
        <p className="inspector-empty">
          Drag vertically on a bar to tune a step; the square underneath mutes it. Click a cable to
          remove it.
        </p>
        <p className="inspector-empty">
          Shift-drag selects several nodes. <strong>Copy and paste</strong> brings them back with
          their parameters, and the cables between them.
        </p>

        {/* Below the basics rather than instead of them: what is written here is what somebody needs
            in the first minute, and the manual is for the hour after. */}
        <button type="button" className="btn manual-open" onClick={showManual}>
          HELP
        </button>
      </Panel>
    )
  }

  if (node.type === 'start') {
    const ignite = node.data.params as StartParams
    const trigger = ignite.trigger ?? DEFAULT_IGNITE.trigger
    const behaviour = ignite.behaviour ?? DEFAULT_IGNITE.behaviour

    return (
      <Panel>
        <h2 className="inspector-title">
          IGNITE <span className="node-ordinal">{ordinal}</span>
        </h2>

        <label className="inspector-field">
          <span>Trigger</span>
          <select
            value={trigger}
            onChange={(e) => updateParams(node.id, { trigger: e.target.value as IgniteTrigger })}
          >
            <option value="auto">On Play (auto)</option>
            <option value="bound">On a key or note</option>
          </select>
        </label>

        {trigger === 'bound' ? (
          <>
            <label className="inspector-field">
              <span>Trigger</span>
              <BindingCapture
                binding={ignite.binding ?? null}
                onChange={(binding) => updateParams(node.id, { binding })}
              />
            </label>

            <label className="inspector-field">
              <span>While</span>
              <select
                value={behaviour}
                onChange={(e) =>
                  updateParams(node.id, { behaviour: e.target.value as IgniteBehaviour })
                }
              >
                <option value="hold">Held down</option>
                <option value="toggle">Until pressed again</option>
              </select>
            </label>

            <p className="inspector-empty">
              {behaviour === 'hold'
                ? 'Runs while the key is down and stops when it is released. Play does not start it.'
                : 'Starts on a press and stops on the next one. Play does not start it.'}
            </p>
          </>
        ) : (
          <p className="inspector-empty">
            Fires the cascade on Play. A patch can hold several: each one is an independent cascade.
          </p>
        )}
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

  if (node.type === 'mod') {
    const mod = node.data.params as ModParams
    const target = mod.target ?? 'level'
    // What it is wired to decides what it can point at: a MOD on a reverb offers that reverb's decay,
    // one on a chorus its sweep (§18.4). Unwired there is nothing yet to say otherwise.
    const [destinationType, destinationEffect, destinationFilter] = modWiring
      ? modWiring.split(':')
      : []
    const destination: Destination = {
      nodeType: destinationType,
      effect: destinationEffect as never,
      filterType: destinationFilter,
    }
    const offered: readonly ModTarget[] = targetsFor(destinationType, destinationEffect as never)
    const described = targetOf(target, destinationType, destinationEffect as never)
    const silent = silentBecause(target, destination)
    const kind: ModKind = mod.kind === 'env' ? 'env' : 'lfo'
    const fires: ModFires = mod.fires === 'note' ? 'note' : 'trigger'
    // An envelope waiting on a trigger it has not been given never runs, and nothing else would say so.
    const untriggered = kind === 'env' && fires === 'trigger' && !triggered
    const noNotes = kind === 'env' ? noNotesBecause(fires, target, destination) : null

    return (
      <Panel>
        <h2 className="inspector-title">
          MOD <span className="node-ordinal">{ordinal}</span>
        </h2>

        <label className="inspector-field">
          <span>Target</span>
          <select
            value={target}
            onChange={(e) => updateParams(node.id, { target: e.target.value })}
          >
            {offered.map((option) => {
              // Shown and unselectable rather than hidden, with the reason in the option itself: a
              // list that changes length as you change a filter type is harder to read than one where
              // an entry is visibly out of reach.
              const unavailable = silentBecause(option.key, destination) !== null
              return (
                <option key={option.key} value={option.key} disabled={unavailable}>
                  {option.label}
                  {unavailable && ' — filter off'}
                </option>
              )
            })}
          </select>
        </label>

        <label className="inspector-field">
          <span>Kind</span>
          <select
            value={kind}
            onChange={(e) => updateParams(node.id, { kind: e.target.value as ModKind })}
          >
            {MOD_KINDS.map((option) => (
              <option key={option} value={option}>
                {MOD_KIND_LABELS[option]}
              </option>
            ))}
          </select>
        </label>

        {kind === 'env' ? (
          <>
            <label className="inspector-field">
              <span>Fires on</span>
              <select
                value={fires}
                onChange={(e) => updateParams(node.id, { fires: e.target.value as ModFires })}
              >
                {MOD_FIRES.map((option) => (
                  <option key={option} value={option}>
                    {MOD_FIRES_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>

            <TypedSlider
              label="Attack"
              value={mod.attack ?? 40}
              min={MIN_MOD_ATTACK}
              max={MAX_MOD_ATTACK}
              step={1}
              suffix="ms"
              onChange={(attack) => updateParams(node.id, { attack })}
            />
            <TypedSlider
              label="Decay"
              value={mod.decay ?? 600}
              min={MIN_MOD_DECAY}
              max={MAX_MOD_DECAY}
              step={5}
              suffix="ms"
              onChange={(decay) => updateParams(node.id, { decay })}
            />
          </>
        ) : (
          <>
            <label className="inspector-field">
              <span>Shape</span>
              <select
                value={mod.wave ?? 'sine'}
                onChange={(e) => updateParams(node.id, { wave: e.target.value as LfoShape })}
              >
                {LFO_SHAPES.map((shape) => (
                  <option key={shape} value={shape}>
                    {LFO_SHAPE_LABELS[shape]}
                  </option>
                ))}
              </select>
            </label>

            <TypedSlider
              label="Rate"
              value={mod.rate ?? 2}
              min={MIN_MOD_RATE}
              max={MAX_MOD_RATE}
              step={0.05}
              suffix="Hz"
              onChange={(rate) => updateParams(node.id, { rate })}
            />
          </>
        )}

        <TypedSlider
          label="Depth"
          value={mod.depth ?? 0.6}
          min={0}
          max={1}
          step={0.01}
          onChange={(depth) => updateParams(node.id, { depth })}
        />

        {silent && (
          <p className="inspector-warn">
            Doing nothing: {silent}. Turn it on in the oscillator to hear this.
          </p>
        )}

        {untriggered && (
          <p className="inspector-warn">
            Waiting for a trigger. Wire something into the port on top — an Ignite for once per
            pass, or a node further down the cascade to run when that branch does.
          </p>
        )}

        {noNotes && (
          <p className="inspector-warn">
            Doing nothing: {noNotes}. Point it at an oscillator, or set it to fire on a trigger.
          </p>
        )}

        <p className="inspector-empty">
          {MOD_KIND_HINTS[kind]} {kind === 'env' && MOD_FIRES_HINTS[fires]} {described?.hint}
          {!destinationType && ' Wire it to the side of an oscillator or an effect.'}
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
        label="Decay"
        value={params.decay ?? 0}
        min={0}
        max={2000}
        step={5}
        suffix=" ms"
        onChange={(decay) => set({ decay })}
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
