import type { ScaleName } from '../audio/scales'

/** Patch data model. Everything here is JSON-serialisable: no Web Audio objects. */

export type NodeId = string

/**
 * The two overlaid graphs. Event cables carry timestamped triggers down the cascade; audio cables
 * carry signal sideways from an oscillator into an effect.
 */
/**
 * The three kinds of cable.
 *
 * `event` is the cascade and it flows. `audio` is signal and it glows. `mod` looks like audio — white
 * and grey — and pulses at its own rate, which is what tells the two apart (PLAN §18): the difference
 * is a behaviour rather than a colour, because colour already means cascade depth.
 */
/**
 * `shift` is what a WARP hangs on, and it is a fourth kind rather than a reuse of `mod` for the
 * same reason `mod` was not a reuse of `audio`: it neither carries sound nor sweeps a value, it changes
 * what a branch plays. Drawn to the side like modulation because that is what it has in common with it —
 * it attaches to a node instead of standing in the cascade.
 */
export type EdgeKind = 'event' | 'audio' | 'mod' | 'warp'

export type Division = '1/4' | '1/8' | '1/16'

export type PropagateMode = 'onEnd' | 'onStart' | 'onStep'

/**
 * `pulse` is not a native Web Audio type: it is synthesised with a `PeriodicWave`
 * (see audio/waveforms.ts). The noise colours are played back from generated buffers
 * (see audio/noise.ts). The rest are native oscillator types.
 */
export type Waveform =
  | 'sine'
  | 'triangle'
  | 'sawtooth'
  | 'ramp'
  | 'square'
  | 'pulse'
  | 'white'
  | 'pink'
  | 'brown'
  | 'blue'

/**
 * The oscillator's per-voice filter, and also one of the FX effects. They are not the same sound:
 * per voice, sixteen notes get sixteen filters; as an effect, one filter processes the sum.
 * `off` skips the biquad entirely.
 */
export type FilterType = 'off' | 'lowpass' | 'highpass' | 'bandpass'

/** Hits a step may fire inside its own slot. Four is a roll; past that it stops being one. */
export const MAX_RATCHET = 4

export interface Step {
  /** MIDI note. C1 = 24, C6 = 84. */
  note: number
  active: boolean
  velocity: number
  /**
   * How often this step actually sounds, 0–1. One is every time, which is what every step did before.
   *
   * Judged once for the whole step and not once per hit: a step happens or it does not, and if it does,
   * all of its hits do. Rolling for each hit of a four-hit ratchet turns it into a stutter — a good sound,
   * and a poor default, since it makes a plain sequence unpredictable in a way nobody asked for.
   */
  chance?: number
  /**
   * Hits inside the step's own slot. One is an ordinary note.
   *
   * Deliberately a count and not a count plus a mode. A roll is a rhythmic gesture and repeating the note
   * is what nearly everyone means by it; a mode toggle would cost every reader attention to serve the few
   * who leave it. If it ever wants to climb, that arrives as a signed number whose zero is "repeat" —
   * a value with a neutral point rather than a second control that only ever says "not the usual thing".
   */
  ratchet?: number
  /**
   * Whether this note slides in from the one before it.
   *
   * Which note slides belongs to the note; how long the slide takes belongs to the oscillator, and stays
   * there as `glide`. That split is how the machines this gesture comes from do it, and it is also the
   * cheaper half: a flag is one bit a step where a time would be ten, and a sequence where every slide
   * lasts a different length is not a thing anybody has asked for.
   *
   * One value for a whole sequence could only ever say that every note glides or none does. The line
   * worth having is the one where some do.
   */
  slide?: boolean
}

