import { EFFECTS } from '../audio/effects'
import { defaultDelayParams, defaultFxParams, defaultOscParams } from '../nodes/registry'
import type {
  Division,
  FxParams,
  OscParams,
  Patch,
  PatchEdge,
  PatchNode,
  Waveform,
} from '../types/patch'

/**
 * A patch worth listening to, at random.
 *
 * Truly random parameters give noise, and nobody presses that twice. So the taste is in the
 * constraints: notes come from one scale rather than the chromatic set, the tree is always fully
 * connected so nothing sits grey and silent, gains fall as the patch grows so six oscillators do not
 * clip, and the tonal waveforms are far likelier than the noise ones.
 *
 * The generator takes its randomness as an argument, which is what makes any of that testable.
 */

/** Intervals from the root. Each of these sounds deliberate whichever notes get drawn from it. */
const SCALES: number[][] = [
  [0, 3, 5, 7, 10], // minor pentatonic
  [0, 2, 4, 7, 9], // major pentatonic
  [0, 2, 3, 5, 7, 9, 10], // dorian
  [0, 1, 3, 5, 7, 8, 10], // phrygian
  [0, 2, 4, 6, 8, 10], // whole tone
]

/** Weighted towards pitch. Noise is a colour to reach for, not a coin flip. */
const WAVEFORM_WEIGHTS: [Waveform, number][] = [
  ['square', 5],
  ['sawtooth', 5],
  ['triangle', 4],
  ['pulse', 3],
  ['sine', 3],
  ['ramp', 2],
  ['white', 1],
  ['pink', 1],
  ['brown', 1],
  ['blue', 1],
]

const DIVISIONS: Division[] = ['1/4', '1/8', '1/16']
const STEP_COUNTS = [2, 4, 4, 8, 8, 16]

/** Column spacing wide enough that a sixteen-step node does not overlap its neighbour. */
const COLUMN = 560
const ROW = 230

interface Chance {
  /** 0 ≤ n < count */
  int(count: number): number
  pick<T>(items: T[]): T
  /** Inclusive, rounded to `step`. */
  range(min: number, max: number, step?: number): number
  chance(probability: number): boolean
  weighted<T>(items: [T, number][]): T
}

function chanceFrom(random: () => number): Chance {
  const int = (count: number) => Math.min(count - 1, Math.floor(random() * count))
  return {
    int,
    pick: (items) => items[int(items.length)],
    range: (min, max, step = 1) => min + Math.round((random() * (max - min)) / step) * step,
    chance: (probability) => random() < probability,
    weighted(items) {
      const total = items.reduce((sum, [, weight]) => sum + weight, 0)
      let roll = random() * total
      for (const [item, weight] of items) {
        roll -= weight
        if (roll < 0) return item
      }
      return items[items.length - 1][0]
    },
  }
}

function randomOsc(c: Chance, scale: number[], root: number, voices: number): OscParams {
  const steps = Array.from({ length: c.pick(STEP_COUNTS) }, () => ({
    note: root + c.pick(scale) + 12 * c.int(3),
    // Rests are what makes a sequence a phrase rather than a run of notes.
    active: c.chance(0.78),
    velocity: 1,
  }))

  const filtered = c.chance(0.45)
  return {
    ...defaultOscParams(),
    waveform: c.weighted(WAVEFORM_WEIGHTS),
    pulseWidth: c.range(15, 85) / 100,
    steps,
    division: c.pick(DIVISIONS),
    // Shared out as the patch grows, so a big cascade lands at about the same level as a small one.
    gain: Math.max(0.08, c.range(20, 40) / 100 / Math.sqrt(voices)),
    attack: c.chance(0.25) ? c.range(60, 400) : c.range(1, 20),
    release: c.range(30, 600),
    gate: c.range(35, 95) / 100,
    filterType: filtered ? c.pick(['lowpass', 'highpass', 'bandpass'] as const) : 'off',
    cutoff: c.range(300, 6000, 50),
    resonance: c.range(1, 12),
    propagateMode: c.weighted([
      ['onEnd', 8],
      ['onStart', 2],
      ['onStep', 1],
    ]),
  }
}

function randomFx(c: Chance): FxParams {
  const descriptor = c.pick(EFFECTS)
  return {
    ...defaultFxParams(),
    ...descriptor.defaults,
    effect: descriptor.kind,
    mix: c.range(25, 75) / 100,
  }
}

export function randomPatch(random: () => number = Math.random): Patch {
  const c = chanceFrom(random)
  const scale = c.pick(SCALES)
  const root = c.range(33, 50)

  const nodes: PatchNode[] = []
  const edges: PatchEdge[] = []
  let n = 0
  const add = (node: Omit<PatchNode, 'id'>): PatchNode => {
    const withId = { ...node, id: `r${n++}` }
    nodes.push(withId)
    return withId
  }
  const wire = (from: PatchNode, to: PatchNode, kind: PatchEdge['kind'] = 'event') =>
    edges.push({ id: `e${edges.length}`, kind, source: from.id, target: to.id })

  const cascades = c.chance(0.3) ? 2 : 1
  // Counted up front so gains can be shared out before any node is built.
  const voices = cascades * c.range(2, 4)

  const oscillators: PatchNode[] = []
  let column = 0

  for (let cascade = 0; cascade < cascades; cascade++) {
    const ignite = add({
      type: 'start',
      position: { x: column * COLUMN, y: 0 },
      params: {},
    })

    // Every node hangs off something, so nothing is ever left grey and silent.
    let level = 1
    let parents = [ignite]
    const depth = c.range(2, 3)

    for (let d = 0; d < depth; d++) {
      const width = d === 0 ? 1 : c.range(1, 2)
      const children: PatchNode[] = []
      // A delay takes a row of its own, so siblings stay on one line whether or not one has one.
      const hasDelay = d > 0 && c.chance(0.3)
      const oscRow = level + (hasDelay ? 1 : 0)

      for (let i = 0; i < width; i++) {
        const parent = c.pick(parents)

        // A delay between levels is what pulls two branches out of step with each other.
        const via = hasDelay
          ? add({
              type: 'delay',
              position: { x: (column + i) * COLUMN, y: level * ROW },
              params: { ...defaultDelayParams(), delayMs: c.range(120, 900, 10) },
            })
          : null
        if (via) wire(parent, via)

        const osc = add({
          type: 'osc',
          position: { x: (column + i) * COLUMN, y: oscRow * ROW },
          params: randomOsc(c, scale, root, voices),
        })
        wire(via ?? parent, osc)
        children.push(osc)
        oscillators.push(osc)
      }

      parents = children
      level = oscRow + 1
    }

    column += 2
  }

  const effects = c.chance(0.55) ? c.range(1, 2) : 0
  for (let i = 0; i < effects; i++) {
    const target = c.pick(oscillators)
    const fx = add({
      type: 'fx',
      // Beside its oscillator, and stepped down by index: two effects may share one oscillator,
      // which is a patch worth making, and without the step they would land on the same spot.
      position: {
        x: target.position.x + COLUMN * 0.55,
        y: target.position.y + i * Math.round(ROW * 0.7),
      },
      params: randomFx(c),
    })
    wire(target, fx, 'audio')
  }

  return {
    version: 1,
    bpm: c.range(70, 170, 2),
    loop: true,
    nodes,
    edges,
  }
}
