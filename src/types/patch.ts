/** Patch data model. Everything here is JSON-serialisable: no Web Audio objects. */

export type NodeId = string

/**
 * The two overlaid graphs. Event cables carry timestamped triggers down the cascade; audio cables
 * carry signal sideways from an oscillator into an effect.
 */
export type EdgeKind = 'event' | 'audio'

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

export interface Step {
  /** MIDI note. C1 = 24, C6 = 84. */
  note: number
  active: boolean
  velocity: number
}

export interface OscParams {
  waveform: Waveform
  /** Pulse duty cycle, 0–1. Only used with `waveform: 'pulse'`. */
  pulseWidth: number
  steps: Step[]
  division: Division
  /** 0–1 */
  gain: number
  /** Milliseconds. */
  attack: number
  release: number
  /** Fraction of the step the note lasts. 0.6 is percussive, 1 is legato. */
  gate: number
  /**
   * How much of this oscillator reaches the master without passing through any FX. 1 is the whole
   * of it, which is what an oscillator with no effects attached does. Pull it down with a drive
   * connected and you hear the effect rather than the effect on top of the clean signal.
   */
  direct: number
  filterType: FilterType
  /** Hz. Edited on a log slider; see audio/filter.ts. */
  cutoff: number
  /** Biquad Q. */
  resonance: number
  propagateMode: PropagateMode
}

/**
 * The effects an FX node can be. Append-only: the patch code stores the index into this order.
 * Only `gain` is implemented so far; the rest land one row at a time.
 */
export type EffectKind = 'reverb' | 'drive' | 'crush' | 'echo' | 'filter' | 'chorus'

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
  /** Drive amount, 0–1. */
  drive: number
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
  /**
   * Chorus depth, and — normalised the same way — the bitcrusher's resolution. See
   * `depthToBits` in audio/dsp.ts for the mapping; sharing the field keeps a second effect from
   * costing the patch code a new one.
   */
  depth: number
}

export const MIN_DECAY = 0.1
export const MAX_DECAY = 10
export const MAX_FEEDBACK = 0.95
export const MIN_RATE = 0.1
export const MAX_RATE = 20

export interface DelayParams {
  /** How long the trigger is held before being passed on, in milliseconds. */
  delayMs: number
}

export type StartParams = Record<string, never>

export type NodeParams = OscParams | FxParams | DelayParams | StartParams

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
