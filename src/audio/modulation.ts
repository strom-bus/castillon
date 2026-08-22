/**
 * The MOD module: what it can be, and what it can point at (PLAN §18).
 *
 * Only **audio-rate** modulation lives here — a signal connected into an `AudioParam`, which Web
 * Audio does natively and for nothing. Event-rate modulation, where the scheduler would read a
 * modulator's value as it fires a note, is a different machine and §18.3 keeps it out on purpose.
 *
 * The target list is short in this first pass and the reason is structural rather than a choice: an
 * effect's chain exposes only an input and an output, so nothing inside one can be pointed at by
 * name. What is reachable is what the engine already holds as its own nodes — an oscillator's output
 * bus, an effect's level, and the pair of gains that make up its mix.
 */

import { MAX_BITS, MAX_REDUCTION, MIN_BITS, MIN_REDUCTION } from './dsp'
import { effectOr } from './effects'
import { MAX_CUTOFF, MAX_RESONANCE, MIN_CUTOFF, MIN_RESONANCE } from './filter'
import {
  MAX_DECAY,
  MAX_FEEDBACK,
  MAX_RATE as MAX_RATE_FX,
  MAX_SWEEP,
  MIN_DECAY,
  MIN_RATE as MIN_RATE_FX,
  MIN_SWEEP,
  type EffectKind,
  type FxParams,
} from '../types/patch'

export type ModKind = 'lfo' | 'env'

export const MOD_KINDS: readonly ModKind[] = ['lfo', 'env']

export const MOD_KIND_LABELS: Record<ModKind, string> = {
  lfo: 'LFO',
  env: 'Envelope',
}

export const MOD_KIND_HINTS: Record<ModKind, string> = {
  lfo: 'Runs continuously at its own rate, whatever the music is doing.',
  env: 'Runs once, when something starts it.',
}

/** What starts an envelope. Not a shape but a clock, which is the whole difference here. */
export type ModFires = 'trigger' | 'note'

export const MOD_FIRES: readonly ModFires[] = ['trigger', 'note']

export const MOD_FIRES_LABELS: Record<ModFires, string> = {
  trigger: 'A trigger',
  note: 'Every note',
}

export const MOD_FIRES_HINTS: Record<ModFires, string> = {
  trigger:
    'One sweep each time a trigger reaches its top port. Under an Ignite that is once per pass; under a node deep in the cascade, once when that branch lights up.',
  note: 'One sweep per note, each on that note’s own filter. Only an oscillator has notes.',
}

/**
 * Why an envelope set to fire per note will not, or null if it will.
 *
 * Per note needs a target that is *built* per note, and there is exactly one: an oscillator's filter,
 * one biquad per voice. Everything else is a single node shared by every note — an effect's cutoff, or
 * even an oscillator's own level, which is its output bus. Pointed at one of those there is one
 * parameter and many notes, and no honest answer to which note owns it.
 *
 * The same shape of answer as `silentBecause`, and for the same reason: a modulator that has quietly
 * stopped meaning anything should say which of its settings stopped meaning it.
 */
export function noNotesBecause(
  fires: ModFires | undefined,
  target: ModTargetKey | undefined,
  destination: Destination,
): string | null {
  if (fires !== 'note') return null
  if (!destination.nodeType) return null

  const described = target ? targetOf(target, destination.nodeType, destination.effect) : undefined
  if (described?.perVoice) return null

  return destination.nodeType === 'osc'
    ? 'only an oscillator’s filter is built per note'
    : 'only an oscillator has notes'
}

/** The four an `OscillatorNode` can make natively. An LFO has no use for a pulse width. */
export type LfoShape = 'sine' | 'triangle' | 'square' | 'sawtooth'

export const LFO_SHAPES: readonly LfoShape[] = ['sine', 'triangle', 'square', 'sawtooth']

export const LFO_SHAPE_LABELS: Record<LfoShape, string> = {
  sine: 'Sine',
  triangle: 'Triangle',
  square: 'Square',
  sawtooth: 'Saw',
}

/** Slow enough to be a shape, fast enough to be a texture. */
export const MIN_RATE = 0.05
export const MAX_RATE = 20
/**
 * Where the cable stops speeding up (§18.6).
 *
 * Past this nobody can see individual cycles, and a strobing cable reads as broken rather than fast.
 * "Too fast to see" is honest information, so above it the cable simply stays lit.
 */
