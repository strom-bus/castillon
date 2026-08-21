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

import { MAX_BITS, MIN_BITS } from './dsp'
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

export type ModKind = 'lfo'

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
}

/** The two the engine owns, offered wherever they apply. */
const LEVEL: ModTarget = {
  key: 'level',
  label: 'Level',
  min: 0,
  max: 1,
  via: 'audio',
  hint: 'How loud it is. On an oscillator this is a tremolo; on an effect it fades the effect in and out.',
}

const MIX: ModTarget = {
  key: 'mix',
  label: 'Mix',
  min: 0,
  max: 1,
  via: 'audio',
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
  cutoff: { key: 'cutoff', label: 'Cutoff', min: MIN_CUTOFF, max: MAX_CUTOFF, via: 'audio' },
  resonance: {
    key: 'resonance',
    label: 'Resonance',
    min: MIN_RESONANCE,
    max: MAX_RESONANCE,
    via: 'audio',
  },
  rate: { key: 'rate', label: 'Rate', min: MIN_RATE_FX, max: MAX_RATE_FX, via: 'audio' },
  depth: { key: 'depth', label: 'Depth', min: 0, max: 1, via: 'audio' },
  feedback: { key: 'feedback', label: 'Feedback', min: 0, max: MAX_FEEDBACK, via: 'audio' },
  sweep: { key: 'sweep', label: 'Sweep', min: MIN_SWEEP, max: MAX_SWEEP, via: 'audio' },
  time: { key: 'time', label: 'Time', min: 0, max: 1, via: 'audio' },
  pan: { key: 'pan', label: 'Pan', min: -1, max: 1, via: 'audio' },
  // Not AudioParams: each of these rebuilds something or is spread over several, so it is driven by
  // recomputation instead.
  //
  // Width is the second sort. On an echo it is a pair of pans that move against each other and on a
  // pan it is a delay in seconds, so one connection could not carry it in the right units either way
  // — whereas the effect's own `update` already knows both.
  width: { key: 'width', label: 'Width', min: 0, max: 1, via: 'value' },
  decay: { key: 'decay', label: 'Decay', min: MIN_DECAY, max: MAX_DECAY, via: 'value' },
  drive: { key: 'drive', label: 'Drive', min: 0, max: 1, via: 'value' },
  bits: { key: 'bits', label: 'Bits', min: MIN_BITS, max: MAX_BITS, via: 'value' },
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
    hint: "Sweeps the filter of every note it plays. The oscillator's filter has to be on.",
  },
  {
    ...FX_PARAM_TARGETS.resonance,
    hint: "Swells the peak at the cutoff. The oscillator's filter has to be on.",
  },
]

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

/** An LFO is an oscillator and a gain. Cheap, and paid for the whole time it exists (§2.2b). */
export const MOD_COST = 1.1
