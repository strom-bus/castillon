/**
 * Three patches that come with the machine.
 *
 * The dice is the only thing here that shows what a cascade can do, and a dice explains nothing: it
 * produces an example without saying what the example is of. These do the opposite — each is built around
 * one idea that is hard to arrive at by rolling, and small enough to read at a glance.
 *
 * Built from the same defaults every node gets rather than written out field by field, so a preset cannot
 * fall behind a parameter added after it was written, and so what appears here is only what makes this
 * patch this patch.
 */

import { defaultDelayParams, defaultFxParams, defaultOscParams } from '../nodes/registry'
import type {
  FxParams,
  ModParams,
  OscParams,
  Patch,
  PatchEdge,
  PatchNode,
  Step,
} from '../types/patch'

export interface Preset {
  /** Stable, since it keys the rendered list. */
  id: string
  name: string
  /** One line on what the patch is for, shown under the name. */
  about: string
  patch: Patch
}

/** The spacing the canvas is laid out on, matching what the dice uses. */
const COLUMN = 560
const ROW = 230

const at = (column: number, row: number) => ({ x: column * COLUMN, y: row * ROW })

/**
 * A note as a scale degree and an octave, which is how these were chosen.
 *
 * Written as degrees rather than as MIDI numbers because that is the decision being made: the fourth of
 * the scale is a musical thought and 50 is an arithmetic one. Everything here is in the same minor scale,
 * so the three presets can be pasted into each other and still agree.
 */
const MINOR = [0, 2, 3, 5, 7, 8, 10]
const note = (degree: number, octave: number, root = 45) =>
  root + MINOR[((degree % 7) + 7) % 7]! + 12 * octave

/** `null` is a rest: a step that is there and silent, which is what makes a phrase out of a run. */
const steps = (notes: Array<number | null>, velocities?: number[]): Step[] =>
  notes.map((value, i) => ({
    note: value ?? 60,
    active: value !== null,
    velocity: velocities?.[i % velocities.length] ?? 1,
  }))

const ignite = (id: string, column: number, row: number): PatchNode => ({
  id,
  type: 'start',
  position: at(column, row),
  params: {},
})

const osc = (id: string, column: number, row: number, over: Partial<OscParams>): PatchNode => ({
  id,
  type: 'osc',
  position: at(column, row),
  params: { ...defaultOscParams(), ...over },
})

const delay = (id: string, column: number, row: number, delayMs: number): PatchNode => ({
  id,
  type: 'delay',
  position: at(column, row),
  params: { ...defaultDelayParams(), delayMs },
})

const fx = (id: string, column: number, row: number, over: Partial<FxParams>): PatchNode => ({
  id,
  type: 'fx',
  position: at(column, row),
  params: { ...defaultFxParams(), ...over } as FxParams,
})

const mod = (id: string, column: number, row: number, params: ModParams): PatchNode => ({
  id,
  type: 'mod',
  position: at(column, row),
  params,
})

const wire = (source: string, target: string, kind: PatchEdge['kind'] = 'event'): PatchEdge => ({
  id: `${source}->${target}`,
  kind,
  source,
  target,
})

const patchOf = (bpm: number, nodes: PatchNode[], edges: PatchEdge[]): Patch => ({
  version: 1,
  bpm,
  loop: true,
  nodes,
  edges,
})

/**
 * The cascade at its plainest: one thing after another, downward.
 *
 * Three oscillators in a line, each firing the next as it finishes. No branching and no delays, so there
 * is nothing to distract from the one idea — and the register falls as the patch does, so what travels
 * down the screen is what travels down in pitch.
 */
const descent: Preset = {
  id: 'descent',
  name: 'DESCENT',
  about:
    'A straight chain. Each oscillator fires the next when it ends, and the pitch falls with it.',
  patch: patchOf(
    96,
    [
      ignite('i', 0, 0),
      osc('a', 0, 1, {
        waveform: 'triangle',
        steps: steps([note(0, 2), note(4, 1), note(2, 2), null, note(0, 2), note(6, 1)]),
        division: '1/8',
        gain: 0.3,
        attack: 6,
        decay: 260,
        release: 180,
        gate: 0.7,
        filterType: 'lowpass',
        cutoff: 2600,
        resonance: 3,
        keyTrack: 0.5,
      }),
      osc('b', 0, 2, {
        waveform: 'square',
        pulseWidth: 0.35,
        steps: steps([note(0, 1), note(2, 1), null, note(4, 0), note(3, 1), null]),
        division: '1/8',
        gain: 0.22,
        attack: 4,
        decay: 200,
        release: 240,
        gate: 0.6,
        filterType: 'lowpass',
        cutoff: 1400,
        resonance: 6,
        keyTrack: 0.7,
      }),
      osc('c', 0, 3, {
        waveform: 'sawtooth',
        steps: steps([note(0, 0), null, note(4, -1), note(0, 0)]),
        division: '1/4',
        gain: 0.26,
        attack: 10,
        // No decay: the bottom of the descent holds its level, which is what makes it read as an arrival.
        decay: 0,
        release: 500,
        gate: 0.9,
        glide: 120,
        filterType: 'lowpass',
        cutoff: 700,
        resonance: 4,
      }),
      fx('r', 1, 3, { effect: 'reverb', mix: 0.32, decay: 3.2, cutoff: 3200 }),
    ],
    [wire('i', 'a'), wire('a', 'b'), wire('b', 'c'), wire('c', 'r', 'audio')],
  ),
}

