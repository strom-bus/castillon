import { ROOT_NAMES, SCALES, SCALE_NAMES, snapToScale, type ScaleName } from '../audio/scales'
import type { ReactNode } from 'react'
import { DIVISIONS } from '../audio/clock'
import {
  MAX_BITS,
  MAX_COMB_NOTE,
  MAX_REDUCTION,
  MAX_REPEATS,
  MIN_BITS,
  MIN_COMB_NOTE,
  MIN_REDUCTION,
  MIN_REPEATS,
} from '../audio/dsp'
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
import { DEFAULT_DELAY_MS, DEFAULT_STEP_COUNT, MAX_STEPS, MIN_STEPS } from '../nodes/registry'
import {
  LFO_SHAPE_LABELS,
  LFO_SHAPES,
  MOD_FIRES,
  MOD_FIRES_HINTS,
  MOD_FIRES_LABELS,
  MOD_KIND_HINTS,
  MOD_BEATS,
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
  MAX_NOTE,
  MAX_RATCHET,
  MAX_WARP,
  SPEEDS,
  SWINGS,
  MAX_SLOP,
  MAX_EVERY,
  MIN_NOTE,
  DEFAULT_IGNITE,
  type Step,
  type IgniteBehaviour,
  type IgniteTrigger,
  type ModParams,
  type SieveParams,
  type WarpParams,
  type StartParams,
} from '../types/patch'
import { noteName } from '../audio/clock'
import { BindingCapture } from './BindingCapture'
import { formatOrdinal, nodeOrdinal } from '../state/ordinals'
import { warpDoingNothing } from '../state/transpose'
import { useManualWindow } from '../help/window'
import { usePatchStore } from '../state/patchStore'
import { NumberInput } from './NumberInput'
import {
  MAX_DECAY,
  MAX_EQ_DB,
  MAX_DELAY_MS,
  MAX_FEEDBACK,
  MAX_RATE,
  MAX_SWEEP,
  MIN_RATE,
  MIN_SWEEP,
  MIN_DECAY,
  DIRECTIONS,
  DIRECTION_LABELS,
  MIN_DELAY_MS,
  type DelayParams,
  type Direction,
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
    case 'pitch':
      /*
       * A note, shown as a note. The resonator has to agree with the sequence and nobody agrees with a
       * sequence in hertz — so the slider steps in semitones and says which one, the same way a step
       * does. Whole semitones only: a resonator between two of them is out of tune with everything
       * rather than interestingly detuned.
       */
      return (
        <TypedSlider
          label={name('Pitch')}
          value={params.pitch ?? 57}
          min={MIN_COMB_NOTE}
          max={MAX_COMB_NOTE}
          step={1}
          // The number stays typeable and the name sits beside it, which is the only arrangement where
          // both work: you cannot type A3 into a number field, and 57 on its own says nothing.
          suffix={` ${noteName(Math.round(params.pitch ?? 57))}`}
          onChange={(pitch) => onChange({ pitch })}
        />
      )
    /*
     * The three bands, which share one control shape because they are one idea three times over. Written
     * as a fallthrough rather than three near-identical blocks: three copies is where one of them ends up
     * reading the wrong field, which is the mistake the EQ's own test is built to catch.
     */
    case 'low':
    case 'mid':
    case 'high':
      return (
        <TypedSlider
          label={name(`${param[0].toUpperCase()}${param.slice(1)}`)}
          value={params[param] ?? 0}
          min={-MAX_EQ_DB}
          max={MAX_EQ_DB}
          step={0.5}
          suffix=" dB"
          onChange={(value) => onChange({ [param]: value })}
        />
      )
    case 'repeats':
      /*
       * Whole numbers, because a repeat count between two of them is not a sound — and one is labelled as
       * doing nothing rather than being hidden, since that is the setting somebody will want back.
       */
      return (
        <TypedSlider
          label={name('Repeats')}
          value={params.repeats ?? MIN_REPEATS}
          min={MIN_REPEATS}
          max={MAX_REPEATS}
          step={1}
          suffix={(params.repeats ?? MIN_REPEATS) <= MIN_REPEATS ? ' · off' : '×'}
          onChange={(repeats) => onChange({ repeats })}
        />
      )
    case 'bias':
      /*
       * Centred in the middle, which is where it does nothing — so the control looks like what it is: an
       * offset either way rather than an amount of something. The same shape as Pan and Detune.
       */
      return (
        <TypedSlider
          label={name('Bias')}
          value={params.bias ?? 0}
          min={-1}
          max={1}
          step={0.01}
          onChange={(bias) => onChange({ bias })}
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
/**
 * A titled run of controls inside a panel.
 *
 * Headings rather than tabs. A tab would hide half of what somebody needs to see at once — a filter you
 * are opening against an envelope you are shortening is one adjustment, not two — and the panel is only
 * long, not crowded. What was wrong with it was never the length: fifteen controls in a flat list gave a
 * new parameter nowhere to belong, so decay, glide and key follow each landed at the bottom for no reason
 * anybody could read off the screen.
 */
/**
 * One step of one sequencer.
 *
 * It exists because a step already carried more than the bars could show. Velocity has been in the file
 * format, in the engine and in the dice since long before today, read by anything wired to it — and there
 * has never been a way to set it. Everything here is either that, or something that arrived with it.
 */
function StepPanel({
  nodeId,
  ordinal,
  index,
  step,
  params,
}: {
  nodeId: string
  ordinal: string
  index: number
  step: Step
  params: OscParams
}) {
  const updateStep = usePatchStore((s) => s.updateStep)
  const select = usePatchStore((s) => s.select)
  const set = (partial: Partial<Step>) => updateStep(nodeId, index, partial)

  return (
    <Panel>
      {/* A trail rather than a title: it says how deep you are, and the way back out is the part of it
          you came from. A panel whose only exit is "click somewhere else" is one people get stuck in. */}
      <h2 className="inspector-title">
        <button type="button" className="inspector-up" onClick={() => select(nodeId)}>
          OSC <span className="node-ordinal">{ordinal}</span>
        </button>
        <span className="inspector-trail">STP {index + 1}</span>
      </h2>

      <Group title="THIS STEP">
        <label className="inspector-field">
          <span className="inspector-label">
            Note
            <em>{noteName(step.note)}</em>
          </span>
          <input
            type="range"
            min={MIN_NOTE}
            max={MAX_NOTE}
            step={1}
            value={step.note}
            // Snapped here as well as on the bar. There are two ways to change a note and a scale that
            // only one of them consults is not a scale — it is a scale you can walk around.
            onChange={(e) =>
              set({
                note: snapToScale(
                  Number(e.target.value),
                  params.scale ?? 'free',
                  params.scaleRoot ?? 0,
                ),
              })
            }
          />
        </label>

        <Slider
          label="Volume"
          value={step.velocity ?? 1}
          min={0}
          max={1}
          step={0.01}
          onChange={(velocity) => set({ velocity })}
        />

        {/* Named for the thing you do rather than for the state it leaves behind. "Armed" was a second
            word for what the square under the bar already calls muting, and jargon besides — one state
            with two names is one name too many. */}
        <label className="inspector-check">
          <input
            type="checkbox"
            checked={!step.active}
            onChange={(e) => set({ active: !e.target.checked })}
          />
          <span>Mute</span>
        </label>

        {/* Only where the oscillator is using it. A control for something switched off is a question
            about a thing that is not happening. */}
        {params.useChance && (
          <Slider
            label="Chance"
            value={Math.round((step.chance ?? 1) * 100)}
            min={0}
            max={100}
            step={5}
            suffix="%"
            onChange={(chance) => set({ chance: chance / 100 })}
          />
        )}

        {params.useRatchet && (
          <>
            <Slider
              label="Ratchet"
              value={Math.max(1, Math.round(step.ratchet ?? 1))}
              min={1}
              max={MAX_RATCHET}
              step={1}
              suffix=" hits"
              onChange={(ratchet) => set({ ratchet })}
            />

            {/* Only where there is a roll to ramp across. A single hit has no second hit to be louder
                or quieter than, so the control would be asking about nothing.

                Level rather than pitch, of the two dimensions a roll could ramp in: a real roll decays,
                and that is what makes four hits sound like one gesture instead of four notes stuck
                together. Signed, so the off position is inside the number — up fades away, down swells,
                zero is the ordinary roll. */}
            {(step.ratchet ?? 1) > 1 && (
              <Slider
                label="Roll"
                value={Math.round((step.ratchetRamp ?? 0) * 100) / 100}
                min={-1}
                max={1}
                step={0.05}
                onChange={(ratchetRamp) => set({ ratchetRamp })}
              />
            )}
          </>
        )}

        <label className="inspector-check">
          <input
            type="checkbox"
            checked={step.slide === true}
            onChange={(e) => set({ slide: e.target.checked })}
          />
          {/* The same name as the oscillator's, because it is the same gesture split in two: this says
              which notes glide and the oscillator says how long a glide lasts. Different scopes, one
              idea — and the title above says which scope you are in. */}
          <span>Glide {(params.glide ?? 0) === 0 && '(set the time on the OSC first)'}</span>
        </label>
      </Group>
    </Panel>
  )
}

/**
 * A speed ratio as a musician would say it.
 *
 * Halves and thirds as fractions rather than as decimals, because "1/3" is a musical thought and
 * "0.333" is an arithmetic one — and a third is exactly the ratio somebody reaches for.
 */
/**
 * A swing ratio as a feel rather than as a number.
 *
 * "2" is the arithmetic — the long half is twice the short — and "Triplet" is what it sounds like, which
 * is what somebody is choosing between. The number stays beside the word because the two together are how
 * you learn what the words mean.
 */
function swingLabel(ratio: number): string {
  const names: Record<string, string> = {
    '1': 'Straight',
    '1.2': 'A hair',
    '1.5': 'Shuffle',
    '1.75': 'Heavy shuffle',
    '2': 'Triplet',
    '2.5': 'Dragging',
    '3': 'Nearly a gap',
  }
  return ratio === 1 ? 'Straight' : `${names[String(ratio)] ?? 'Swung'}  (${ratio}:1)`
}

/**
 * A cycle length in beats, said the way it would be counted.
 *
 * Four beats is what most people would call a bar, and it is named as one — but only as an aside, since
 * this instrument has no time signature and therefore no bar of its own. The number of beats is the fact;
 * the bar is the reader's own frame.
 */
function beatsLabel(beats: number): string {
  if (beats < 1) return `${beats === 0.25 ? 'quarter' : 'half'} a beat`
  const named: Record<string, string> = {
    '4': ' (a bar)',
    '8': ' (two bars)',
    '16': ' (four bars)',
  }
  return `${beats} beat${beats === 1 ? '' : 's'}${named[String(beats)] ?? ''}`
}

function ratioLabel(ratio: number): string {
  if (ratio === 1) return 'x1  (as written)'
  const fractions: Record<string, string> = {
    '0.25': 'x1/4',
    '0.3333333333333333': 'x1/3',
    '0.5': 'x1/2',
    '0.6666666666666666': 'x2/3',
    '1.5': 'x3/2',
  }
  return fractions[String(ratio)] ?? `x${ratio}`
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="inspector-group">
      <h3 className="inspector-group-title">{title}</h3>
      {children}
    </section>
  )
}

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
  // The whole graph, because a warp is a fact about a branch rather than about itself.
  const nodes = usePatchStore((s) => s.nodes)
  const edges = usePatchStore((s) => s.edges)
  // The same number the node shows on the canvas, so the panel and the node agree on which one
  // you are looking at.
  const ordinal = usePatchStore((s) =>
    s.selectedId ? formatOrdinal(nodeOrdinal(s.nodes, s.selectedId)) : '',
  )
  const selectedStep = usePatchStore((s) => s.selectedStep)
  const updateParams = usePatchStore((s) => s.updateParams)
  const setStepCount = usePatchStore((s) => s.setStepCount)
  const fitToScale = usePatchStore((s) => s.fitToScale)
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

        {/* Mix sits directly under the effect and above its own controls, not below them. Every effect
            offers a different number of parameters, so from underneath it would slide up and down the
            panel each time the effect changed — and it is the control reached for most. */}
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

        {/* What it is before what it points at, which is the sentence the panel should read as: an
            envelope, fired on every note, sweeping the cutoff. It named the destination first and left
            what kind of thing it was until second.

            Kind also decides which controls exist below it — a clock and a rate for an LFO, a trigger
            and two times for an envelope — so it goes above them, where changing it disturbs nothing
            that was already set. */}
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

            {/* The box first and the words after it, which is the order a checkbox is read in: the
                control is the sentence's subject and the label says what ticking it means. Every other
                field here names a value and then shows it, and borrowing that layout put the box out at
                the right margin, a long way from the thing it belongs to. */}
            {fires === 'note' && (
              <label className="inspector-check">
                <input
                  type="checkbox"
                  checked={mod.byVelocity === true}
                  onChange={(e) => updateParams(node.id, { byVelocity: e.target.checked })}
                />
                <span>Scale by velocity</span>
              </label>
            )}

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

            {/* Beside the rate rather than replacing it, and a bypass in the same sense the swing's is:
                the hertz are remembered while it is synced, so a wobble can be put on the grid and taken
                off it again without losing the setting it had. */}
            <label className="inspector-check">
              <input
                type="checkbox"
                checked={mod.sync === true}
                onChange={(e) => updateParams(node.id, { sync: e.target.checked })}
              />
              <span>Sync to tempo</span>
            </label>

            {mod.sync ? (
              <label className="inspector-field">
                <span className="inspector-label">Every</span>
                <select
                  value={String(mod.beats ?? 4)}
                  onChange={(e) => updateParams(node.id, { beats: Number(e.target.value) })}
                >
                  {MOD_BEATS.map((beats) => (
                    <option key={beats} value={String(beats)}>
                      {beatsLabel(beats)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <TypedSlider
                label="Rate"
                value={mod.rate ?? 2}
                min={MIN_MOD_RATE}
                max={MAX_MOD_RATE}
                step={0.05}
                suffix="Hz"
                onChange={(rate) => updateParams(node.id, { rate })}
              />
            )}
          </>
        )}

        {/* Signed, so a modulation can be read the other way round: an envelope that closes a filter
            rather than opening one, or two LFOs set against each other. Inverting is not a second kind of
            modulation, so it lives inside the number rather than beside it as a switch. */}
        <TypedSlider
          label="Depth"
          value={mod.depth ?? 0.6}
          min={-1}
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

  if (node.type === 'warp') {
    const warpParams = node.data.params as WarpParams
    const doingNothing = warpDoingNothing(
      nodes.map((n) => ({
        id: n.id,
        type: n.type ?? '',
        position: n.position,
        params: n.data.params,
      })),
      edges.map((e) => ({
        id: e.id,
        kind: e.data?.kind ?? 'event',
        source: e.source,
        target: e.target,
      })),
      node.id,
    )
    return (
      <Panel>
        <h2 className="inspector-title">
          WARP <span className="node-ordinal">{ordinal}</span>
        </h2>

        {/* Four dimensions, each named for what it bends rather than for the operation that bends it,
            and each at a neutral point so a warp just added does nothing. Pitch adds where the rest
            multiply — two warps a third up each come to a sixth up, two at half speed each come to a
            quarter — which is what lets any number of them stack without deciding which one wins. */}
        <Slider
          label="Pitch"
          value={Math.round(warpParams.transpose ?? 0)}
          min={-MAX_WARP}
          max={MAX_WARP}
          step={1}
          suffix=" steps"
          onChange={(transpose) => updateParams(node.id, { transpose })}
        />

        {/* A list rather than a slider, because a half and a third are worth having and 0.87 is not:
            against a musical grid an arbitrary ratio is only out of time. */}
        <label className="inspector-field">
          <span className="inspector-label">Speed</span>
          <select
            value={String(warpParams.speed ?? 1)}
            onChange={(e) => updateParams(node.id, { speed: Number(e.target.value) })}
          >
            {SPEEDS.map((ratio) => (
              <option key={ratio} value={String(ratio)}>
                {ratioLabel(ratio)}
              </option>
            ))}
          </select>
        </label>

        {/* Beside its ratio rather than inside it, and that is not a second way of saying straight — 1 is
            already straight. It is a bypass: what you do with a groove is listen straight, then swung,
            then straight again, and a control walked back to 1 loses the setting every time. Off to begin
            with, so a warp added and untouched still does nothing at all. */}
        <label className="inspector-check">
          <input
            type="checkbox"
            checked={warpParams.useSwing === true}
            onChange={(e) => updateParams(node.id, { useSwing: e.target.checked })}
          />
          <span>Swing</span>
        </label>

        {warpParams.useSwing && (
          <label className="inspector-field">
            <span className="inspector-label">Feel</span>
            <select
              value={String(warpParams.swing ?? 1)}
              onChange={(e) => updateParams(node.id, { swing: Number(e.target.value) })}
            >
              {SWINGS.map((ratio) => (
                <option key={ratio} value={String(ratio)}>
                  {swingLabel(ratio)}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* Beside the swing rather than instead of it: the two act on different things, so they compose.
            Swing decides the shape of the bar and this decides how closely it is respected, which is a
            drummer with a shuffle who is not perfectly tight. */}
        <label className="inspector-check">
          <input
            type="checkbox"
            checked={warpParams.useSlop === true}
            onChange={(e) => updateParams(node.id, { useSlop: e.target.checked })}
          />
          <span>Slop</span>
        </label>

        {warpParams.useSlop && (
          <Slider
            label="Looseness"
            value={Math.round((warpParams.slop ?? 0) * 100) / 100}
            min={0}
            max={MAX_SLOP}
            step={0.01}
            onChange={(slop) => updateParams(node.id, { slop })}
          />
        )}

        {/* Above Velocity, because it is the one most people are reaching for: balancing a branch. The two
            look alike and are not — see `WarpParams.level`. Velocity is a source and closes filters with
            it; this only changes how loud the branch is. */}
        <Slider
          label="Level"
          value={Math.round((warpParams.level ?? 1) * 100) / 100}
          min={0}
          max={2}
          step={0.05}
          suffix="x"
          onChange={(level) => updateParams(node.id, { level })}
        />

        <Slider
          label="Velocity"
          value={Math.round((warpParams.velocity ?? 1) * 100) / 100}
          min={0}
          max={2}
          step={0.05}
          suffix="x"
          onChange={(velocity) => updateParams(node.id, { velocity })}
        />

        <Slider
          label="Chance"
          value={Math.round((warpParams.chance ?? 1) * 100) / 100}
          min={0}
          max={2}
          step={0.05}
          suffix="x"
          onChange={(chance) => updateParams(node.id, { chance })}
        />

        {/* The same habit the MOD panel has of saying why a cable is not doing what its owner expects.
            This one has two ways of failing in silence, and the second is worse than useless: wired
            beside the cable it was meant to replace, the node below fires twice — once through it and
            once around it — and the untransposed one masks the other, so the patch sounds untouched
            while everything on screen says the warp is working. */}
        {doingNothing && <p className="inspector-warn">Doing nothing: {doingNothing}.</p>}

        {/* Said here because a control that acts at a distance has to say how far it reaches, and
            because what a step means depends on the oscillator it lands on rather than on this node. */}
        <p className="inspector-empty">
          Wire it to an oscillator from the side. It bends that one and everything the cascade
          reaches from it, so one at the top of a branch takes the branch. Any two that reach the
          same note combine. A step is a degree of the scale on each oscillator it reaches, or a
          semitone where that oscillator is free — so a bass in pentatonic and a lead in minor both
          move a third and both stay in key.
        </p>
      </Panel>
    )
  }

  if (node.type === 'sieve') {
    const sieve = node.data.params as SieveParams
    const every = Math.min(MAX_EVERY, Math.max(1, Math.round(sieve.every ?? 1)))
    const offset = Math.min(every, Math.max(1, Math.round(sieve.offset ?? 1)))
    const counts = sieve.counts ?? 'passes'

    return (
      <Panel>
        <h2 className="inspector-title">
          SIEVE <span className="node-ordinal">{ordinal}</span>
        </h2>

        {/* What is being counted, before how many of them. The same number in a plain chain, so this
            changes nothing until the sieve sits under an oscillator sending on every step, below
            several parents, or inside a loop. */}
        <label className="inspector-field">
          <span className="inspector-label">Counts</span>
          <select
            value={counts}
            onChange={(e) =>
              updateParams(node.id, { counts: e.target.value as SieveParams['counts'] })
            }
          >
            <option value="passes">Passes</option>
            <option value="triggers">Triggers in</option>
          </select>
        </label>

        {/* The run first and the place in it second, which is the order the condition is read in:
            "of every two, the first". Both start at one, which counts nothing and passes everything. */}
        <Slider
          label="Every"
          value={every}
          min={1}
          max={MAX_EVERY}
          step={1}
          suffix={counts === 'triggers' ? ' triggers' : ' passes'}
          onChange={(value) =>
            // The place cannot outrun the run it is in: shortening one to two with the place at five
            // would leave a node whose condition can never be met, silent with nothing saying why.
            updateParams(node.id, { every: value, offset: Math.min(offset, value) })
          }
        />

        {every > 1 && (
          <Slider
            label={counts === 'triggers' ? 'On trigger' : 'On pass'}
            value={offset}
            min={1}
            max={every}
            step={1}
            onChange={(value) => updateParams(node.id, { offset: value })}
          />
        )}

        <Slider
          label="Chance"
          value={Math.round((sieve.chance ?? 1) * 100)}
          min={0}
          max={100}
          step={5}
          suffix="%"
          onChange={(value) => updateParams(node.id, { chance: value / 100 })}
        />

        <p className="inspector-empty">
          Holds a trigger and passes it on sometimes, the way a DELAY holds one and passes it on
          late. Everything below it happens only on the passes this lets through.
        </p>
        <p className="inspector-empty">
          Two of these over the same run, on the first and the second of every two, is how two
          branches take turns.
        </p>
        <p className="inspector-empty">
          Counting triggers instead divides whatever reaches it. Under an OSC sending on every step
          that is one arrival per step, so 1 of every 4 fires the branch on every fourth note.
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

  /*
   * A step, when one is being looked at, in place of the oscillator rather than beside it.
   *
   * The panel shows one thing and shows what was selected, which is how everything else here works — a
   * step is only a smaller thing to select. Showing both at once would put two scopes on screen and leave
   * it to the reader to work out which control belongs to which.
   */
  if (selectedStep !== null && params.steps?.[selectedStep]) {
    return (
      <StepPanel
        nodeId={node.id}
        ordinal={ordinal}
        index={selectedStep}
        step={params.steps[selectedStep]}
        params={params}
      />
    )
  }

  return (
    <Panel>
      <h2 className="inspector-title">
        OSC <span className="node-ordinal">{ordinal}</span>
      </h2>

      {/* The panel reads the way the cascade does: what happens first is written first. A note is
          chosen, then timed, then given a tone, then a shape, then a colour — and last of all
          the patch is told what to fire next. */}
      <Group title="SEQUENCE">
        {/* A slider rather than a list of four. It was 2, 4, 8 and 16 — powers of two, which is the most
            bar-like set there is, in an instrument whose premise is that there is no bar. Five against
            four is what a cascade should sound like, and the useful lengths are every one of them. */}
        <Slider
          label="Steps"
          value={params.steps?.length ?? DEFAULT_STEP_COUNT}
          min={MIN_STEPS}
          max={MAX_STEPS}
          step={1}
          onChange={(count) => setStepCount(node.id, count)}
        />

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

        {/* Which way the steps are read, beside Division because both are about how the sequence is
            traversed rather than what is in it. Only the *content* reverses: the groove stays forward,
            which is what playing a phrase backwards means. */}
        <label className="inspector-field">
          <span className="inspector-label">Direction</span>
          <select
            value={params.direction ?? 'forward'}
            onChange={(e) => set({ direction: e.target.value as Direction })}
          >
            {DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {DIRECTION_LABELS[d]}
              </option>
            ))}
          </select>
        </label>

        <Slider
          label="Gate"
          value={params.gate}
          min={0.05}
          max={1}
          step={0.05}
          onChange={(gate) => set({ gate })}
        />

        {/* Per oscillator rather than per patch. A scale is not a property of the piece but of the
            voice — a bass in pentatonic against a lead in minor is ordinary music, and one setting for
            everything forbids it. It bites while dragging a bar and nowhere else: changing it never
            retunes a sequence already written, because what is on the screen has to be what plays. */}
        <label className="inspector-field">
          <span className="inspector-label">Scale</span>
          <select
            value={params.scale ?? 'free'}
            onChange={(e) => set({ scale: e.target.value as ScaleName })}
          >
            {SCALES.map((option) => (
              <option key={option} value={option}>
                {SCALE_NAMES[option]}
              </option>
            ))}
          </select>
        </label>

        {(params.scale ?? 'free') !== 'free' && (
          <>
            <label className="inspector-field">
              <span className="inspector-label">Root</span>
              <select
                value={params.scaleRoot ?? 0}
                onChange={(e) => set({ scaleRoot: Number(e.target.value) })}
              >
                {ROOT_NAMES.map((name, pitch) => (
                  <option key={name} value={pitch}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            {/* The destructive half, asked for rather than happening. It rewrites the notes once, in
                front of you, and undo covers it — where a scale that quantised on playback would leave
                the bars showing one thing and the speakers saying another. */}
            <button
              type="button"
              className="btn inspector-fit"
              onClick={() => fitToScale(node.id, params.scale ?? 'free', params.scaleRoot ?? 0)}
            >
              FIT TO SCALE
            </button>
          </>
        )}

        {/* Beside Division and Gate, which is where they belong: those three are what this sequence's own
            time is. A warp scales them from outside, the way its Speed scales Division — and it has to be
            both places, because a warp reaches everything below whatever it is attached to, so swinging
            one oscillator that has anything hanging off it would be impossible from there. */}
        <label className="inspector-check">
          <input
            type="checkbox"
            checked={params.useSwing === true}
            onChange={(e) => set({ useSwing: e.target.checked })}
          />
          <span>Swing</span>
        </label>

        {params.useSwing && (
          <label className="inspector-field">
            <span className="inspector-label">Feel</span>
            <select
              value={String(params.swing ?? 1)}
              onChange={(e) => set({ swing: Number(e.target.value) })}
            >
              {SWINGS.map((ratio) => (
                <option key={ratio} value={String(ratio)}>
                  {swingLabel(ratio)}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="inspector-check">
          <input
            type="checkbox"
            checked={params.useSlop === true}
            onChange={(e) => set({ useSlop: e.target.checked })}
          />
          <span>Slop</span>
        </label>

        {params.useSlop && (
          <Slider
            label="Looseness"
            value={Math.round((params.slop ?? 0) * 100) / 100}
            min={0}
            max={MAX_SLOP}
            step={0.01}
            onChange={(slop) => set({ slop })}
          />
        )}

        {/* Both off until asked for, and both are switches rather than just values because the square
            under a bar already means armed or muted — once its fill can also mean a chance, a half-filled
            square has two readings. Turning one off keeps what the steps hold, so it can be turned back
            on and find the sequence as it was left. */}
        <label className="inspector-check">
          <input
            type="checkbox"
            checked={params.useChance === true}
            onChange={(e) => set({ useChance: e.target.checked })}
          />
          <span>Step chance</span>
        </label>

        <label className="inspector-check">
          <input
            type="checkbox"
            checked={params.useRatchet === true}
            onChange={(e) => set({ useRatchet: e.target.checked })}
          />
          <span>Ratchets</span>
        </label>
      </Group>

      {/* What the tone is, before anything moves it. Detune sits here rather than with glide because
          the axis these groups are cut along is standing against changing, and a detune does
          not move while a note lasts. */}
      <Group title="VOICE">
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

        <Slider
          label="Detune"
          value={params.detune ?? 0}
          min={-50}
          max={50}
          step={1}
          suffix=" ¢"
          onChange={(detune) => set({ detune })}
        />

        <Slider
          label="Gain"
          value={params.gain}
          min={0}
          max={1}
          step={0.01}
          onChange={(gain) => set({ gain })}
        />
      </Group>

      {/* How a note behaves over its life. Three of these move its loudness and one moves its pitch,
          which is one group and not two: what they have in common is that they are all
          happening while you hear them. */}
      <Group title="SHAPE">
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

        <Slider
          label="Glide"
          value={params.glide ?? 0}
          min={0}
          max={1000}
          step={5}
          suffix=" ms"
          onChange={(glide) => set({ glide })}
        />
      </Group>

      {/* Last of the sound groups because it is the only one that changes size — one control becomes
          four the moment it is switched on, and a group that grows unsettles less at the
          bottom than in the middle. */}
      <Group title="FILTER">
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
            <Slider
              label="Key follow"
              value={params.keyTrack ?? 0}
              min={0}
              max={1}
              step={0.05}
              onChange={(keyTrack) => set({ keyTrack })}
            />
          </>
        )}
      </Group>

      {/* On its own, and at the end, because it is not about this node at all: it is where this one
          finishes and the next begins. It spent a long time seventh in a flat list, which is
          a poor place for one of the few controls this whole instrument turns on. */}
      <Group title="NEXT">
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
      </Group>
    </Panel>
  )
}