export interface OscParams {
  waveform: Waveform
  /** Pulse duty cycle, 0–1. Only used with `waveform: 'pulse'`. */
  pulseWidth: number
  /**
   * Cents off the note, ±50. The cascade's answer to unison.
   *
   * A classic thickens a sound by stacking voices on one oscillator, which here would multiply the load
   * budget. The cascade already gives you several oscillators; what it does not give is a reason for two
   * of them to read as one voice instead of two. A few cents apart is that reason, and it adds no voices.
   */
  detune: number
  steps: Step[]
  division: Division
  /** 0–1 */
  gain: number
  /** Milliseconds. */
  attack: number
  /**
   * Milliseconds to fall from the attack peak to silence, or 0 to hold the peak until the note ends.
   *
   * There is deliberately no sustain level to go with it. A sustain stage exists on a keyboard because
   * a keyboard cannot know how long the key will be held; here every note is scheduled with a duration
   * known in advance, and then the two controls stop being independent — a decay reaching zero at a
   * third of the note is a pluck, and one that would take three times the note is a flat top. The time
   * alone already sweeps from percussive to sustained, and a level would only add the ability to stop
   * decaying, which is the same thing as choosing a longer decay (PLAN §18.9).
   */
  decay: number
  release: number
  /**
   * Milliseconds to slide from the previous step's pitch into this one's. 0 jumps, as before.
   *
   * Per oscillator rather than per patch, because in a cascade a step list belongs to one oscillator and
   * the slide is between *its* consecutive notes — which is the same gesture as a 303's, and the one
   * classic control that reads as melodic intent rather than as timbre. It also does something here that
   * it cannot do on a keyboard: the cascade retriggers the same oscillator over and over, so a glide
   * turns a list of steps into a continuous line rather than a sequence of separate events.
   */
  glide: number
  /** Fraction of the step the note lasts. 0.6 is percussive, 1 is legato. */
  gate: number
  filterType: FilterType
  /** Hz. Edited on a log slider; see audio/filter.ts. */
  cutoff: number
  /**
   * Whether this sequencer uses per-step chance at all. Off by default.
   *
   * A switch and not just the values, because the square under a bar already means armed or muted — and
   * once its fill can also mean a chance, a half-filled square has two readings. Knowing which the
   * sequencer is in takes the ambiguity out of the symbol. It also keeps the step panel to what is being
   * used: a control nobody has turned on is a question nobody asked.
   *
   * Switching it off keeps the values rather than clearing them, so it can be switched back on.
   */
  useChance?: boolean
  /** Whether this sequencer uses per-step ratchets at all. Off by default, and kept when off. */
  useRatchet?: boolean
  /**
   * Which notes dragging a bar is allowed to land on. `free` is anything, and is the default.
   *
   * It bites while editing and nowhere else: changing it never retunes a sequence already written, since
   * what is on the screen has to be what plays. See `audio/scales.ts`.
   */
  scale?: ScaleName
  /** The scale's root as a pitch class, 0 being C. Meaningless while the scale is free. */
  scaleRoot?: number
  /** Biquad Q. */
  resonance: number
  /**
   * How much of the note's pitch the cutoff follows, 0–1. At 1 it doubles every octave.
   *
   * Measured up from C1, so it only ever opens the filter. See `trackedCutoff` for why absolute Hz is
   * the wrong unit on an instrument that picks its own register.
   */
  keyTrack: number
  propagateMode: PropagateMode
}

/**
 * The effects an FX node can be. Append-only: the patch code stores the index into this order.
 * Only `gain` is implemented so far; the rest land one row at a time.
 */
export type EffectKind =
  | 'reverb'
  | 'echo'
  | 'distortion'
  | 'crush'
  | 'filter'
  | 'chorus'
  | 'phaser'
  | 'tremolo'
  | 'ring'
  | 'pan'
  | 'octave'

/**
 * One flat parameter set for every effect, with the inspector showing only the fields the current
 * effect declares. A discriminated union would give tidier types at the cost of a variable-shape
 * record in the store and a variable layout in the bit packer.
 *
 * Every field is encoded whether the current effect uses it or not. That costs a few bits and buys
 * two things: switching effect keeps whatever carries over, and adding an effect never changes the
 * patch code format.
 */