/**
 * Why there is no clock.
 *
 * One trigger, two branches, a delay on one of them. They start together, come apart, and never quite
 * line up again, because the branches are different lengths and nothing forces them into a bar. Shorten
 * the delay to hear them lock; lengthen it to hear them separate further.
 */
const drift: Preset = {
  id: 'drift',
  name: 'DRIFT',
  about: 'Two branches from one trigger, one held back, sliding against each other.',
  patch: patchOf(
    104,
    [
      ignite('i', 1, 0),
      osc('a', 0, 1, {
        waveform: 'pulse',
        pulseWidth: 0.22,
        detune: -8,
        steps: steps([note(0, 1), note(2, 1), note(4, 1), note(2, 1), note(6, 0)]),
        division: '1/16',
        gain: 0.2,
        attack: 3,
        decay: 90,
        release: 120,
        gate: 0.5,
        filterType: 'bandpass',
        cutoff: 1600,
        resonance: 8,
        keyTrack: 0.6,
      }),
      delay('d', 2, 1, 260),
      osc('b', 2, 2, {
        waveform: 'pulse',
        pulseWidth: 0.22,
        // Detuned the other way from its twin, so where the two meet they read as one thicker voice
        // rather than as two instruments playing the same part.
        detune: 8,
        steps: steps([note(0, 1), note(3, 1), note(4, 1), null, note(2, 1), note(5, 0), null]),
        division: '1/16',
        gain: 0.2,
        attack: 3,
        decay: 90,
        release: 120,
        gate: 0.5,
        filterType: 'bandpass',
        cutoff: 1600,
        resonance: 8,
        keyTrack: 0.6,
      }),
      fx('e', 3, 2, {
        effect: 'echo',
        mix: 0.34,
        time: '1/8',
        feedback: 0.42,
        // All the way over, so the repeats ping-pong rather than piling up in the middle.
        width: 0.9,
        cutoff: 2600,
      }),
      // Slower than the pass is long, so it never lands on the same part of the phrase twice.
      mod('m', 3, 1, { kind: 'lfo', wave: 'triangle', rate: 0.12, depth: 0.5, target: 'cutoff' }),
      osc('c', 0, 2, {
        waveform: 'sine',
        steps: steps([note(0, -1), note(4, -1)]),
        division: '1/4',
        gain: 0.3,
        attack: 200,
        decay: 0,
        release: 700,
        gate: 1,
        filterType: 'off',
      }),
    ],
    [
      wire('i', 'a'),
      wire('i', 'd'),
      wire('d', 'b'),
      wire('a', 'c'),
      wire('b', 'e', 'audio'),
      wire('m', 'b', 'mod'),
    ],
  ),
}

/**
 * The machine at its most characteristic, and the one hardest to arrive at by rolling.
 *
 * A step-propagating oscillator fires the branch below once per note instead of once per pass, so a short
 * phrase drives a long one and the two multiply. The envelope under it is fired by the cascade rather
 * than by any clock, and takes its depth from each step's velocity — the whole argument for modulating
 * this way, in one cable.
 */
const hive: Preset = {
  id: 'hive',
  name: 'HIVE',
  about: 'One phrase driving another note by note, with an envelope the cascade fires.',
  patch: patchOf(
    112,
    [
      ignite('i', 0, 0),
      osc('a', 0, 1, {
        waveform: 'triangle',
        steps: steps([note(0, 1), null, note(4, 1), note(2, 1)]),
        division: '1/4',
        gain: 0.24,
        attack: 8,
        decay: 340,
        release: 300,
        gate: 0.8,
        filterType: 'lowpass',
        cutoff: 3000,
        resonance: 2,
        keyTrack: 0.4,
        // The patch turns on this: the branch below runs once per note, not once per pass.
        propagateMode: 'onStep',
      }),
      osc('b', 0, 2, {
        waveform: 'sawtooth',
        detune: 5,
        // Alternating hard and soft, which on its own would only be an accent in volume — the envelope
        // beside it is what turns the same numbers into an accent in the filter.
        steps: steps(
          [note(0, 0), note(2, 0), note(4, 0), note(6, 0), note(4, 0), note(2, 0)],
          [1, 0.45],
        ),
        division: '1/16',
        gain: 0.18,
        attack: 2,
        decay: 120,
        release: 90,
        gate: 0.55,
        filterType: 'lowpass',
        cutoff: 900,
        resonance: 9,
        keyTrack: 0.8,
      }),
      mod('m', 1, 2, {
        kind: 'env',
        fires: 'note',
        byVelocity: true,
        target: 'cutoff',
        depth: 0.85,
        attack: 6,
        decay: 220,
      }),
      fx('p', 1, 1, {
        effect: 'phaser',
        mix: 0.3,
        rate: 0.18,
        depth: 0.7,
        feedback: 0.4,
        cutoff: 2400,
      }),
      fx('r', 1, 3, { effect: 'reverb', mix: 0.28, decay: 2.4, cutoff: 2800 }),
      osc('c', 0, 3, {
        waveform: 'pink',
        steps: steps([note(0, -1), null, null, note(0, -1)]),
        division: '1/8',
        gain: 0.12,
        attack: 2,
        decay: 60,
        release: 140,
        gate: 0.4,
        filterType: 'bandpass',
        cutoff: 4200,
        resonance: 5,
      }),
    ],
    [
      wire('i', 'a'),
      wire('a', 'b'),
      wire('b', 'c'),
      wire('a', 'p', 'audio'),
      wire('c', 'r', 'audio'),
      wire('m', 'b', 'mod'),
    ],
  ),
}

export const PRESETS: Preset[] = [descent, drift, hive]
