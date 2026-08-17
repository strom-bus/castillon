/** Patch data model. Everything here is JSON-serialisable: no Web Audio objects. */

export type NodeId = string

/**
 * The two overlaid graphs (PLAN.md §2). The PoC only draws event cables, but the field is here
 * from the start so patches never need migrating in Phase 3.
 */
export type EdgeKind = 'event' | 'audio'

export type Division = '1/4' | '1/8' | '1/16'

export type PropagateMode = 'onEnd' | 'onStart' | 'onStep'

/**
 * `pulse` is not a native Web Audio type: it is synthesised with a `PeriodicWave`
 * (see audio/waveforms.ts). The three noise colours are played back from generated buffers
 * (see audio/noise.ts). The rest are native oscillator types.
 */
export type Waveform =
  'sine' | 'triangle' | 'sawtooth' | 'square' | 'pulse' | 'white' | 'pink' | 'brown'

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
  propagateMode: PropagateMode
}

export interface DelayParams {
  /** How long the trigger is held before being passed on, in milliseconds. */
  delayMs: number
}

export type StartParams = Record<string, never>

export type NodeParams = OscParams | DelayParams | StartParams

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

export const MIN_NOTE = 24 // C1
export const MAX_NOTE = 84 // C6