export interface FxParams {
  effect: EffectKind
  /**
   * How much effect. With effects wired as sends there is no dry signal inside one, so this is both
   * the return level and the amount of effect — the clean sound comes from the oscillator's own
   * `direct`, which is what keeps it from being counted twice.
   */
  mix: number
  /** Reverb tail, seconds. */
  decay: number
  /** Distortion amount, 0–1. */
  drive: number
  /** Which flavour of distortion. */
  shape: DistortionShape
  /** Echo time, as a beat division. */
  time: Division
  /** Echo feedback, 0–0.95. */
  feedback: number
  filterType: FilterType
  /**
   * Hz. Doubles as the tone control every effect has: a low-pass after the effect, which is what
   * keeps a reverb tail from sounding metallic and a drive from sounding harsh.
   */
  cutoff: number
  resonance: number
  /** Chorus rate, Hz. */
  rate: number
  /** Modulation depth, 0–1: chorus, phaser, tremolo. */
  depth: number
  /**
   * The chorus delay it modulates around, in milliseconds. Short is where flanging lives — a few
   * milliseconds gives harmonically spaced notches and a metallic sweep — and long is where
   * chorus does, heard as detuned doubling rather than as a comb.
   */
  sweep: number
  /** Bitcrusher resolution, in bits. */
  bits: number
  /**
   * Sample-rate reduction: how many outputs each sample is held for. 1 leaves the rate alone.
   *
   * The other half of a bitcrusher, and the half that needs an `AudioWorklet` — holding a value
   * between samples is memory, and a `WaveShaperNode` has none. Where a worklet is unavailable this
   * does nothing and the effect crushes bits alone.
   */
  reduction: number
  /** Stereo position: -1 hard left, 0 centre, 1 hard right. */
  pan: number
  /**
   * Stereo width, 0–1. Delays the right channel behind the left by a few milliseconds, which the
   * ear reads as space rather than as an echo.
   */
  width: number
}

export type DistortionShape = 'overdrive' | 'distortion' | 'fuzz' | 'octave'

export const MIN_DECAY = 0.1
export const MAX_DECAY = 10
export const MAX_FEEDBACK = 0.95
export const MIN_RATE = 0.1
export const MAX_RATE = 20
export const MIN_SWEEP = 0.5
export const MAX_SWEEP = 35

/** How far a WARP may move a branch. Two octaves either way is more than any patch has wanted. */
export const MAX_WARP = 14

export interface WarpParams {
  /**
   * Steps to move everything below this node, counted in whatever units each oscillator can offer.
   *
   * Degrees where the oscillator has a scale and semitones where it is free, which is one number meaning
   * what a musician means by it in both cases — "a third up" is two steps, and whether that comes out as
   * three semitones or four is a question about the key rather than about the gesture. It is also what
   * lets one transform serve oscillators in different scales: each reads the offset in its own terms.
   */
  transpose: number
}

export interface DelayParams {
  /** How long the trigger is held before being passed on, in milliseconds. */
  delayMs: number
}

/**
 * How an Ignite is fired (PLAN §17).
 *
 * `auto` is what it has always done: fire when the transport starts, and loop. `bound` waits for an
 * input instead, and is not seeded by Play at all — that is the whole point of it.
 */
export type IgniteTrigger = 'auto' | 'bound'

/**
 * What a bound Ignite does with a press.
 *
 * `hold` runs while the key is down. `toggle` starts on the first press and stops on the next. The
 * two map onto MIDI without translation: note-on and note-off *are* press and release, so hold needs
 * both and toggle listens to note-on alone.
 */
export type IgniteBehaviour = 'hold' | 'toggle'

/**
 * Where a press comes from.
 *
 * A discriminated union rather than a key code, because an Ignite must not know it was a keyboard: a
 * MIDI note is a second `source` and nothing above this changes (§17.3).
 */
/**
 * What an Ignite answers to.
 *
 * `source` names where a press came from and `code` is that source's own way of saying which one — a
 * physical key code, or a MIDI note number. Kept as two fields rather than one string because the
 * source decides how the code is read and how it is shown: `KeyA` reads as A, `60` as C4.
 *
 * Deliberately not an enum of every source that could ever exist. Adding one is a caller, not a change
 * here (§17.3), and the trigger layer only ever compares `${source}:${code}` against what it is given.
 */