export const PULSE_RATE_CEILING = 8

/**
 * What a modulator can point at.
 *
 * `level` and `mix` belong to the engine — an oscillator's bus and an effect's pair of gains — and
 * every other key is a parameter of the effect the cable landed on. Which is the point of the whole
 * table: a MOD wired to a reverb should offer that reverb's decay, not a generic pair of choices.
 */
export type ModTargetKey = string

/**
 * How a parameter is reached.
 *
 * `audio` is an `AudioParam` the effect's chain hands over, and Web Audio adds the modulator to it for
 * nothing. `value` is a number that has to be recomputed and pushed through the effect's `update` —
 * a reverb's decay rebuilds an impulse response and a bitcrusher's depth rebuilds a curve, so neither
 * is an `AudioParam` and neither can be connected to. Both are modulation; only one is free.
 */
export type ModVia = 'audio' | 'value'

export interface ModTarget {
  key: ModTargetKey
  label: string
  /** Depth is a share of this span, so one depth control means the same thing on every parameter. */
  min: number
  max: number
  via: ModVia
  hint?: string
  /**
   * What sweeping this adds to the thing being swept, in budget points — over and above what the
   * modulator itself costs.
   *
   * Measured rather than reasoned (PLAN §11.10), and the shape of the answer is simple: **automating a
   * gain is free and automating a filter is not.** A `GainNode` reading a per-sample value instead of
   * a constant costs nothing worth counting; a biquad has to recompute its coefficients per sample
   * instead of per block, which roughly triples it.
   */
  surcharge: number
  /**
   * Whether that is paid once or once per sounding voice.
   *
   * An oscillator's filter is built per note, so one cable sweeps as many biquads as there are voices
   * in the air — which is what makes this the largest surcharge of the connected kind.
   */
  perVoice?: boolean
  /**
   * Seconds between recomputations, for the targets that rebuild something rather than being
   * connected. Left out means every tick of the driver, twenty times a second.
   */
  rebuildEvery?: number
}

/** The two the engine owns, offered wherever they apply. */
const LEVEL: ModTarget = {
  key: 'level',
  label: 'Level',
  min: 0,
  max: 1,
  via: 'audio',
  surcharge: 0,
  hint: 'How loud it is. On an oscillator this is a tremolo; on an effect it fades the effect in and out.',
}

const MIX: ModTarget = {
  key: 'mix',
  label: 'Mix',
  min: 0,
  max: 1,
  via: 'audio',
  surcharge: 0,
  hint: 'How much of the effect is heard against the clean signal, swept rather than set.',
}

/**
 * Every effect parameter that can be modulated, with the range its depth is measured against.
 *
 * The bounds are imported rather than written here: they are the same numbers the inspector's sliders
 * use, and a second copy of them would drift. `filterType` and `shape` are absent on purpose — they
 * are choices from a list, and a smooth wave has nothing to say to them.
 */
