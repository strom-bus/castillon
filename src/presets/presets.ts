/**
 * The patches that come with the machine.
 *
 * The dice is the only thing here that shows what a cascade can do, and a dice explains nothing: it
 * produces an example without saying what the example is of. These do the opposite — each is built around
 * one idea that is hard to arrive at by rolling, and small enough to read at a glance.
 *
 * Built from the same defaults every node gets rather than written out field by field, so a preset cannot
 * fall behind a parameter added after it was written, and so what appears here is only what makes this
 * patch this patch.
 */

import { defaultFxParams, defaultHoldParams, defaultOscParams } from '../nodes/registry'
import { stressPatch } from '../tools/stressPatch'
import type {
  FxParams,
  ModParams,
  OscParams,
  Patch,
  PatchEdge,
  PatchNode,
  FollowParams,
  HoldParams,
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

const hold = (id: string, column: number, row: number, params: Partial<HoldParams>): PatchNode => ({
  id,
  type: 'hold',
  position: at(column, row),
  // Over the defaults, which are all neutral: a preset says the one or two things it wants this node to
  // do and stays silent about the rest.
  params: { ...defaultHoldParams(), ...params },
})

const follow = (id: string, column: number, row: number, params: FollowParams): PatchNode => ({
  id,
  type: 'follow',
  position: at(column, row),
  params,
})

const fm = (id: string, column: number, row: number, index: number): PatchNode => ({
  id,
  type: 'fm',
  position: at(column, row),
  params: { index },
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

/** A trigger cable from the Ignite's upward port: what it fires climbs the cascade instead of descending. */
const climb = (source: string, target: string): PatchEdge => ({
  ...wire(source, target),
  up: true,
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
 *
 * The two also read their steps differently, which is a second axis of the same idea and the reason this
 * is where direction is shown. One plays its five-step phrase **backwards**, fixed; the other turns round
 * every pass across seven steps. So the delay pulls them apart in time, the lengths pull them apart in
 * phase, and the directions pull them apart in shape — and none of the three is a clock.
 */
const drift: Preset = {
  id: 'drift',
  name: 'DRIFT',
  about:
    'Two branches from one trigger, one held back, one reversed and one turning round, sliding against each other.',
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
        // Backwards, and only the notes are: the groove and the step lengths stay forward, so this reads
        // as the same phrase played in reverse rather than as a recording running the wrong way.
        direction: 'reverse',
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
      hold('d', 2, 1, { waitMs: 260 }),
      osc('b', 2, 2, {
        waveform: 'pulse',
        pulseWidth: 0.22,
        // Detuned the other way from its twin, so where the two meet they read as one thicker voice
        // rather than as two instruments playing the same part.
        detune: 8,
        steps: steps([note(0, 1), note(3, 1), note(4, 1), null, note(2, 1), note(5, 0), null]),
        division: '1/16',
        /*
         * And this one turns round every pass, which is a third way for the two to come apart. Its twin
         * plays one fixed phrase backwards for ever; this one alternates, so the relationship between
         * them is different on every other time round even before the delay is counted.
         *
         * Seven steps against the twin's five, so the two never agree about where the phrase starts
         * either — the pass length differs and the ping-pong turns on a different beat each time.
         */
        direction: 'pingpong',
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
  about:
    'One phrase, twice, bent from the side: one moved in pitch, one at another speed, one pulled back.',
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
      /*
       * Thinner *and* softer, on the branch below — two dimensions of one warp doing what a warp is for:
       * one node balancing a whole branch that four edits would otherwise take.
       *
       * Level and Velocity are both here on purpose, and they are not the same control. Velocity makes the
       * notes land softer *and* closes any per-note filter it feeds, because velocity is a source. Level
       * only changes how loud the branch is. Set together they read as one gesture — pull the low line back
       * — and each is doing a different half of it.
       */
      warp('thin', 2, 2, { transpose: 0, chance: 0.85, velocity: 0.8, level: 0.7 }),
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

/**
 * Ducking, whose key is the cascade rather than a track of audio.
 *
 * The thing this instrument can do that no other one can, and it turned out to be already built — a MOD
 * set to an envelope, fired by a trigger, pointed at an oscillator's level, with the depth taken below
 * zero. What was missing was any way to find that: six choices deep and nothing anywhere names it. A
 * preset is the one place a feature can be *seen* being used, so this is the naming.
 *
 * Everywhere else a sidechain is keyed by a signal — a compressor listening to a kick drum, guessing at
 * the beat from its amplitude. Here the key is the trigger itself, which is not a guess: the pad ducks
 * because the low branch *fired*, not because something got loud. It cannot mistime and it cannot be
 * fooled by a quiet hit.
 */
const duck: Preset = {
  id: 'duck',
  name: 'DUCK',
  about:
    'A pad pushed out of the way by the branch below it, keyed by the trigger and not by a signal.',
  patch: patchOf(
    92,
    [
      ignite('i', 1, 0),
      // The pad: long, soft and always there, which is what makes the ducking audible at all.
      osc('pad', 0, 1, {
        waveform: 'sawtooth',
        detune: -7,
        steps: steps([note(0, 0), null, note(4, 0), null]),
        division: '1/4',
        gain: 0.26,
        attack: 220,
        decay: 0,
        release: 900,
        gate: 1,
        filterType: 'lowpass',
        cutoff: 1300,
        resonance: 3,
        keyTrack: 0.4,
        // Beside the low branch rather than after it, so both run against each other every pass.
        propagateMode: 'onStart',
      }),
      // The key. Short and low, and its *trigger* is what does the ducking — the sound it makes is
      // incidental, which is why this works even on a pass where its own step is silent.
      osc('low', 2, 1, {
        waveform: 'sine',
        steps: steps([note(0, -2), null, null, note(0, -2), null, null, note(0, -2), null]),
        division: '1/8',
        gain: 0.32,
        attack: 2,
        decay: 90,
        release: 120,
        gate: 0.4,
        filterType: 'lowpass',
        cutoff: 500,
        resonance: 1,
      }),
      /*
       * The ducker: an envelope fired by the cascade, pointed at the pad's level, pulling *down*.
       *
       * Attack is how fast the pad gets out of the way and decay is how long it takes to come back —
       * two milliseconds and a third of a second, which is the shape every sidechain has. The negative
       * depth is the whole trick, and it is the only setting here that is not obvious.
       */
      mod('duck', 0, 2, {
        kind: 'env',
        fires: 'trigger',
        target: 'level',
        depth: -0.8,
        attack: 2,
        decay: 320,
      }),
      fx('rv', 3, 2, { effect: 'reverb', mix: 0.24, decay: 3, cutoff: 2600 }),
    ],
    [
      wire('i', 'pad'),
      wire('i', 'low'),
      // The key: the same trigger that fires the low branch fires the ducker, so they cannot drift apart.
      wire('i', 'duck'),
      wire('duck', 'pad', 'mod'),
      wire('pad', 'rv', 'audio'),
    ],
  ),
}

/**
 * The other way to duck, and the difference is the whole point of putting both in the box.
 *
 * DUCK is keyed by a **trigger**: the pad moves because the other branch fired, so it cannot mistime and
 * a quiet hit ducks exactly as much as a loud one. This one is keyed by the **sound**, and everything that
 * follows from that is audible — the pad closes by however much the lead is actually playing, a rest lets
 * it open, and a soft phrase moves it less than a hard one.
 *
 * It closes a filter rather than pulling a level, which is the other reason for it to exist. A follower
 * pointed at a cutoff is not a sidechain at all: it is one line making room for another in the register
 * instead of in the volume, and nothing else here can do it.
 */
const shadow: Preset = {
  id: 'shadow',
  name: 'SHADOW',
  about:
    'A pad that darkens while the lead plays and opens in the rests, keyed by the sound and not by a trigger.',
  patch: patchOf(
    104,
    [
      ignite('i', 1, 0),
      /*
       * The lead. Busy and uneven on purpose: a follower's whole subject is how much is going on, so a
       * line with rests in it makes the pad move where a steady one would only hold it down.
       */
      osc('lead', 0, 1, {
        waveform: 'pulse',
        pulseWidth: 0.35,
        steps: steps([
          note(0, 0),
          note(2, 0),
          null,
          note(4, 0),
          note(3, 0),
          null,
          note(5, 0),
          null,
        ]),
        division: '1/8',
        gain: 0.3,
        attack: 3,
        decay: 140,
        release: 160,
        gate: 0.5,
        filterType: 'lowpass',
        cutoff: 2400,
        resonance: 4,
        keyTrack: 0.5,
      }),
      // The pad, and its filter is deliberately left open: what the follower does is close it, so it has
      // to have somewhere to travel from.
      osc('pad', 2, 1, {
        waveform: 'sawtooth',
        detune: -6,
        steps: steps([note(0, -1), null, note(4, -1), null]),
        division: '1/4',
        gain: 0.24,
        attack: 260,
        decay: 0,
        release: 1100,
        gate: 1,
        filterType: 'lowpass',
        cutoff: 4200,
        resonance: 5,
        keyTrack: 0.3,
      }),
      /*
       * The follower. It hears the lead on its left and moves the pad's cutoff on its right.
       *
       * Slow to let go and quick to take hold, which is what makes it read as one line making room for
       * another rather than as a tremolo: four hundred milliseconds of release holds the pad down through
       * the gaps inside a phrase and opens it between phrases. Sensitivity above one because a single
       * oscillator at a quarter of full level never reaches the top of the range on its own.
       */
      follow('ear', 1, 2, {
        target: 'cutoff',
        depth: -0.55,
        sensitivity: 1.7,
        attack: 9,
        release: 420,
      }),
      fx('rv', 3, 2, { effect: 'reverb', mix: 0.3, decay: 3.4, cutoff: 2400 }),
    ],
    [
      wire('i', 'lead'),
      wire('i', 'pad'),
      // Audio in the left, modulation out the right: the two cables a follower has, and the only node here
      // whose sides are not interchangeable.
      wire('lead', 'ear', 'audio'),
      wire('ear', 'pad', 'mod'),
      wire('pad', 'rv', 'audio'),
    ],
  ),
}

/**
 * Two oscillators, and only one of them is a note.
 *
 * The other is bending it. An FM node takes the audio of one oscillator and puts it on the pitch of
 * another at audio rate, which is not a wobble — past a few hundred cents the ear stops hearing "a note
 * being bent" and starts hearing a different instrument. Bells, struck metal, and the growl underneath.
 *
 * **The modulator's envelope is the shape of the index**, because what reaches the FM node is audio and
 * audio has a level. A short decay on the modulator is a bell: bright at the strike, clean as it rings
 * out. That is why its decay is a fifth of the carrier's here, and it is the one setting to move first
 * if you want to hear what this node does.
 *
 * The modulator plays a fifth above the carrier rather than in unison — with both oscillators sequenced,
 * the interval between them is the FM ratio, and a fifth is the one that stays recognisably tuned while
 * still being inharmonic enough to sound like metal.
 */
const iron: Preset = {
  id: 'iron',
  name: 'IRON',
  about: 'One oscillator bending another’s pitch at audio rate: struck metal from two sine waves.',
  patch: patchOf(
    88,
    [
      ignite('i', 1, 0),
      /*
       * The carrier. A sine, because FM's whole point is that the sidebands make the timbre — a
       * sawtooth carrier arrives with its own harmonics and the modulation muddies them instead of
       * building anything.
       */
      osc('bell', 2, 1, {
        waveform: 'sine',
        steps: steps([note(0, 0), null, note(4, 0), null, note(2, 0), null, null, note(0, 1)]),
        division: '1/8',
        gain: 0.34,
        attack: 2,
        decay: 900,
        release: 700,
        gate: 0.9,
        filterType: 'off',
        cutoff: 8000,
        resonance: 1,
      }),
      /*
       * The modulator, and it is heard as well as used — an FM node is a tap, so this oscillator is
       * still on the master. At this level that is deliberate: a little of it under the bell is the
       * strike, and turning Level to nothing leaves the FM exactly as it is.
       */
      osc('mod', 0, 1, {
        waveform: 'sine',
        steps: steps([note(4, 0), null, note(1, 1), null, note(6, 0), null, null, note(4, 1)]),
        division: '1/8',
        gain: 0.08,
        attack: 1,
        // A fifth of the carrier's, which is what makes this a bell rather than a drone.
        decay: 180,
        release: 160,
        gate: 0.5,
        filterType: 'off',
        cutoff: 8000,
        resonance: 1,
      }),
      // Well past a semitone, which is where the sidebands start being the sound rather than a detune.
      fm('f', 1, 2, 950),
      fx('rv', 3, 2, { effect: 'reverb', mix: 0.34, decay: 4.5, cutoff: 3200 }),
    ],
    [
      wire('i', 'bell'),
      wire('i', 'mod'),
      // Audio in the left, modulation out the right — the same two cables a follower has, carrying the
      // waveform itself instead of a reading of how loud it is.
      wire('mod', 'f', 'audio'),
      wire('f', 'bell', 'mod'),
      wire('bell', 'rv', 'audio'),
    ],
  ),
}

/**
 * One line, sifted three ways.
 *
 * A sixteen-step tick sends a trigger down on **every step**, and each branch takes a different share of
 * them: one of every three, the third of every five, and — counting passes rather than triggers — one pass
 * in two, most of the time. So three rhythms come out of a sequence that has only one, and nothing here
 * plays a note that was written.
 *
 * The two dividers are the point. Sixteen is not a multiple of three or of five and the count carries on
 * across the pass boundary, so where each lands moves every time round: it takes fifteen passes to come
 * back to where it started, out of one bar of sixteen. That is a phrase nobody wrote, and it is the one
 * thing counting passes cannot do — every trigger in a pass carries the same pass number, so a hold
 * counting them takes all sixteen or none.
 *
 * The third branch is the older reading, kept beside them so the difference is audible rather than
 * explained: a pad on alternate passes, with odds, entering where the arithmetic above has no say.
 */
const sift: Preset = {
  id: 'sift',
  name: 'SIFT',
  about: 'One tick, three holds: two dividing its steps and one counting its passes.',
  patch: patchOf(
    100,
    [
      ignite('i', 1, 0),
      /*
       * The tick. Every step the same note on purpose — it is a clock, and a clock that plays a tune
       * gives the ear something to follow instead of the branches. The velocities alternate so it
       * breathes rather than machine-guns.
       */
      osc('tick', 1, 1, {
        ...IN_KEY,
        waveform: 'square',
        steps: steps(
          Array.from({ length: 16 }, () => note(0, 1)),
          Array.from({ length: 16 }, (_, i) => (i % 4 === 0 ? 0.5 : 0.26)),
        ),
        division: '1/16',
        gain: 0.16,
        attack: 1,
        decay: 40,
        release: 60,
        gate: 0.3,
        filterType: 'highpass',
        cutoff: 900,
        resonance: 2,
        // The whole preset hangs off this: one trigger per step is what gives the holds below
        // something to divide.
        propagateMode: 'onStep',
      }),

      /*
       * One of every three arrivals, and the third of every five. Both counting triggers, which is the
       * only reading under which they mean anything different from each other.
       *
       * The second one takes its place in the run rather than the first: at 1:3 and 1:5 both land on the
       * same arrival whenever their runs line up, so the two branches keep hitting together on the
       * downbeat of the pattern. Moved to the third, they coincide somewhere in the middle instead, and
       * where that is moves every pass.
       */
      hold('g3', 0, 2, { counts: 'triggers', every: 3, offset: 1 }),
      hold('g5', 2, 2, { counts: 'triggers', every: 5, offset: 3 }),
      /*
       * And the older reading beside them: passes, not triggers.
       *
       * Off the IGNITE and not off the tick, which is the whole difference said in one cable. Under the
       * tick this would be reached sixteen times a pass with the same pass number every time, so on its
       * own pass it would let all sixteen through and the pad would machine-gun — which is what it did
       * when this preset was first wired. Counting passes wants one arrival a pass to count.
       */
      hold('gp', 3, 1, { counts: 'passes', every: 2, offset: 1, chance: 0.75 }),

      osc('chime', 0, 3, {
        ...IN_KEY,
        waveform: 'triangle',
        steps: steps([note(4, 2)]),
        division: '1/8',
        gain: 0.3,
        attack: 2,
        decay: 260,
        release: 340,
        gate: 0.5,
        filterType: 'lowpass',
        cutoff: 4200,
        resonance: 2,
        keyTrack: 0.3,
      }),
      osc('bass', 2, 3, {
        ...IN_KEY,
        waveform: 'sawtooth',
        steps: steps([note(0, -1)]),
        division: '1/8',
        gain: 0.34,
        attack: 3,
        decay: 180,
        release: 220,
        gate: 0.6,
        filterType: 'lowpass',
        cutoff: 620,
        resonance: 4,
      }),
      osc('pad', 3, 2, {
        ...IN_KEY,
        waveform: 'sawtooth',
        detune: -6,
        steps: steps([note(2, 0)]),
        division: '1/4',
        gain: 0.2,
        attack: 300,
        decay: 0,
        release: 900,
        gate: 1,
        filterType: 'lowpass',
        cutoff: 1500,
        resonance: 3,
        keyTrack: 0.4,
      }),

      fx('rv', 4, 4, { effect: 'reverb', mix: 0.3, decay: 3.4, cutoff: 3200 }),
    ],
    [
      wire('i', 'tick'),
      wire('tick', 'g3'),
      wire('tick', 'g5'),
      wire('i', 'gp'),
      wire('g3', 'chime'),
      wire('g5', 'bass'),
      wire('gp', 'pad'),
      wire('chime', 'rv', 'audio'),
      wire('pad', 'rv', 'audio'),
    ],
  ),
}

/**
 * A struck string, from a click and a resonator.
 *
 * The comb decides the pitch, not the source — so what plays the tune is not the oscillator, it is three
 * resonators tuned to a minor triad, all struck by the same thing. That thing is a fiftieth of a second
 * of white noise: no pitch, no sustain, nothing but a shape in time, which is exactly what a resonator
 * wants and nothing else here has any use for.
 *
 * Wired the way a preset has to be to explain anything: one click, three sends, three notes. Turning any
 * one of them off leaves the other two, and turning the click off leaves silence — which is the whole of
 * what the effect is, said with cables.
 *
 * The MOD is the part worth finding. An envelope on the lowest resonator's Pitch, fired by the same
 * trigger as the click and pulling *down*, is a string being pulled sharp and released — a gesture the
 * instrument has no other way of making, since the pitch of a note is fixed the moment it is scheduled
 * and this pitch belongs to the resonator rather than to the note.
 */
const pluck: Preset = {
  id: 'pluck',
  name: 'PLUCK',
  about:
    'One click and three resonators, so the effect plays the tune and the oscillator only strikes it.',
  patch: patchOf(
    88,
    [
      ignite('i', 1, 0),
      /*
       * The striker. As short as the envelope allows and quiet, because what anybody is meant to hear is
       * the three tails and not the hammer — and white rather than pitched, since a resonator throws away
       * everything about its input except when it happened.
       */
      osc('hit', 1, 1, {
        waveform: 'white',
        steps: steps(
          [note(0, 0), null, note(0, 0), null, note(0, 0), null, null, note(0, 0)],
          [1, 1, 0.55, 1, 0.8, 1, 1, 0.4],
        ),
        division: '1/8',
        gain: 0.12,
        attack: 1,
        decay: 18,
        release: 20,
        gate: 0.06,
        filterType: 'highpass',
        cutoff: 400,
        resonance: 1,
      }),

      // A minor triad, one resonator a note. The lowest rings longest, which is what a string does.
      fx('low', 0, 2, { effect: 'comb', mix: 0.95, pitch: 45, decay: 3.5, cutoff: 2600 }),
      fx('mid', 1, 2, { effect: 'comb', mix: 0.9, pitch: 48, decay: 2.4, cutoff: 3200 }),
      fx('top', 2, 2, { effect: 'comb', mix: 0.85, pitch: 52, decay: 1.6, cutoff: 4200 }),

      /*
       * The bend. Fired by the trigger rather than by a note, so it lands on the strike whether or not
       * this pass has a strike on that step, and pulling down — a string released rather than pushed.
       */
      mod('bend', 0, 3, {
        kind: 'env',
        fires: 'trigger',
        target: 'pitch',
        depth: -0.18,
        attack: 4,
        decay: 260,
      }),
    ],
    [
      wire('i', 'hit'),
      wire('i', 'bend'),
      wire('hit', 'low', 'audio'),
      wire('hit', 'mid', 'audio'),
      wire('hit', 'top', 'audio'),
      wire('bend', 'low', 'mod'),
    ],
  ),
}

/**
 * A sine, and everything you hear is the folder.
 *
 * A sine has nothing in it but its fundamental, so putting one through a wavefolder is the least
 * ambiguous demonstration there is: every harmonic in the output was made by the effect. Folding a
 * sawtooth would sound thicker and explain nothing.
 *
 * Two things are on show and neither is obvious from the panel.
 *
 * **The timbre follows the playing.** The step velocities run from a third to full, and because how far
 * into the folds a note reaches depends on how loud it arrived, each one comes out a different tone
 * rather than the same tone at a different volume. Nothing else here gets anything out of velocity but
 * loudness, and this needed no wiring at all — it is what a folder *is*.
 *
 * **The LFO is on Bias, not on the filter.** Sweeping the offset moves which harmonics are present, so
 * the sound opens and closes without getting brighter or louder. That is the west-coast gesture, and it
 * is the one modulation destination in this instrument that changes a timbre and nothing else.
 */
const reed: Preset = {
  id: 'reed',
  name: 'REED',
  about: 'A sine folded into a reed, its timbre following the velocities and an LFO on the Bias.',
  patch: patchOf(
    96,
    [
      ignite('i', 1, 0),
      osc('voice', 1, 1, {
        ...IN_KEY,
        // A sine, so that everything audible was made by the folder and nothing came in with the note.
        waveform: 'sine',
        steps: steps(
          [note(0, 0), note(4, 0), null, note(2, 0), note(0, 1), null, note(4, 0), note(2, 0)],
          // A third to full. Through a folder this is a line of different tones, not one tone at
          // different volumes — which is the whole reason the range is this wide.
          [1, 0.42, 1, 0.66, 0.88, 1, 0.35, 0.55],
        ),
        division: '1/8',
        gain: 0.34,
        attack: 3,
        decay: 0,
        release: 180,
        gate: 0.7,
        filterType: 'off',
        cutoff: 6000,
        resonance: 1,
      }),
      /*
       * Driven past the first fold, and biased off centre to start with — so the LFO below sweeps through
       * the middle rather than sitting on it, and the even harmonics come and go instead of only ever
       * arriving.
       */
      fx('folder', 0, 2, { effect: 'fold', mix: 1, drive: 0.58, bias: 0.2, cutoff: 6500 }),
      fx('rv', 2, 2, { effect: 'reverb', mix: 0.22, decay: 2.6, cutoff: 3400 }),
      mod('sweep', 0, 3, {
        kind: 'lfo',
        wave: 'triangle',
        rate: 0.18,
        depth: 0.4,
        target: 'bias',
      }),
    ],
    [
      wire('i', 'voice'),
      // All of it through the folder: half a wavefolder is the unfolded sine sitting underneath, which
      // is the same argument as a filter wanting its whole mix.
      wire('voice', 'folder', 'audio'),
      wire('voice', 'rv', 'audio'),
      wire('sweep', 'folder', 'mod'),
    ],
  ),
}

/**
 * The same three voices, played downward and upward at once.
 *
 * One trigger, one chain of oscillators, and two cables out of the Ignite: the bottom port fires the top
 * of the chain and the wave descends as it always has; the top port fires the *bottom* of it and a second
 * wave climbs, following the same cables backwards. So every voice sounds twice a pass — once on the way
 * down and once on the way up — and the two waves cross in the middle.
 *
 * Which is the whole point and cannot be built any other way. Two Ignites would give two passes that drift
 * apart; this is one pass, so the descent and the climb are locked to the same instant for ever, and the
 * pass is as long as the longer of them.
 *
 * The register falls down the chain, so the descent reads as an arrival and the climb as a departure —
 * and they are the same three notes. Nothing about the sequences says which way anything is going.
 *
 * The outer voices are deliberately different lengths, four steps against six. With them equal, both waves
 * reach the middle voice at the same instant and it is simply louder — a doubling rather than a crossing.
 * Unequal, the two arrivals separate and you hear the waves pass each other, which is the thing on show.
 */
const rise: Preset = {
  id: 'rise',
  name: 'RISE',
  about: 'One trigger, one chain, and two waves — one descending it and one climbing back up.',
  patch: patchOf(
    92,
    [
      ignite('i', 1, 1),
      osc('high', 1, 2, {
        ...IN_KEY,
        waveform: 'triangle',
        steps: steps([note(0, 2), note(4, 1), note(2, 2), null]),
        division: '1/8',
        gain: 0.24,
        attack: 4,
        decay: 220,
        release: 200,
        gate: 0.6,
        filterType: 'lowpass',
        cutoff: 3200,
        resonance: 2,
        keyTrack: 0.5,
      }),
      osc('mid', 1, 3, {
        ...IN_KEY,
        waveform: 'pulse',
        pulseWidth: 0.4,
        steps: steps([note(0, 1), null, note(3, 1), note(5, 0)]),
        division: '1/8',
        gain: 0.22,
        attack: 5,
        decay: 240,
        release: 240,
        gate: 0.6,
        filterType: 'lowpass',
        cutoff: 1700,
        resonance: 5,
        keyTrack: 0.6,
      }),
      osc('low', 1, 4, {
        ...IN_KEY,
        waveform: 'sawtooth',
        /*
         * Six steps against the top voice's four, and that is what stops the preset from sounding like
         * one thing instead of two.
         *
         * The descent reaches the middle voice after the *top* one has finished; the climb reaches it
         * after the *bottom* one has. Give those two the same length and both waves arrive at the same
         * instant, so the middle voice is simply louder — a doubling, not a crossing. Different lengths
         * and you hear two separate arrivals, which is the whole thing being demonstrated.
         */
        steps: steps([note(0, -1), null, note(4, -2), null, note(2, -1), null]),
        division: '1/8',
        gain: 0.28,
        attack: 8,
        decay: 0,
        release: 420,
        gate: 0.85,
        filterType: 'lowpass',
        cutoff: 720,
        resonance: 4,
      }),
      fx('rv', 2, 3, { effect: 'reverb', mix: 0.26, decay: 3, cutoff: 3000 }),
    ],
    [
      // Down the chain, as always.
      wire('i', 'high'),
      wire('high', 'mid'),
      wire('mid', 'low'),
      // And up it: this one goes to the *bottom*, and what it fires climbs the three cables above.
      climb('i', 'low'),
      wire('high', 'rv', 'audio'),
      wire('low', 'rv', 'audio'),
    ],
  ),
}

/**
 * The same two effects, in the two orders, on one trigger.
 *
 * Order is the whole subject and it needs the comparison to be audible, so both halves are here at once:
 * one branch runs a reverb into a wavefolder, the other runs a wavefolder into a reverb. Same two effects,
 * same settings, same notes — and they are not remotely the same sound.
 *
 * **Folding a reverb tail** puts harmonics into something that had none: the tail arrives smooth and
 * leaves ragged, and because a folder's timbre follows the level, it gets *cleaner as it decays*. Nothing
 * else here does that.
 *
 * **Reverberating a folded note** is the ordinary thing. The folding happens to the note while it is loud,
 * and the reverb smears what came out — bright at the front and smooth behind it.
 *
 * Nothing about the patch says which order it is in except the cables, which is the point: there is no
 * setting, no number, nothing to read off a panel. The two chains look different because they are.
 */
const order: Preset = {
  id: 'order',
  name: 'ORDER',
  about: 'Reverb into a wavefolder, and a wavefolder into a reverb. The same two effects, twice.',
  patch: patchOf(
    88,
    [
      ignite('i', 1, 0),
      osc('left', 0, 1, {
        ...IN_KEY,
        // A sine, so everything you hear that is not a sine was made by the chain.
        waveform: 'sine',
        steps: steps([note(0, 0), null, note(4, 0), null], [1, 1, 0.5, 1]),
        division: '1/8',
        gain: 0.3,
        attack: 3,
        decay: 0,
        release: 260,
        gate: 0.5,
        filterType: 'off',
        cutoff: 6000,
        resonance: 1,
      }),
      osc('right', 3, 1, {
        ...IN_KEY,
        waveform: 'sine',
        // The same phrase a fifth up, so the two chains sit apart and can be told from each other.
        steps: steps([note(4, 0), null, note(0, 1), null], [1, 1, 0.5, 1]),
        division: '1/8',
        gain: 0.3,
        attack: 3,
        decay: 0,
        release: 260,
        gate: 0.5,
        filterType: 'off',
        cutoff: 6000,
        resonance: 1,
      }),

      // Reverb first, then the folder: the tail gets folded, and cleans up as it dies.
      fx('rvA', 0, 2, { effect: 'reverb', mix: 0.7, decay: 2.6, cutoff: 3400 }),
      fx('foldA', 0, 3, { effect: 'fold', mix: 1, drive: 0.5, bias: 0.25, cutoff: 5000 }),

      // Folder first, then the reverb: an ordinary bright note, smeared.
      fx('foldB', 3, 2, { effect: 'fold', mix: 1, drive: 0.5, bias: 0.25, cutoff: 5000 }),
      fx('rvB', 3, 3, { effect: 'reverb', mix: 0.7, decay: 2.6, cutoff: 3400 }),
    ],
    [
      wire('i', 'left'),
      wire('i', 'right'),
      wire('left', 'rvA', 'audio'),
      wire('rvA', 'foldA', 'audio'),
      wire('right', 'foldB', 'audio'),
      wire('foldB', 'rvB', 'audio'),
    ],
  ),
}

export const PRESETS: Preset[] = [
  descent,
  drift,
  hive,
  chance,
  bend,
  sift,
  pluck,
  reed,
  rise,
  order,
  duck,
  shadow,
  iron,
  stress,
]
