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

import { MAX_BITS, MAX_REDUCTION, MAX_REPEATS, MIN_BITS, MIN_REDUCTION, MIN_REPEATS } from './dsp'
import { effectOr } from './effects'
import { MAX_CUTOFF, MAX_RESONANCE, MIN_CUTOFF, MIN_RESONANCE } from './filter'
import {
  MAX_COMPRESS_ATTACK,
  MAX_DECAY,
  MAX_EQ_DB,
  MAX_RATIO,
  MAX_FEEDBACK,
  MAX_RATE as MAX_RATE_FX,
  MAX_SWEEP,
  MIN_DECAY,
  MIN_THRESHOLD,
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

/**
 * What each choice does — and, on the one that does not have it, what the other one offers.
 *
 * Scaling by velocity is three selections deep: a MOD is an LFO until told otherwise, an envelope fires on
 * a trigger until told otherwise, and only then does the control appear. That is the right place for it,
 * since only a per-note envelope has a note whose velocity it could read, but nothing pointed at it from
 * anywhere a person would be standing. So the trigger hint mentions it, which is where somebody is when
 * they are one step away.
 */
export const MOD_FIRES_HINTS: Record<ModFires, string> = {
  trigger:
    'One sweep each time a trigger reaches its top port. Under an Ignite that is once per pass; under a node deep in the cascade, once when that branch lights up. Firing on every note instead lets the sweep take its depth from each step’s velocity.',
  note: 'One sweep per note, each on that note’s own filter. Only an oscillator has notes, and each one can scale the sweep by its own velocity.',
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
/**
 * `random` is not a fifth waveform but a different behaviour: a value held, then jumped, at the rate.
 *
 * Every other shape here is periodic, so until this existed every modulation in the app was ultimately
 * predictable — a wobble you could learn. That sits badly with an instrument whose whole claim is that the
 * cascade breathes rather than keeping a pulse, which is also why we chose not to sync to a clock. A
 * stepped random is the one shape that varies without repeating.
 */
export type LfoShape = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'random'

export const LFO_SHAPES: readonly LfoShape[] = ['sine', 'triangle', 'square', 'sawtooth', 'random']

export const LFO_SHAPE_LABELS: Record<LfoShape, string> = {
  random: 'Random',
  sine: 'Sine',
  triangle: 'Triangle',
  square: 'Square',
  sawtooth: 'Saw',
}

/**
 * Cycles measured in beats rather than in hertz, for an LFO that should sit with the music.
 *
 * The echo has synced to the tempo since it existed, and an LFO could only be set in hertz — so a
 * wobble that was in time at 120 was out of it at 128, and the one control most likely to want the grid
 * was the one that could not have it.
 *
 * Beats and not bars, because there is no bar here: a bar needs a time signature and this instrument has
 * never had one. Four beats is what most people would call a bar and it is on the list; so is three, for
 * the people who would not.
 */
export const MOD_BEATS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32] as const

/** What an LFO's rate comes to in hertz, whether it was set in hertz or in beats. */
export function rateOf(
  rate: number,
  beats: number | undefined,
  synced: boolean,
  bpm: number,
): number {
  if (!synced || !beats || beats <= 0 || bpm <= 0) return rate
  // One cycle every `beats` beats, and a beat is sixty over the tempo.
  return bpm / 60 / beats
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
  /**
   * The one kind of node that may point at this, where it is not for everybody.
   *
   * Only `fm` uses it. An FM node's whole meaning is one destination — a carrier's pitch, over a range
   * forty-eight times wider than a vibrato's — so the target exists for it and would be a mistake in a
   * MOD's list, where Pitch already sits and means something a person can use. Withdrawn here rather
   * than filtered at each call site, for the same reason `via` is: a list built from what the source
   * *may* have is one truth, and a list built by hand beside it is two.
   */
  only?: string
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
  /**
   * The wavefolder's offset, and the reason the effect is worth having.
   *
   * A centred fold reflects both halves alike, which makes odd harmonics only and one hollow tone however
   * hard it is driven. Sweeping the offset moves *which* harmonics are there rather than how loud or how
   * bright the sound is — the one thing in this instrument that changes timbre without changing level or
   * filter. An effect whose best control could not be automated would be a control nobody found.
   *
   * Recomputed rather than connected, like every curve here: a thousand points is cheap enough to rebuild
   * on the modulation tick and there is no `AudioParam` behind a table.
   */
  bias: { key: 'bias', label: 'Bias', min: -1, max: 1, via: 'value', surcharge: 0 },
  /*
   * The EQ's three bands, in decibels.
   *
   * Connected rather than recomputed — each is a real `AudioParam` on a biquad — which makes these the
   * cheapest destinations in the whole table and the only place a *gain in decibels* is one. A MOD on the
   * top band is a tremolo that only touches the air; on the mid it is a wah that does not resonate.
   *
   * Priced at nothing on the argument the cutoffs established: automating a biquad's gain does not make
   * it recompute its coefficients per sample the way its frequency does, so this is nearer a gain than a
   * filter sweep. Unmeasured deliberately, being under what a sweep resolves (PLAN §24.6).
   */
  ...Object.fromEntries(
    (['low', 'mid', 'high'] as const).map((band) => [
      band,
      {
        key: band,
        label: `${band[0].toUpperCase()}${band.slice(1)}`,
        min: -MAX_EQ_DB,
        max: MAX_EQ_DB,
        via: 'audio' as const,
        surcharge: 0,
      },
    ]),
  ),
  bits: { key: 'bits', label: 'Bits', min: MIN_BITS, max: MAX_BITS, via: 'value', surcharge: 0 },
  /**
   * The resonator's tuning, in semitones.
   *
   * Declared over an octave either way rather than over the whole range the control offers, because a
   * depth is a *share* of the span: three octaves at full depth would make every setting below a tenth
   * unusable, and bending a resonator by an octave is already more than anybody wants. Same reasoning as
   * the vibrato on an oscillator, and the same shape of number.
   *
   * A resonator being bent while it rings is the best thing this effect does — it is the one modulation
   * here that sounds like a hand rather than like a control moving.
   */
  pitch: {
    key: 'pitch',
    label: 'Pitch',
    min: -12,
    max: 12,
    via: 'audio',
    // A note handed to a worklet once a block, which recomputes a delay length from it: one divide,
    // against the biquad recomputation a filter cutoff costs. Free by the same argument as the
    // decimator's hold, and unmeasured for the same reason — it is below what a sweep can resolve.
    surcharge: 0,
    hint: 'Bends the pitch the resonator rings at. Wired to an envelope it is a string being pulled; wired to an LFO it is one being wobbled.',
  },
  /**
   * The compressor's three, all real parameters on one native node and so all cheap.
   *
   * A **swept threshold** is the one worth having: a compressor that tightens as something else gets
   * louder, which is the nearest this instrument comes to a sidechain until there is a node that can
   * listen. Ratio and attack are here because they cost nothing to offer, not because anybody will reach
   * for them often.
   *
   * Priced at nothing on the argument the cutoffs established: these are set once a block by a node that
   * is doing its arithmetic either way.
   */
  threshold: {
    key: 'threshold',
    label: 'Threshold',
    min: MIN_THRESHOLD,
    max: 0,
    via: 'audio',
    surcharge: 0,
  },
  ratio: { key: 'ratio', label: 'Ratio', min: 1, max: MAX_RATIO, via: 'audio', surcharge: 0 },
  attack: {
    key: 'attack',
    label: 'Attack',
    min: 0,
    max: MAX_COMPRESS_ATTACK,
    via: 'audio',
    surcharge: 0,
  },
  /**
   * A stutter's repeat count, which is the effect's switch as much as its depth.
   *
   * One is a wire and eight is a bar of the cascade turned into an eighth of itself, so a MOD here is the
   * momentary control every beat-repeat has — and a slow shape on it is a stutter that comes and goes,
   * which no other arrangement of controls here can produce. A square LFO is the classic.
   *
   * A real `AudioParam` on the worklet, read once a block. A repeat count between two whole numbers is
   * not a sound anyway, so nothing is lost by it being coarse — the same argument as the decimator's.
   */
  repeats: {
    key: 'repeats',
    label: 'Repeats',
    min: MIN_REPEATS,
    max: MAX_REPEATS,
    via: 'audio',
    surcharge: 0,
  },
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
 * Where a parameter name means something other than the usual thing in one effect.
 *
 * The table above is keyed by *name*, which is what keeps a depth meaning the same on every effect that
 * borrows a field — and a name can genuinely mean two things. A cutoff that is not behind a filter of
 * its own costs nothing to sweep; a decay that is an `AudioParam` rather than a rebuilt buffer is not
 * merely cheaper, it is reached a different way. So an override patches the entry rather than only its
 * price, which is what the surcharge-only version of this could not express.
 */
const TARGET_OVERRIDES: Partial<Record<EffectKind, Record<string, Partial<ModTarget> | null>>> = {
  // A ring modulator's Freq borrows the cutoff field for its range, but what it sets is the carrier —
  // an oscillator's frequency, which is free to automate.
  ring: { cutoff: { surcharge: 0 } },
  // A phaser's stages are already swept by its own internal LFO, so their frequencies are automated
  // whether a MOD is there or not. A second signal into an already-automated parameter adds nothing.
  phaser: { cutoff: { surcharge: 0 } },
  /*
   * The resonator borrows two fields and means something different by both.
   *
   * Its Ring is a feedback amount solved for a time — a real `AudioParam` on the worklet, connected and
   * read once a block — where a reverb's Decay of the same name rebuilds two channels of impulse
   * response and is the dearest thing here to sweep. Same word, opposite cost, and a different route.
   *
   * Its Damping is the low-pass *inside* the loop rather than a tone control after the effect, so it is
   * also free: a coefficient the worklet recomputes from a number it is handed anyway.
   */
  comb: {
    decay: { via: 'audio', surcharge: 0, rebuildEvery: undefined },
    cutoff: { surcharge: 0 },
  },
  /*
   * A compressor's Release borrows `decay`, and on a reverb that means two channels of rebuilt impulse
   * response — the dearest thing here to sweep. Here it is a parameter on a native node, connected and
   * free. Same word, opposite cost, different route, which is what this table is for.
   */
  compress: { decay: { via: 'audio', surcharge: 0, rebuildEvery: undefined } },
  /*
   * A stutter's Slice borrows the echo's `time` field, and on the echo that is a `delayTime` — a real
   * parameter a signal can be added to. Here it is a *choice* of three divisions that decides how much
   * audio is captured, so there is nothing to connect to and nothing between two of them to reach.
   *
   * `null` withdraws it rather than repricing it, which is the first time the mechanism has had to. The
   * alternative was leaving it offered and unreachable — a cable a MOD would let you draw and that would
   * do nothing, which from the outside is indistinguishable from a bug.
   */
  stutter: { time: null },
}

/**
 * What an oscillator offers: its output and its filter.
 *
 * The filter is per voice rather than per node, so these two are not reached the way every other
 * target is — see the engine's voice links. They are the same two entries the effects use, and
 * deliberately so: same constants, same span, so a depth means the same thing on either.
 */
/**
 * How far a vibrato reaches at full depth, in cents. A semitone either way.
 *
 * Wide on purpose, because depth is a share of it: a tenth is ten cents, which is the shimmer most
 * patches want, and the whole range is available for the ones that want a siren. Narrower and the useful
 * settings would all live in the first sliver of the control.
 */
export const MAX_VIBRATO = 100

const PITCH: ModTarget = {
  key: 'pitch',
  label: 'Pitch',
  min: -MAX_VIBRATO,
  max: MAX_VIBRATO,
  via: 'audio',
  perVoice: true,
  /*
   * Reasoned rather than measured, and by the principle the measured ones established: automating a gain
   * is free and automating a filter roughly triples it, because a biquad recomputes its coefficients per
   * sample instead of per block. An oscillator reading an a-rate detune recomputes its phase increment,
   * which is one multiply against a biquad's five — so the same half point the cutoff carries is, if
   * anything, generous.
   *
   * Left unmeasured deliberately. A sweep resolves about one point per unit and this is under that, so
   * measuring it would produce a number with no more behind it than this sentence (PLAN §24.6).
   */
  surcharge: 0.5,
  hint: 'Bends the pitch of every note the oscillator plays. On the noise waveforms it shifts the grain instead, which is a texture rather than a note.',
}

/**
 * How far an FM node can bend a carrier: four octaves either way.
 *
 * A vibrato reaches a semitone because that is where a vibrato stops being one. FM is the opposite
 * question — the sidebands that make the sound only appear once the deviation is comparable to the
 * carrier's own frequency, so the useful range starts about where Pitch's ends.
 */
export const MAX_FM_CENTS = 4800

/**
 * The carrier's pitch, as an FM node reaches it.
 *
 * The same `detune` the vibrato uses, and deliberately: one per-voice path, already built and already
 * tested, that works on every waveform — including the noise ones, where there is no frequency at all
 * and it shifts the grain instead. What differs is only the span, which is what makes this a separate
 * entry rather than a wider Pitch: widening Pitch would turn every existing vibrato into a siren.
 *
 * That also makes this **exponential** FM: the deviation is in cents, so a symmetric swing is wider
 * upward in hertz than downward, and the carrier's perceived pitch rises as the index opens. Classic FM
 * is linear, in hertz, and it is the reason this is worth writing down — if that drift turns out to be
 * the thing that spoils it, linear becomes a second mode on the node rather than a rewrite of this.
 */
const FM: ModTarget = {
  key: 'fm',
  label: 'Index',
  min: -MAX_FM_CENTS,
  max: MAX_FM_CENTS,
  via: 'audio',
  perVoice: true,
  only: 'fm',
  // The same reasoning as Pitch's, which this shares a parameter with: an oscillator reading an a-rate
  // detune recomputes its phase increment, one multiply against a biquad's five.
  surcharge: 0.5,
  hint: 'How far the modulator bends the carrier, in cents. The modulator’s own level scales it, so its envelope is the shape of the index.',
}

const OSC_TARGETS: readonly ModTarget[] = [
  LEVEL,
  PITCH,
  FM,
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
  const overrides = TARGET_OVERRIDES[effect]
  const own = descriptor.params
    // A `null` override withdraws the target on this effect — see `TARGET_OVERRIDES`. Filtered before the
    // lookup rather than after, so a withdrawn one costs nothing and reads as absent rather than as
    // present-and-broken.
    .filter((key) => overrides?.[key] !== null)
    .map((key) => FX_PARAM_TARGETS[key])
    .filter((target): target is ModTarget => target !== undefined)
    .map((target) => ({
      ...target,
      // The effect's own name for it, where it has renamed one: a phaser calls its cutoff Centre.
      label: descriptor.labels?.[target.key as keyof FxParams] ?? target.label,
      ...overrides?.[target.key],
    }))

  return [LEVEL, MIX, ...own]
}

/**
 * What one kind of source may point at on one kind of destination, which is narrower than what the
 * destination *has* in two different ways.
 *
 * **A follower cannot reach a parameter that is rebuilt rather than connected.** Its level lives on the
 * audio thread and nothing on this side can read it, where the ones marked `via: 'value'` are driven by
 * a timer computing the modulator's own phase — arithmetic a MOD can do and a SENSE cannot.
 *
 * **And a target may belong to one source alone**, which is `only`: an FM node's Index is the carrier's
 * pitch over four octaves, and offering that in a MOD's list beside Pitch would be offering a siren.
 *
 * One function rather than a filter at each call site. Both of these were about to be written twice —
 * the panel, the dice and the router all ask the same question — and a list built by hand beside the
 * table it is derived from is this repository's most familiar bug.
 */
export function targetsFrom(
  sourceType: string | undefined,
  nodeType: string | undefined,
  effect?: EffectKind,
): readonly ModTarget[] {
  const all = targetsFor(nodeType, effect)

  /*
   * A source with a target of its own gets that and nothing else.
   *
   * An FM node has one destination — it is what the node *is* — so its list is one entry rather than the
   * general one with an extra on the end. That also means it never has a target to choose, which is why
   * it carries an index and no target at all.
   */
  const mine = all.filter((target) => target.only === sourceType)
  if (mine.length > 0) return mine

  return all.filter(
    (target) => target.only === undefined && (sourceType !== 'sense' || target.via !== 'value'),
  )
}

/**
 * The description of one target, on one kind of node.
 *
 * `nodeType` is **required**, and that is the whole of this function's history. It used to be optional,
 * falling back to the effect parameter table plus level and mix — which was right for as long as no name
 * meant two things. Then `pitch` did: an oscillator's vibrato reaches a hundred cents either way and a
 * comb resonator's tuning twelve semitones, and since a depth is a *share* of the span, the wrong
 * descriptor makes a full-depth vibrato eight times too small. Nothing throws and nothing looks wrong.
 *
 * That fault had already been found once, in `connectMod`, and fixed there — leaving the fallback in
 * place for the next caller to find. Requiring the argument is what makes the compiler find them instead
 * of a listener finding them one at a time.
 */
export function targetOf(key: ModTargetKey | undefined, nodeType: string, effect?: EffectKind) {
  return targetsFor(nodeType, effect).find((target) => target.key === key)
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
  /** Which kind of node is asking, since that narrows what it may point at. See `targetsFrom`. */
  sourceType = 'mod',
): ModTargetKey | null {
  const offered = targetsFrom(sourceType, nodeType, effect)
  if (offered.length === 0) return null
  if (offered.some((target) => target.key === key)) return key as ModTargetKey

  /*
   * Falling back to `level` by name rather than to whatever happens to be first.
   *
   * Insurance rather than a fix, and worth saying which. It was positional, and putting pitch at the head
   * of the oscillator's list briefly meant a modulation whose target had vanished would have become a
   * vibrato instead of a tremolo — caught before it shipped, and fixed properly by putting level back at
   * the head where it belongs. Today every destination lists level first, so by name and by position give
   * the same answer and this line changes nothing.
   *
   * It stays because it says at the call site what the rule *is*, instead of leaving it to be inferred
   * from an ordering that nothing at the call site can see. `modulation.test.ts` asserts the invariant
   * that actually protects the behaviour: every destination offers level, and offers it first.
   */
  const level = offered.find((target) => target.key === 'level')
  return (level ?? offered[0]).key
}

/**
 * Depth as a share of the target's own span, so one control means the same thing everywhere.
 *
 * Signed, which it was not. A modulation could only ever be added to what it pointed at — so an envelope
 * could open a filter and never close one, and two LFOs could not be set against each other. Inverting
 * is not a second kind of modulation, it is the same one read the other way round, so it belongs inside
 * the number rather than beside it as a switch.
 */
export function amountFor(target: ModTarget, depth: number): number {
  return Math.max(-1, Math.min(1, depth)) * (target.max - target.min) * 0.5
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

/**
 * A follower is a worklet, and a worklet is dearer than an oscillator and a gain.
 *
 * **A prior, not a measurement.** The sweep that priced the voice and the effects has not been run since
 * this was added, and the honest thing is to say so rather than to let a number imply a reading. Set from
 * the two worklets that have been measured — the bitcrusher's decimator and the comb — as the cheaper of
 * the two: this one does two multiplies and a compare per sample and keeps no buffer.
 */
export const FOLLOW_COST = 4

/**
 * An FM node is two gains and a connection, which is the cheapest thing in this file.
 *
 * A prior like the follower's, and a much safer one: there is no processor, no buffer and no per-sample
 * work of its own — the whole cost is the carrier reading an a-rate `detune`, and that is already priced
 * on the target as a surcharge. Half a point for the pair of gains, which is what a MOD costs for the
 * same reason.
 */
export const FM_COST = 0.5