const FX_PARAM_TARGETS: Record<string, ModTarget> = {
  // The two behind a biquad, and the only two that cost anything to sweep.
  cutoff: {
    key: 'cutoff',
    label: 'Cutoff',
    min: MIN_CUTOFF,
    max: MAX_CUTOFF,
    via: 'audio',
    // Nothing measurable. A sweep put 248 modulated cutoffs against 240 unmodulated ones and the audio
    // thread failed at the same load either way, so whatever this costs is under the method's resolution
    // of about one point per unit — shared with MOD_COST, that leaves half a point each.
    surcharge: 0.5,
  },
  resonance: {
    key: 'resonance',
    label: 'Resonance',
    min: MIN_RESONANCE,
    max: MAX_RESONANCE,
    via: 'audio',
    // As cutoff: below what the instrument can resolve.
    surcharge: 0.5,
  },
  // Gains, an oscillator's frequency and a delay time. All measured at nothing worth counting.
  rate: {
    key: 'rate',
    label: 'Rate',
    min: MIN_RATE_FX,
    max: MAX_RATE_FX,
    via: 'audio',
    surcharge: 0,
  },
  depth: { key: 'depth', label: 'Depth', min: 0, max: 1, via: 'audio', surcharge: 0 },
  feedback: {
    key: 'feedback',
    label: 'Feedback',
    min: 0,
    max: MAX_FEEDBACK,
    via: 'audio',
    surcharge: 0,
  },
  sweep: {
    key: 'sweep',
    label: 'Sweep',
    min: MIN_SWEEP,
    max: MAX_SWEEP,
    via: 'audio',
    surcharge: 0,
  },
  time: { key: 'time', label: 'Time', min: 0, max: 1, via: 'audio', surcharge: 0 },
  pan: { key: 'pan', label: 'Pan', min: -1, max: 1, via: 'audio', surcharge: 0 },
  // Not AudioParams: each of these rebuilds something or is spread over several, so it is driven by
  // recomputation instead.
  //
  // Width is the second sort. On an echo it is a pair of pans that move against each other and on a
  // pan it is a delay in seconds, so one connection could not carry it in the right units either way
  // — whereas the effect's own `update` already knows both.
  width: { key: 'width', label: 'Width', min: 0, max: 1, via: 'value', surcharge: 0 },
  /**
   * The expensive one, by a wide margin and for a plain reason: it is the only parameter here whose
   * recomputation *allocates*. A new impulse response is two channels of up to ten seconds, and
   * rebuilding that twenty times a second measured at about 130 points — more than the whole budget.
   *
   * So it is rebuilt four times a second instead, which is ample for a gesture nobody sweeps quickly.
   * Measured at 12.7 afterwards — a tenfold improvement rather than the fivefold the change to the
   * rate implied, because the reverb's own guard on a tenth of a second of decay skips a rebuild the
   * driver would otherwise have asked for. Still by far the dearest thing to sweep, and now affordable.
   */
  decay: {
    key: 'decay',
    label: 'Decay',
    min: MIN_DECAY,
    max: MAX_DECAY,
    via: 'value',
    surcharge: 13,
    rebuildEvery: 0.25,
  },
  // A curve, not a buffer: a few hundred floats rather than a few hundred thousand.
  drive: { key: 'drive', label: 'Drive', min: 0, max: 1, via: 'value', surcharge: 0 },
  bits: { key: 'bits', label: 'Bits', min: MIN_BITS, max: MAX_BITS, via: 'value', surcharge: 0 },
  /**
   * The decimator's hold count, which lives on a worklet.
   *
   * Connected rather than recomputed, unlike the rest of the bitcrusher's parameters: it is a real
   * `AudioParam`, read once a block rather than once a sample. A hold count between two whole numbers
   * is not a sound anyway, so nothing is lost by it being coarse.
   *
   * Priced at nothing until it has been measured — a worklet is JavaScript on the audio thread and
   * may not behave like a native node here.
   */
  reduction: {
    key: 'reduction',
    label: 'Decimate',
    min: MIN_REDUCTION,
    max: MAX_REDUCTION,
    via: 'audio',
    surcharge: 0,
  },
}

/**
 * Where a parameter name means something other than the usual thing, so the surcharge does too.
 *
 * Both of these are a cutoff that is not behind a filter of its own, and both measured at nothing.
 */
const SURCHARGE_OVERRIDES: Partial<Record<EffectKind, Record<string, number>>> = {
  // A ring modulator's Freq borrows the cutoff field for its range, but what it sets is the carrier —
  // an oscillator's frequency, which is free to automate.
  ring: { cutoff: 0 },
  // A phaser's stages are already swept by its own internal LFO, so their frequencies are automated
  // whether a MOD is there or not. A second signal into an already-automated parameter adds nothing.
  phaser: { cutoff: 0 },
}

/**
 * What an oscillator offers: its output and its filter.
 *
 * The filter is per voice rather than per node, so these two are not reached the way every other
 * target is — see the engine's voice links. They are the same two entries the effects use, and
 * deliberately so: same constants, same span, so a depth means the same thing on either.
 */
const OSC_TARGETS: readonly ModTarget[] = [
  LEVEL,
  {
    ...FX_PARAM_TARGETS.cutoff,
    hint: 'Sweeps the filter of every note the oscillator plays.',
    perVoice: true,
  },
  {
    ...FX_PARAM_TARGETS.resonance,
    hint: 'Swells the peak at the cutoff, note by note.',
    perVoice: true,
  },
]