export type IgniteBinding = { source: 'key' | 'midi'; code: string }

export interface StartParams {
  trigger?: IgniteTrigger
  binding?: IgniteBinding | null
  behaviour?: IgniteBehaviour
}

/** What an Ignite does when nothing says otherwise: exactly what it did before any of this existed. */
export const DEFAULT_IGNITE: Required<Omit<StartParams, 'binding'>> & { binding: null } = {
  trigger: 'auto',
  binding: null,
  behaviour: 'hold',
}

/** The identity a binding answers to, used to match a press against the Ignites waiting for one. */
export function bindingKey(binding: IgniteBinding | null | undefined): string | null {
  return binding ? `${binding.source}:${binding.code}` : null
}

/** Envelope times, in milliseconds. The same span the oscillator's own envelope uses. */
export const MIN_MOD_ATTACK = 1
export const MAX_MOD_ATTACK = 2000
export const MIN_MOD_DECAY = 5
export const MAX_MOD_DECAY = 8000

export interface ModParams {
  /**
   * What it modulates on whatever it is wired to.
   *
   * `level` and `mix` belong to the engine; anything else is a parameter key of the effect the cable
   * landed on, so a MOD on a reverb can point at its decay and one on a chorus at its sweep.
   */
  target?: string
  /**
   * What kind of modulator it is, and the difference is not the shape but **the clock**.
   *
   * An `lfo` runs on its own rate for ever, indifferent to the music. An `env` runs once, when
   * something in the cascade triggers it — so the modulation becomes part of the structure of the
   * piece rather than a wobble laid over it (PLAN §18.7).
   */
  kind?: 'lfo' | 'env'
  /**
   * What starts an envelope: a trigger arriving in the cascade, or every note.
   *
   * `trigger` is one sweep per activation of the branch the MOD hangs from — a long gesture over a
   * whole pattern. `note` is one sweep per note, each on that note's own filter, which is the classic
   * synth pluck.
   *
   * `note` only means something pointed at an **oscillator**: notes are what an oscillator has. On an
   * effect there is one parameter and many notes, and no unambiguous reading of which note owns it.
   */
  fires?: 'trigger' | 'note'
  wave?: 'sine' | 'triangle' | 'square' | 'sawtooth' | 'random'
  /**
   * Whether a per-note envelope's peak is scaled by the note's velocity.
   *
   * Only per-note envelopes can honour it, being the only modulator with a note to read. It is what turns
   * a step's velocity from a second name for level into a source: the same cable on a cutoff opens further
   * on a hard step than on a soft one.
   */
  byVelocity?: boolean
  /** Hertz. An LFO's rate; an envelope has none, since the cascade decides when it runs. */
  rate?: number
  /** 0 to 1, as a share of the target's own value. For an envelope this is its peak. */
  depth?: number
  /** Milliseconds to the peak, for an envelope. */
  attack?: number
  /** Milliseconds back to nothing. */
  decay?: number
}

export type NodeParams = OscParams | FxParams | DelayParams | StartParams | ModParams | WarpParams

export const MIN_DELAY_MS = 10
export const MAX_DELAY_MS = 4000

export interface PatchNode {
  id: NodeId
  type: string
  position: { x: number; y: number }
  params: NodeParams
}

export interface PatchEdge {
  id: string
  kind: EdgeKind
  source: NodeId
  target: NodeId
}

export interface Patch {
  version: 1
  bpm: number
  loop: boolean
  nodes: PatchNode[]
  edges: PatchEdge[]
}

/**
 * The ceiling is a musical convention, not an engine limit. Past roughly 1000 the steps get
 * shorter than an envelope and notes stop being notes, so that is where it sits.
 */
export const MIN_BPM = 20
export const MAX_BPM = 1000

export const MIN_NOTE = 24 // C1
export const MAX_NOTE = 84 // C6
