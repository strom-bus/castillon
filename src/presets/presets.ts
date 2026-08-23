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
import { stressPatch } from '../tools/stressPatch'
import type {
  FxParams,
  ModParams,
  OscParams,
  Patch,
  PatchEdge,
  PatchNode,
  Step,
  WarpParams,
} from '../types/patch'

export interface Preset {
  /** Stable, since it keys the rendered list. */
  id: string
  name: string
  /** One line on what the patch is for, shown under the name. */
  about: string
  patch: Patch
  /**
   * Whether this one is a load test rather than something to listen to.
   *
   * Exactly one is, and it needs saying because every other preset is held under the layering threshold
   * on the grounds that a preset is the reference for what a healthy patch looks like — one that arrives
   * already degrading teaches the wrong thing. That reasoning is about a patch pretending to be music. A
   * patch whose name and description say it is a load test cannot mislead anybody, and it is far more
   * useful in the gallery than as a code in a text file somebody has to find and paste.
   */
  loadTest?: boolean
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

/**
 * The same scale, declared on every oscillator rather than left implicit.
 *
 * The notes were always chosen from it; saying so costs nothing and changes what happens when somebody
 * opens a preset and drags a bar — which is the first thing anybody does with a preset. Without it the
 * first edit to a patch built in A minor lands wherever the pointer was.
 */
const IN_KEY = { scale: 'minor' as const, scaleRoot: 9 }

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
  // Spread before the overrides, so a preset that wants to be out of key can still say so.
  params: { ...defaultOscParams(), ...IN_KEY, ...over },
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

const warp = (id: string, column: number, row: number, params: WarpParams): PatchNode => ({
  id,
  type: 'warp',
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

/**
 * The sequence that will not repeat itself, which is the step scope in one patch.
 *
 * A cascade already varies from pass to pass because its branches are different lengths. What it could
 * not do was vary *inside* a phrase: sixteen steps played sixteen times sounded like sixteen steps
 * played sixteen times. Three things fix that here and none of them is a random-note generator —
 * the notes are fixed and in key, and what moves is whether each one happens and how it is struck.
 *
 * Chance is the first: a step at sixty per cent is usually there and sometimes not, which is enough to
 * keep a repeating figure from settling. Rolls are the second, and they are what makes it sound played:
 * four hits inside one step with the level falling across them is a drum roll, where four even hits are
 * four notes stuck together. And a bass line under it with no chance at all, so there is something
 * steady for the top to be unsteady against — variation you cannot hear against something fixed is
 * just mud.
 */
const chance: Preset = {
  id: 'chance',
  name: 'CHANCE',
  about: 'A figure that never plays the same way twice, over a bass line that never changes.',
  patch: patchOf(
    120,
    [
      ignite('i', 0, 0),
      osc('lead', 0, 1, {
        waveform: 'pulse',
        pulseWidth: 0.28,
        useChance: true,
        useRatchet: true,
        steps: [
          // Written out rather than through the helper: the whole point of this patch is what a step
          // carries besides its pitch, and the helper only knows about pitch and level.
          { note: note(0, 1), active: true, velocity: 1, ratchet: 1 },
          { note: note(2, 1), active: true, velocity: 0.55, chance: 0.5 },
          // The roll, fading across itself. Four even hits would read as four notes; the ramp is what
          // turns them into one gesture.
          { note: note(4, 1), active: true, velocity: 0.9, ratchet: 4, ratchetRamp: 0.8 },
          { note: note(2, 1), active: true, velocity: 0.5, chance: 0.35 },
          { note: note(6, 0), active: true, velocity: 0.85, ratchet: 2, ratchetRamp: 0.4 },
          { note: note(4, 1), active: true, velocity: 0.6, chance: 0.6 },
          // Swelling instead of fading, into the step after it — the same control the other way round.
          { note: note(0, 1), active: true, velocity: 0.8, ratchet: 3, ratchetRamp: -0.6 },
          { note: note(5, 0), active: true, velocity: 0.45, chance: 0.4, slide: true },
        ],
        division: '1/16',
        gain: 0.19,
        attack: 2,
        decay: 110,
        release: 130,
        gate: 0.55,
        glide: 60,
        filterType: 'lowpass',
        cutoff: 1500,
        resonance: 8,
        keyTrack: 0.8,
      }),
      // No chance and no rolls: the fixed thing the top is heard against.
      osc('bass', 0, 2, {
        waveform: 'square',
        steps: steps([note(0, -1), null, note(0, -1), note(3, -1)]),
        division: '1/8',
        gain: 0.24,
        attack: 3,
        decay: 150,
        release: 200,
        gate: 0.6,
        filterType: 'lowpass',
        cutoff: 800,
        resonance: 5,
        keyTrack: 0.5,
      }),
      // Per note and scaled by velocity, which is what makes a quiet step in a roll quieter *and*
      // darker — the accents of the sequence heard rather than only counted.
      mod('e', 1, 1, {
        kind: 'env',
        fires: 'note',
        byVelocity: true,
        target: 'cutoff',
        depth: 0.8,
        attack: 4,
        decay: 180,
      }),
      fx('r', 1, 2, { effect: 'reverb', mix: 0.26, decay: 2.2, cutoff: 3000 }),
    ],
    [wire('i', 'lead'), wire('lead', 'bass'), wire('bass', 'r', 'audio'), wire('e', 'lead', 'mod')],
  ),
}

/**
 * A branch bent from the side, which is the one thing no cable in the cascade can do.
 *
 * Two identical oscillators, and everything that separates them comes from the two WARPs attached
 * beside them. One is moved up a third — in degrees of the scale, so it is a third and not four
 * semitones — and the other is set to two-thirds speed. That second one is the interesting half: a
 * DELAY sets two branches a fixed distance apart and holds them there for ever, and a ratio makes them
 * come apart and keep coming apart, so the patch never arrives at the same alignment twice.
 *
 * A third WARP carries nothing but Chance, on the bass branch under the first oscillator. That one is
 * there to show **reach**: the bass is already a third up, because the warp on the oscillator above it
 * reaches down to it, and it is thinned as well by its own. One note ends up carrying two warps that
 * were attached in two places, which is the thing about this node worth knowing.
 */
const bend: Preset = {
  id: 'bend',
  name: 'BEND',
  about: 'One phrase, twice, bent from the side: one moved in pitch, one running at another speed.',
  patch: patchOf(
    100,
    [
      ignite('i', 1, 0),
      osc('one', 0, 1, {
        waveform: 'triangle',
        steps: steps([note(0, 1), note(4, 0), note(2, 1), null, note(6, 0), note(4, 0)]),
        division: '1/8',
        gain: 0.2,
        attack: 5,
        decay: 200,
        release: 240,
        gate: 0.65,
        filterType: 'lowpass',
        cutoff: 2200,
        resonance: 4,
        keyTrack: 0.6,
      }),
      // A third up, counted in the scale: the same interval whatever key the oscillator is in.
      warp('up', 0, 0, { transpose: 2 }),
      osc('two', 2, 1, {
        waveform: 'triangle',
        detune: 7,
        // The same phrase as its twin. What separates them is beside them, not in them.
        steps: steps([note(0, 1), note(4, 0), note(2, 1), null, note(6, 0), note(4, 0)]),
        division: '1/8',
        gain: 0.18,
        attack: 5,
        decay: 200,
        release: 240,
        gate: 0.65,
        filterType: 'lowpass',
        cutoff: 1800,
        resonance: 4,
        keyTrack: 0.6,
      }),
      // Two thirds of the speed, so the two phrases drift and go on drifting. This is the thing a
      // delay cannot do.
      warp('slow', 3, 1, { transpose: 0, speed: 2 / 3 }),
      // On the bass, which is already being moved by the warp above it. Attached in two places and
      // both arrive: the pitch from up the branch, the thinning from here.
      warp('thin', 2, 2, { transpose: 0, chance: 0.85 }),
      osc('low', 1, 2, {
        waveform: 'sawtooth',
        steps: steps([note(0, -1), null, note(5, -2), null]),
        division: '1/4',
        gain: 0.22,
        attack: 12,
        decay: 0,
        release: 600,
        gate: 0.9,
        glide: 140,
        filterType: 'lowpass',
        cutoff: 700,
        resonance: 6,
      }),
      fx('ch', 0, 2, {
        effect: 'chorus',
        mix: 0.3,
        sweep: 0.5,
        rate: 0.3,
        depth: 0.55,
        cutoff: 3200,
      }),
      fx('rv', 2, 2, { effect: 'reverb', mix: 0.3, decay: 3, cutoff: 2600 }),
    ],
    [
      wire('i', 'one'),
      wire('i', 'two'),
      wire('one', 'low'),
      wire('one', 'ch', 'audio'),
      wire('two', 'rv', 'audio'),
      // Attached from the side, which is the whole design: nothing is rewired and nothing fires twice.
      // Onto oscillators, because an oscillator is the thing that plays notes — and a warp reaches down
      // from wherever it lands, so one on the top of a branch takes the branch.
      wire('up', 'one', 'warp'),
      wire('slow', 'two', 'warp'),
      wire('thin', 'low', 'warp'),
    ],
  ),
}

/**
 * The load test, shipped where it can be reached rather than pasted.
 *
 * Not music, and it says so on its face. It lived only as a code in `docs/stress-patch.txt`, which meant
 * finding a file and pasting two thousand characters to answer "does this machine cope" — a question
 * worth asking often enough that the answer should be one click.
 *
 * Built from the generator rather than written out, so the preset and the file are the same patch by
 * construction and cannot drift. What it contains and why is all in `tools/stressPatch.ts`.
 */
const stress: Preset = {
  id: 'stress',
  name: 'STRESS',
  about:
    'Not music: 48 oscillators at once with a rack of effects, for hearing where this machine gives out.',
  loadTest: true,
  patch: stressPatch(),
}

export const PRESETS: Preset[] = [descent, drift, hive, chance, bend, stress]