/** As much of what a MOD is wired to as decides what it can point at, and whether that does anything. */
export interface Destination {
  nodeType?: string
  effect?: EffectKind
  /** An oscillator's filter type. `off` skips the biquad, so no voice builds one to sweep. */
  filterType?: string
}

/**
 * Why a target cannot do anything at the moment, or null if it can.
 *
 * A target list is built from what a destination *has*, which is not the same as what it is doing. An
 * oscillator has a filter whatever its type is set to, and `off` skips the biquad entirely — so a MOD
 * pointed at that cutoff is aimed at something no voice will ever build.
 *
 * Reported rather than removed, and that is the design decision worth stating. Dropping the option
 * would make `resolveTarget` quietly move a MOD that already points there onto the level instead,
 * which is an edit nobody asked for and which nothing on screen would explain. A parameter that says
 * why it is silent is a smaller surprise than one that changes what it is under you.
 */
export function silentBecause(target: ModTargetKey, destination: Destination): string | null {
  if (destination.nodeType !== 'osc') return null
  if (target !== 'cutoff' && target !== 'resonance') return null
  return destination.filterType === 'off' ? 'the oscillator’s filter is off' : null
}

/**
 * The targets a destination offers.
 *
 * For an effect this is its own parameter list — the reason a MOD on a reverb offers Decay and one on
 * a chorus offers Sweep — with the engine's two in front, since they apply to every effect.
 */
export function targetsFor(
  nodeType: string | undefined,
  effect?: EffectKind,
): readonly ModTarget[] {
  if (nodeType === 'osc') return OSC_TARGETS
  if (nodeType !== 'fx') return []

  if (!effect) return [LEVEL, MIX]

  const descriptor = effectOr(effect)
  const own = descriptor.params
    .map((key) => FX_PARAM_TARGETS[key])
    .filter((target): target is ModTarget => target !== undefined)
    .map((target) => ({
      ...target,
      // The effect's own name for it, where it has renamed one: a phaser calls its cutoff Centre.
      label: descriptor.labels?.[target.key as keyof FxParams] ?? target.label,
      surcharge: SURCHARGE_OVERRIDES[effect]?.[target.key] ?? target.surcharge,
    }))

  return [LEVEL, MIX, ...own]
}

export function targetOf(key: ModTargetKey | undefined, nodeType?: string, effect?: EffectKind) {
  if (nodeType) return targetsFor(nodeType, effect).find((target) => target.key === key)
  return key === 'mix' ? MIX : key === 'level' ? LEVEL : FX_PARAM_TARGETS[key ?? '']
}

/**
 * A target that no longer exists falls back rather than going silent.
 *
 * The problem §18.4 named, and switching an effect is how it happens: a MOD pointed at a reverb's
 * Decay, on a node turned into a chorus, is pointing at nothing. Level is on everything, so that is
 * where a lost target lands.
 */
export function resolveTarget(
  key: ModTargetKey | undefined,
  nodeType: string | undefined,
  effect?: EffectKind,
): ModTargetKey | null {
  const offered = targetsFor(nodeType, effect)
  if (offered.length === 0) return null
  return offered.some((target) => target.key === key) ? (key as ModTargetKey) : offered[0].key
}

/** Depth as a share of the target's own span, so one control means the same thing everywhere. */
export function amountFor(target: ModTarget, depth: number): number {
  return Math.max(0, Math.min(1, depth)) * (target.max - target.min) * 0.5
}

/**
 * An LFO is an oscillator and a gain. Cheap, and paid for the whole time it exists (§2.2b).
 *
 * The earlier readings of 0.9, 1.24 and 1.17 all came from offline renders, and a render charges an LFO
 * as if it were most of a voice. It is not: a voice's gain carries a four-point envelope and its own
 * biquad, and it is built and destroyed on every note, where an LFO is made once and then simply runs.
 *
 * Against a real dropout the difference does not show at all. The sweep's own control is modulating a
 * plain gain — work the model prices at exactly this constant and nothing else — and 287 units of it
 * broke no sooner than 240 units carrying no modulator. So the true figure is under the method's
 * resolution, about a point per unit, and this is half of that with the target surcharge taking the rest.
 *
 * What this does *not* count is the cost a modulator adds to its destination. That is the `surcharge`
 * on each target, because it depends on what is being swept and not on the modulator.
 */
export const MOD_COST = 0.5
