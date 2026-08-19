import { EFFECTS } from '../audio/effects'
import { effectCost, estimatePeakLoad, MAX_LOAD } from '../audio/load'
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
 * connected so nothing sits grey and silent, levels are shared out as the patch grows so fifty
 * oscillators land where one would, and the tonal waveforms are far likelier than the noise ones.
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

/**
 * How big a roll comes out.
 *
 * The size is chosen *first* and everything else follows from it, because the interesting thing
 * about a dice button is the spread: a handful of nodes and a wall of them are both worth getting,
 * and always landing in the middle is the one outcome that gets boring.
 */
interface Size {
  weight: number
  cascades: [number, number]
  depth: [number, number]
  width: [number, number]
  /** Effects per oscillator, so a big patch gets a rack and a small one gets a pedal. */
  effects: [number, number]
}

const SIZES: Size[] = [
  { weight: 12, cascades: [1, 1], depth: [1, 2], width: [1, 1], effects: [0, 0.5] },
  { weight: 24, cascades: [1, 1], depth: [2, 3], width: [1, 2], effects: [0.1, 0.3] },
  { weight: 30, cascades: [1, 2], depth: [3, 4], width: [1, 3], effects: [0.15, 0.35] },
  { weight: 22, cascades: [2, 3], depth: [3, 5], width: [2, 3], effects: [0.15, 0.4] },
  { weight: 12, cascades: [3, 4], depth: [4, 6], width: [2, 4], effects: [0.2, 0.4] },
]

/** Past this a roll stops being a patch and starts being a stress test. */
const MAX_EFFECTS = 12

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
    // Divided by the root of the voice count, because sources that are not in phase sum in power
    // rather than in amplitude. That keeps a wall of oscillators about as loud as a single one.
    gain: Math.max(0.03, c.range(20, 40) / 100 / Math.sqrt(voices)),
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
  const size = c.weighted(SIZES.map((s) => [s, s.weight] as [Size, number]))

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

  const cascades = c.range(...size.cascades)
  // Laid out as a grid rather than a row: four cascades side by side would be nine thousand pixels
  // wide, which is a patch you have to hunt around rather than look at.
  const perRow = Math.ceil(Math.sqrt(cascades))
  const cascadeColumns = size.width[1] + 1
  const cascadeRows = size.depth[1] * 2 + 2

  const oscillators: PatchNode[] = []

  for (let cascade = 0; cascade < cascades; cascade++) {
    const originColumn = (cascade % perRow) * cascadeColumns
    const originRow = Math.floor(cascade / perRow) * cascadeRows

    const ignite = add({
      type: 'start',
      position: { x: originColumn * COLUMN, y: originRow * ROW },
      params: {},
    })

    // Every node hangs off something, so nothing is ever left grey and silent.
    let row = originRow + 1
    let parents = [ignite]
    const depth = c.range(...size.depth)

    for (let d = 0; d < depth; d++) {
      const width = d === 0 ? 1 : c.range(...size.width)
      const children: PatchNode[] = []
      // A delay takes a row of its own, so siblings stay on one line whether or not one has one.
      const hasDelay = d > 0 && c.chance(0.3)
      const oscRow = row + (hasDelay ? 1 : 0)

      for (let i = 0; i < width; i++) {
        const parent = c.pick(parents)
        const column = originColumn + i

        // A delay between levels is what pulls two branches out of step with each other.
        const via = hasDelay
          ? add({
              type: 'delay',
              position: { x: column * COLUMN, y: row * ROW },
              params: { ...defaultDelayParams(), delayMs: c.range(120, 900, 10) },
            })
          : null
        if (via) wire(parent, via)

        const osc = add({
          type: 'osc',
          // Params come later: the level each one gets depends on how many there turn out to be.
          position: { x: column * COLUMN, y: oscRow * ROW },
          params: {},
        })
        wire(via ?? parent, osc)
        children.push(osc)
        oscillators.push(osc)
      }

      parents = children
      row = oscRow + 1
    }
  }

  for (const osc of oscillators) {
    osc.params = randomOsc(c, scale, root, oscillators.length)
  }

  const wanted = Math.round(
    (oscillators.length * c.range(...(size.effects.map((v) => v * 100) as [number, number]))) / 100,
  )
  const effects = Math.min(MAX_EFFECTS, Math.max(size.effects[1] > 0.5 ? 1 : 0, wanted))

  for (let i = 0; i < effects; i++) {
    const target = c.pick(oscillators)
    const fx = add({
      type: 'fx',
      // Beside its oscillator, and stepped down by index: several effects may share one oscillator,
      // which is a patch worth making, and without the step they would land on the same spot.
      position: {
        x: target.position.x + COLUMN * 0.55,
        y: target.position.y + i * Math.round(ROW * 0.55),
      },
      params: randomFx(c),
    })
    wire(target, fx, 'audio')
  }

  return trimToBudget({
    version: 1,
    bpm: c.range(70, 170, 2),
    loop: true,
    nodes,
    edges,
  })
}

/** Aimed under the ceiling rather than at it, so a roll has somewhere to breathe. */
const BUDGET_TARGET = 0.85

/**
 * Brings a roll inside the budget by taking things away, cheapest decision first.
 *
 * Trimming afterwards rather than predicting up front, because the peak cost of a cascade depends on
 * release tails and divisions in ways that are easier to measure on the finished patch than to
 * forecast while building it.
 *
 * Effects go before oscillators: they are the dearest points per node, and losing one costs a colour
 * while losing an oscillator costs a voice. Only leaves are taken, so nothing is ever orphaned.
 */
function trimToBudget(patch: Patch): Patch {
  const limit = MAX_LOAD * BUDGET_TARGET
  let nodes = patch.nodes
  let edges = patch.edges

  // Bounded: every pass removes a node, so it cannot outlast the patch.
  for (let pass = 0; pass < nodes.length; pass++) {
    if (estimatePeakLoad({ ...patch, nodes, edges }) <= limit) break

    const effects = nodes.filter((n) => n.type === 'fx')
    const victim =
      effects.length > 0
        ? effects.reduce((worst, n) =>
            effectCost(n.params as FxParams) > effectCost(worst.params as FxParams) ? n : worst,
          )
        : lastLeaf(nodes, edges)

    if (!victim) break
    nodes = nodes.filter((n) => n.id !== victim.id)
    edges = edges.filter((e) => e.source !== victim.id && e.target !== victim.id)
  }

  return { ...patch, nodes, edges }
}

/** An oscillator with nothing hanging off it, so removing it strands nothing. */
function lastLeaf(nodes: PatchNode[], edges: PatchEdge[]): PatchNode | undefined {
  const parents = new Set(edges.filter((e) => e.kind === 'event').map((e) => e.source))
  return nodes.filter((n) => n.type === 'osc' && !parents.has(n.id)).at(-1)
}
