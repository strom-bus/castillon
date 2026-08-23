import { EFFECTS } from '../audio/effects'
import { effectCost, estimatePeakLoad } from '../audio/load'
import { LFO_SHAPES, silentBecause, targetsFor } from '../audio/modulation'
import { DEGREES, type ScaleName } from '../audio/scales'
import { defaultDelayParams, defaultFxParams, defaultOscParams } from '../nodes/registry'
import type {
  Division,
  ModParams,
  FxParams,
  OscParams,
  Patch,
  PatchEdge,
  PatchNode,
  Waveform,
  WarpParams,
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

/**
 * Which scales the dice draws from, named rather than spelled out as intervals.
 *
 * It used to carry its own private copy of five interval lists, and that was the bug: the generator chose
 * notes from a scale and then never told the oscillator which one, so the first bar somebody dragged on a
 * rolled patch left the key the patch was written in. Taking the names from the app means the value it
 * writes and the notes it drew cannot disagree.
 *
 * A subset, not all of them. Each of these sounds deliberate whichever notes get drawn from it, which is
 * not true of every scale the instrument offers.
 */
const SCALES: Exclude<ScaleName, 'free'>[] = [
  'minorPentatonic',
  'pentatonic',
  'dorian',
  'phrygian',
  'wholeTone',
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
 * Half a grid step, which is about one node's footprint.
 *
 * Cascade nodes land on whole steps, so the halves between them are where an effect or a modulator can
 * sit without covering anything.
 */
const CELL_X = COLUMN / 2
const CELL_Y = ROW / 2

/** Rows of cells a node covers: it is taller than half a row, and no node is taller than a whole one. */
const CELLS_TALL = 2

/**
 * How far along a row to look, in half columns, before trying a different row.
 *
 * Two full columns. Far enough to clear a sixteen-step sequencer and whatever sits past it, near enough
 * that the thing still reads as attached to what it is wired to rather than as adrift beside it.
 */
const REACH = 4

/** Step bars, from the stylesheet: each one this wide, this far apart, inside this much padding. */
const STEP_WIDTH = 26
const STEP_GAP = 6
const STEP_PADDING = 16

/**
 * Which cells a node covers, which is never just the one it sits at.
 *
 * Two things were wrong with counting a cell a node, and they had to be found one at a time because each
 * hid the other.
 *
 * Across, an oscillator has no width of its own: it is as wide as its step bars, and sixteen of them come
 * to 522 pixels against a cell's 280. Read at the moment of claiming rather than stored, because an
 * oscillator is positioned before its steps are rolled — how many there are depends on nothing the
 * placement knows.
 *
 * Down, *every* node is taller than a cell. A header and a body come to about 130 pixels against 115, so
 * anything sitting half a row beneath another lands inside its lower edge. Hence two rows of cells each,
 * which says the half-row below a node is part of the node. No pixel count is relied on for this: a cell
 * being half a row and a node fitting inside a whole one is what the cascade already assumes when it
 * spaces its rows.
 */
export function cellsOf(node: {
  type: string
  position: { x: number; y: number }
  params: unknown
}) {
  const steps = node.type === 'osc' ? ((node.params as OscParams).steps?.length ?? 0) : 0
  const width = steps > 0 ? steps * STEP_WIDTH + (steps - 1) * STEP_GAP + STEP_PADDING : 0
  const wide = Math.max(1, Math.ceil(width / CELL_X))

  const cells: string[] = []
  for (let across = 0; across < wide; across++) {
    for (let down = 0; down < CELLS_TALL; down++) {
      cells.push(
        `${Math.round(node.position.x / CELL_X) + across},${Math.round(node.position.y / CELL_Y) + down}`,
      )
    }
  }
  return cells
}

/**
 * Where to look for room beside a node, nearest first.
 *
 * Generated rather than written out so the search cannot run out: it spirals outwards until something is
 * free. `side` is -1 to look left and 1 to look right, which is the only difference between placing an
 * effect and placing a modulator — effects go to the right of what they process, modulators to the left
 * of what they shape, so a node with both is not sandwiched.
 */
function nearbyCells(side: 1 | -1): Array<[number, number]> {
  const cells: Array<[number, number]> = []
  /*
   * The row is searched to its end before any other row is considered.
   *
   * Which is the whole preference: an effect alongside what it processes reads as belonging to it, and the
   * same effect a row lower reads as a voice of its own. The nesting used to run the other way — every
   * vertical offset at one column out, before ever trying two columns out — and a wide sequencer covers the
   * half-column beside it, so the first cell that came back free was reliably the one underneath.
   *
   * Whole rows down, half columns across. Claiming the half-row beneath a node is not enough on its own,
   * because a probe half a row down is also a column or more across, and there the cell is genuinely free.
   * What it is not is usable: the node landing on it claims two rows, the lower of which is the row a wide
   * neighbour occupies.
   */
  for (let ring = 0; ring <= 8; ring++) {
    const rows = ring === 0 ? [0] : [ring * CELLS_TALL, -ring * CELLS_TALL]
    for (const down of rows) {
      for (let out = 1; out <= REACH; out++) cells.push([side * out, down])
    }
  }
  return cells
}

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

function randomOsc(
  c: Chance,
  scale: Exclude<ScaleName, 'free'>,
  root: number,
  voices: number,
): OscParams {
  /*
   * Whether this oscillator uses the step scope, decided once for the whole sequence.
   *
   * Per oscillator rather than per step, because that is what the switches are: one line that thins out
   * and rolls, against another that keeps time, is music. Every line doing both at once is mush, so the
   * odds are deliberately below a half — a rolled patch should have one voice doing this and not four.
   */
  const varies = c.chance(0.35)
  const rolls = c.chance(0.3)
  // A glide time, or none at all: without one the per-step switch below has nothing to work with.
  const glide = c.chance(0.3) ? c.range(30, 220) : 0

  const steps = Array.from({ length: c.pick(STEP_COUNTS) }, () => ({
    note: root + c.pick(DEGREES[scale]) + 12 * c.int(3),
    // Rests are what makes a sequence a phrase rather than a run of notes.
    active: c.chance(0.78),
    /*
     * Mostly full, sometimes not.
     *
     * An accent is a note louder than its neighbours, so a sequence where every step drew its own level
     * has no accents at all — it has a texture. Two steps in five at a lower level leaves the rest as
     * the reference the quiet ones are heard against.
     */
    velocity: c.chance(0.4) ? c.range(35, 85) / 100 : 1,
    // Only on the oscillators that turned the switch on, and only on some of their steps.
    ...(varies && c.chance(0.4) ? { chance: c.range(25, 85) / 100 } : {}),
    ...(rolls && c.chance(0.3)
      ? {
          ratchet: c.pick([2, 2, 3, 4]),
          // Mostly fading, which is what a roll does: a flat roll is four notes stuck together, and one
          // that swells is a deliberate effect rather than the ordinary case.
          ratchetRamp: c.weighted([
            [c.range(40, 90) / 100, 6],
            [0, 2],
            [-c.range(30, 70) / 100, 2],
          ]),
        }
      : {}),
    // A slide is worth one note in a phrase, not most of them.
    ...(glide > 0 && c.chance(0.2) ? { slide: true } : {}),
  }))

  const filtered = c.chance(0.45)
  return {
    ...defaultOscParams(),
    waveform: c.weighted(WAVEFORM_WEIGHTS),
    pulseWidth: c.range(15, 85) / 100,
    steps,
    division: c.pick(DIVISIONS),
    // Written down rather than left implicit, so dragging a bar on a rolled patch stays in the key the
    // patch was rolled in — which is the first thing anybody does to one.
    scale,
    scaleRoot: ((root % 12) + 12) % 12,
    useChance: varies,
    useRatchet: rolls,
    // Divided by the root of the voice count, because sources that are not in phase sum in power
    // rather than in amplitude. That keeps a wall of oscillators about as loud as a single one.
    gain: Math.max(0.03, c.range(20, 40) / 100 / Math.sqrt(voices)),
    attack: c.chance(0.25) ? c.range(60, 400) : c.range(1, 20),
    // Zero most of the time: a note that holds its level is the plainer sound and the one to fall back
    // to, and a decay on every voice makes a whole patch sound plucked.
    decay: c.chance(0.35) ? c.range(60, 700) : 0,
    release: c.range(30, 600),
    gate: c.range(35, 95) / 100,
    glide,
    // Small, and often none. Detune is for two voices beating against each other, and its whole use is
    // that it is a few cents — a big value is just a patch out of tune.
    detune: c.chance(0.3) ? c.range(-14, 14) : 0,
    filterType: filtered ? c.pick(['lowpass', 'highpass', 'bandpass'] as const) : 'off',
    cutoff: c.range(300, 6000, 50),
    resonance: c.range(1, 12),
    // Only means anything with a filter, and mostly on: without it the top of a wide sequence goes dull
    // while the bottom stays open, which reads as a patch that runs out of energy as it climbs.
    keyTrack: filtered ? c.range(0, 90) / 100 : 0,
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
  /**
   * Cells already occupied, so nothing is ever placed on top of anything.
   *
   * Effects and modulators used to be offset by the loop index that produced them, which grows without
   * bound — the fifth effect landed nearly three rows below its oscillator, on top of whatever lived
   * there. A patch that looks like a mistake is worse than a patch that is merely dense.
   */
  const taken = new Set<string>()
  const cellOf = (x: number, y: number) => `${Math.round(x / CELL_X)},${Math.round(y / CELL_Y)}`
  const claim = (node: { type: string; position: { x: number; y: number }; params: unknown }) => {
    for (const cell of cellsOf(node)) taken.add(cell)
  }

  const add = (node: Omit<PatchNode, 'id'>): PatchNode => {
    const withId = { ...node, id: `r${n++}` }
    claim(node)
    nodes.push(withId)
    return withId
  }

  /** The nearest free cell beside a node, on the side asked for. */
  const beside = (from: PatchNode, side: 1 | -1): { x: number; y: number } => {
    for (const [across, down] of nearbyCells(side)) {
      const at = { x: from.position.x + across * CELL_X, y: from.position.y + down * CELL_Y }
      if (!taken.has(cellOf(at.x, at.y))) return at
    }
    // Eight cells out in both directions and everything taken: further out still beats overlapping.
    return { x: from.position.x + side * CELL_X * 9, y: from.position.y }
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
  /**
   * What triggers each oscillator, kept so a modulator can be given the same trigger.
   *
   * An envelope set to fire on a trigger needs a cable, and the node that would supply one is only in
   * scope inside the loop below. Recording it is the whole reason the die can roll an envelope at all —
   * the first version rolled LFOs only because this was thrown away.
   */
  const triggeredBy = new Map<string, PatchNode>()

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
        triggeredBy.set(osc.id, via ?? parent)
        children.push(osc)
        oscillators.push(osc)
      }

      parents = children
      row = oscRow + 1
    }
  }

  for (const osc of oscillators) {
    osc.params = randomOsc(c, scale, root, oscillators.length)
    // Claimed again now that it has steps, and so a width. Everything placed with `beside` comes after
    // this, which is the only reason a late claim is enough.
    claim(osc)
  }

  const wanted = Math.round(
    (oscillators.length * c.range(...(size.effects.map((v) => v * 100) as [number, number]))) / 100,
  )
  const effects = Math.min(MAX_EFFECTS, Math.max(size.effects[1] > 0.5 ? 1 : 0, wanted))

  for (let i = 0; i < effects; i++) {
    const target = c.pick(oscillators)
    const fx = add({
      type: 'fx',
      // The nearest free cell to its right. Several effects may share one oscillator, which is a patch
      // worth making, so each takes the next space along rather than a fixed offset.
      position: beside(target, 1),
      params: randomFx(c),
    })
    wire(target, fx, 'audio')
  }

  /*
   * Modulators, which the die had never rolled — so a third of what the instrument can do never turned
   * up in a patch nobody wired by hand.
   *
   * All three flavours, and the kind depends on what the destination can support:
   *
   * - **Per note** needs a target built per note, which is an oscillator's filter and nothing else. It
   *   needs no trigger cable — notes are its clock — which makes it the *easiest* of the three to roll
   *   rather than the hardest, the opposite of what the first pass assumed.
   * - **Per trigger** needs a cable from whatever triggers the destination, so the sweep lands when
   *   that branch lights up. Only oscillators have a trigger to share.
   * - **An LFO** needs nothing and fits anywhere, so it stays the commonest: it reads as a texture
   *   rather than as a gesture, and a patch of nothing but gestures is exhausting.
   *
   * A target is drawn from what the destination actually offers, and one that would do nothing is
   * skipped — a cutoff on an oscillator with its filter off is a cable that looks wired and is not.
   */
  const destinations = [...oscillators, ...nodes.filter((node) => node.type === 'fx')]
  const modulators = c.chance(0.55) ? c.range(1, 3) : 0

  for (let i = 0; i < modulators && destinations.length > 0; i++) {
    const destination = c.pick(destinations)
    const effect = destination.type === 'fx' ? (destination.params as FxParams).effect : undefined
    const offered = targetsFor(destination.type, effect).filter(
      (target) =>
        !silentBecause(target.key, {
          nodeType: destination.type,
          effect,
          filterType: (destination.params as OscParams).filterType,
        }),
    )
    if (offered.length === 0) continue

    const perVoice = offered.filter((entry) => entry.perVoice)
    const trigger = triggeredBy.get(destination.id)
    const kind = c.weighted<'lfo' | 'note' | 'trigger'>([
      ['lfo', 5],
      ['note', perVoice.length > 0 ? 3 : 0],
      ['trigger', trigger ? 3 : 0],
    ])
    const target = kind === 'note' ? c.pick(perVoice) : c.pick(offered)

    const params: ModParams =
      kind === 'lfo'
        ? {
            kind: 'lfo',
            wave: c.pick([...LFO_SHAPES]),
            // Slow: a modulation you can follow is worth more than one that buzzes.
            rate: c.range(5, 120) / 100,
            depth: c.range(25, 85) / 100,
            target: target.key,
          }
        : {
            kind: 'env',
            fires: kind,
            // A per-note sweep has one note to fit inside; one on a trigger has a whole branch, so it
            // can take its time.
            attack: kind === 'note' ? c.range(2, 60) : c.range(20, 600),
            decay: kind === 'note' ? c.range(40, 500) : c.range(200, 2500),
            depth: c.range(30, 90) / 100,
            target: target.key,
          }

    const mod = add({
      type: 'mod',
      // Opposite the effects, which sit to the right, so a node with both is not sandwiched.
      position: beside(destination, -1),
      params,
    })
    wire(mod, destination, 'mod')
    // The same trigger the destination answers to, so the sweep lands when that branch lights up.
    if (kind === 'trigger' && trigger) wire(trigger, mod)
  }

  /*
   * A warp, sometimes, and never more than one.
   *
   * It bends everything the cascade reaches from where it lands, which makes it the widest-reaching node
   * there is and the one most easily overdone: two of them stack, and two rolled at random stack in a way
   * nobody chose. One is a patch with a decision in it; three is a patch with an accident in it.
   *
   * It lands on an oscillator, because that is the only thing a warp can bend — and since reach travels
   * downward, one on the top of a branch takes the branch. Preferring a shallow one, so the warp is
   * usually doing something to a run of nodes rather than to a single leaf at the bottom.
   *
   * And it is given one dimension rather than four. All four at once is a patch nobody can hear their way
   * back out of, and each on its own is legible: this branch is a third up, or this one runs at two
   * thirds of the speed, or this one happens most of the time.
   */
  if (c.chance(0.3) && oscillators.length > 1) {
    /*
     * Shallowest first, and among those at random.
     *
     * A warp on the last oscillator of a branch reaches one node, which is a warp you cannot hear as a
     * warp — it looks like that oscillator was simply set differently. Higher up, the same node bends
     * several and the point of it is audible.
     */
    const shallowest = Math.min(...oscillators.map((one) => one.position.y))
    const highest = oscillators.filter((one) => one.position.y === shallowest)
    const host = c.pick(highest)
    const params = c.weighted<WarpParams>([
      // A third or a fifth in degrees of the scale, so it is an interval and not an interval-shaped
      // number of semitones. Away from zero, since a warp of nothing is a node that does nothing.
      [{ transpose: c.pick([-4, -2, 2, 3, 4]) }, 4],
      // Ratios from the same list the panel offers, so a rolled patch cannot hold a speed a person
      // could not have chosen.
      [{ transpose: 0, speed: c.pick([0.5, 2 / 3, 1.5, 2]) }, 3],
      [{ transpose: 0, chance: c.range(55, 90) / 100 }, 2],
      [{ transpose: 0, velocity: c.range(40, 80) / 100 }, 1],
    ])

    const warp = add({
      type: 'warp',
      // To the left, like the modulators: the right-hand side belongs to effects, and a node with one of
      // each should not be sandwiched between them.
      position: beside(host, -1),
      params,
    })
    wire(warp, host, 'warp')
  }

  return trimToBudget({
    version: 1,
    bpm: c.range(70, 170, 2),
    loop: true,
    nodes,
    edges,
  })
}

/**
 * What a roll may cost, and it is **not** a share of `MAX_LOAD` any more.
 *
 * They were the same number for as long as the ceiling was a hundred, and separating them is the point:
 * the ceiling is about what a machine can do, and this is about what a patch can *be*. The real ceiling
 * turned out to be fifty times higher, and a roll fifty times bigger is not a better roll — it is
 * several hundred nodes nobody can read on a canvas.
 *
 * So this is a taste number, and the only one in this file that is. Generous enough for a rack of
 * effects and a wall of oscillators, nowhere near what the machine would allow.
 */
export const ROLL_BUDGET = 300

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
  const limit = ROLL_BUDGET
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
