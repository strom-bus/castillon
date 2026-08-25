import { detuneRatio, midiToFreq, stepDuration } from '../audio/clock'
import { trackedCutoff } from '../audio/filter'
import { transposeBy } from '../audio/scales'
import type { Engine } from '../audio/engine'
import { MIN_REDUCTION, MIN_REPEATS } from '../audio/dsp'
import { LAYER_THRESHOLD, MAX_LOAD } from '../audio/load'
import type {
  SieveParams,
  SenseParams,
  DelayParams,
  Direction,
  FxParams,
  ModParams,
  NodeParams,
  NodeId,
  OscParams,
  PatchEdge,
  PatchNode,
  Step,
  WarpParams,
} from '../types/patch'
import {
  MAX_DELAY_MS,
  MAX_MOD_ATTACK,
  MAX_RATCHET,
  MAX_SLOP,
  MAX_EVERY,
  MAX_SWING,
  MAX_WARP,
  MIN_SWING,
  MAX_WARP_RATIO,
  MIN_WARP_RATIO,
  MAX_MOD_DECAY,
  MIN_DELAY_MS,
  MIN_MOD_ATTACK,
  MIN_MOD_DECAY,
} from '../types/patch'
import type { ActivityBus } from '../viz/activity'

export interface ScheduleArgs {
  node: PatchNode
  /** Absolute time at which the node receives the trigger. */
  time: number
  bpm: number
  engine: Engine
  activity: ActivityBus
  /** What every WARP reaching this node comes to. Neutral unless one of them is on the branch. */
  warping?: Warping
  /**
   * How many triggers have reached this node since the transport started, counting from one.
   *
   * A different quantity from `lap` and equal to it only in a plain chain. A node inside a cycle is
   * reached many times in one pass; a node under an oscillator propagating on every step is reached once
   * per step. Counting arrivals is defined in both, which counting passes is not.
   */
  arrival?: number
  /**
   * Which time round the cascade this is, counting from one.
   *
   * There is no bar here, so a pass is the only thing that recurs — and this is what lets a node happen
   * on some passes and not others. Defaulted, because every node that does not care about it should not
   * have to say so.
   */
  lap?: number
}

export interface ScheduleResult {
  /** When the node finishes its work. Marks the end of the branch. */
  endTime: number
  /** Times at which this node fires its children. */
  outgoing: number[]
  /**
   * Whether this node kept a branch from happening that would otherwise have run.
   *
   * Only a SIEVE ever says so, and it is what tells a pass apart from a shorter one. A pass that is
   * short because a branch was withheld must not shorten the cycle — otherwise a branch set to every
   * other pass fires at irregular intervals. A pass that is short because it *is* short must be left
   * alone, which is what an odd-length sequence with a swing is. The two look identical from the
   * outside, so the node that did the withholding is the only thing that can tell them apart.
   */
  withheld?: boolean
}

export interface NodeDefinition {
  /** Identifies the type in a patch and in the patch code. */
  type: string
  /** What the palette button says. */
  label: string
  /**
   * Where the node stands, which is the one division worth drawing in the palette.
   *
   * A cascade node is wired top to bottom and is part of what fires what. A side node hangs off one and
   * changes it without being in the order at all. That is the difference a person has to hold to use any
   * of this, and it happens to be the difference between the two directions cables run in — so the
   * palette says it once instead of leaving it to be worked out six times.
   */
  place: 'cascade' | 'side'
  /**
   * Which ports the node has, declared here rather than left to be read off its JSX.
   *
   * Two lists that must agree and could not be derived from one another: the connection rules decided
   * what a cable may join, and each component decided what a cable can land on. When they disagreed the
   * failure was silent in the worst way — a cable the rules permit but the canvas cannot draw is refused
   * by hand for no stated reason, and *invisible* when it arrives from a preset, the dice or a patch
   * code, since the edge is in the data whether or not there is a handle to hang it on. The patch then
   * plays as though the cable is there, and it is.
   *
   * `trigger` is a port at the top, at the bottom, or both: `in` can be fired, `out` can fire something,
   * `both` passes a trigger on. `side` is the pair of signal ports — audio, modulation or a warp, which
   * of the three being decided by what is at the cable's other end rather than by the port.
   */
  ports: {
    trigger?: 'in' | 'out' | 'both'
    /**
     * The pair of signal ports, and whether the two sides mean the same thing.
     *
     * `'either'` is what everything had until a SENSE existed: two interchangeable ports, so a neighbour
     * attaches on whichever side it already sits on and the cable stays short. Which side a cable uses is
     * cosmetic, chosen from the layout rather than stored.
     *
     * `'directed'` is the SENSE, where they cannot be interchangeable: audio comes in the left and
     * modulation goes out the right. It is the first node where a side *means* something, and the reason
     * is that both directions between a SENSE and an oscillator are legal and are different **kinds** of
     * cable — so the drag alone cannot say which was meant, and the port has to.
     */
    side?: 'either' | 'directed'
    /**
     * A second trigger output, at the top, whose cables run the cascade **upward**.
     *
     * Only the IGNITE has one, and the asymmetry is the point: a pass begins at an IGNITE, so that is the
     * only place it makes sense to say which way it begins. Declared here rather than left to the
     * component for the same reason the other ports are — two lists that must agree and cannot be derived
     * from one another, where a disagreement is silent and a cable arriving from a patch code has no
     * handle to hang on.
     */
    up?: boolean
  }
  defaults(): NodeParams
  /**
   * Absent for nodes that are not in the event graph. An FX node has no event ports, so nothing
   * can trigger it and the scheduler never reaches it — it processes whatever passes through.
   */
  schedule?(args: ScheduleArgs): ScheduleResult
}

/** Flash length for a node with no duration of its own. */
const FLASH = 0.12

const start: NodeDefinition = {
  // Kept as 'start' rather than 'ignite': the type reads better than the label in a stack
  // trace or a serialised patch, and the two do not have to match.
  type: 'start',
  label: 'IGNITE',
  place: 'cascade',
  ports: { trigger: 'out', up: true },
  defaults: () => ({}),
  schedule({ node, time, activity }) {
    activity.push({ kind: 'node', id: node.id, time, duration: FLASH })
    return { endTime: time, outgoing: [time] }
  },
}

export const DEFAULT_DELAY_MS = 500

export function defaultDelayParams(): DelayParams {
  return { delayMs: DEFAULT_DELAY_MS }
}

/**
 * Holds the trigger and passes it on later. It is an *event* delay, not an audio effect: it makes
 * no sound of its own, it just shifts when the branch below it starts. Chain accounting picks the
 * wait up through `endTime`, so the loop waits for it before restarting.
 */
const delay: NodeDefinition = {
  type: 'delay',
  label: 'DELAY',
  place: 'cascade',
  ports: { trigger: 'both' },
  defaults: defaultDelayParams,
  schedule({ node, time, activity }) {
    const params = node.params as DelayParams
    const ms = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, params.delayMs ?? DEFAULT_DELAY_MS))
    const wait = ms / 1000
    // The flash lasts the whole wait, which is what drives the progress bar in the UI.
    activity.push({ kind: 'node', id: node.id, time, duration: wait })
    return { endTime: time + wait, outgoing: [time + wait] }
  },
}

export function defaultSieveParams(): SieveParams {
  // Neutral: counts nothing, tosses nothing, passes everything. A sieve dropped into a chain is not a
  // change until it is asked to be, the same promise a warp makes.
  return { counts: 'passes', every: 1, offset: 1, chance: 1 }
}

/**
 * Whether this pass belongs to a sieve set to `offset` of every `every`.
 *
 * Counting from one, so 1:2 is the first of every pair and 2:2 is the second — which is how alternation
 * is written: two sieves over the same run, disagreeing about which passes are theirs. The modulo is
 * taken twice because the first passes can put `lap - offset` below zero, and JavaScript's remainder
 * keeps the sign.
 */
export function sieveLetsThrough(params: SieveParams, lap: number): boolean {
  const every = Math.min(MAX_EVERY, Math.max(1, Math.round(params.every ?? 1)))
  const offset = Math.min(every, Math.max(1, Math.round(params.offset ?? 1)))
  return (((lap - offset) % every) + every) % every === 0
}

const sieve: NodeDefinition = {
  type: 'sieve',
  label: 'SIEVE',
  place: 'cascade',
  ports: { trigger: 'both' },
  defaults: defaultSieveParams,
  schedule({ node, time, activity, engine, lap = 1, arrival = 1 }) {
    const params = node.params as SieveParams
    // Passes of the cascade, or triggers arriving here. The same number in a plain chain, and different
    // wherever it matters: under `onStep`, below several parents, or inside a cycle.
    const counted = sieveLetsThrough(params, params.counts === 'triggers' ? arrival : lap)
    const odds = clamp(params.chance ?? 1, 0, 1)
    const passes = counted && (odds >= 1 || engine.chance() < odds)

    /*
     * Lit only on the passes that are its own.
     *
     * A node that flashed whether or not it let anything through would say "a trigger reached me", which
     * is true of every pass and therefore says nothing. Lighting on the ones it passes makes the pattern
     * visible on the canvas — two sieves alternating are two nodes taking turns, which is the thing you
     * are trying to see.
     */
    if (passes) activity.push({ kind: 'node', id: node.id, time, duration: FLASH })

    // Ends where it began either way: it holds nothing back in time, only sometimes in fact. So a branch
    // that does not happen this pass costs the cascade no length, and the lap keeps its shape.
    return { endTime: time, outgoing: passes ? [time] : [], withheld: !passes }
  },
}

export function defaultWarpParams(): WarpParams {
  // Every dimension at its neutral point, so a warp just added does nothing until it is asked to.
  return { transpose: 0, speed: 1, velocity: 1, chance: 1, level: 1 }
}

/**
 * A modifier attached to a node, moving that node and everything the cascade reaches from it.
 *
 * It stood *in* the cascade first, between two nodes like a delay, and that was the mistake. Getting one
 * between two nodes meant breaking the cable that joined them, which nothing said and nobody did — so it
 * went beside that cable instead, the node below fired twice, and the untransposed pass masked the moved
 * one. It read as a node that only worked at the head of a chain, and moving a whole cascade meant
 * putting it directly under the Ignite because there was nowhere else it did anything.
 *
 * Attached, it needs no rewiring at all: onto an Ignite it takes the cascade, onto an oscillator just
 * that branch. It has no schedule, because nothing triggers it — the scheduler reads what is hanging on
 * a node as the trigger arrives.
 */
const warp: NodeDefinition = {
  type: 'warp',
  label: 'WARP',
  place: 'side',
  ports: { side: 'either' },
  defaults: defaultWarpParams,
}

/**
 * The transforms hanging on a node, added to whichever are already applying.
 *
 * A list of which ones rather than a total of how much, because a patch may loop back on itself: a
 * total would add the same transform again on every lap, so a two-node cycle under a transform set to
 * one step would climb without limit until the depth cap stopped it. A transform applies to a node or
 * it does not, and going round twice does not make it apply twice.
 */
export function warpsOn(
  edges: PatchEdge[],
  nodeId: NodeId,
  already: readonly NodeId[],
): readonly NodeId[] {
  let grown: NodeId[] | null = null
  for (const edge of edges) {
    if (edge.kind !== 'warp' || edge.target !== nodeId) continue
    if (already.includes(edge.source)) continue
    grown ??= [...already]
    grown.push(edge.source)
  }
  return grown ?? already
}

/** Everything a stack of warps comes to, which is what a branch below them is bent by. */
export interface Warping {
  /** Steps of pitch, added. */
  pitch: number
  /** Ratios, multiplied. */
  speed: number
  velocity: number
  chance: number
  /** Output level, multiplied — which is not velocity. See `WarpParams.level`. */
  level: number
  /** The long half of a step pair against the short. 1 is straight, and also multiplied. */
  swing: number
  /** How far a note may fall from where it was written, as a share of the shortest gap. Added. */
  slop: number
}

export const NO_WARPING: Warping = {
  pitch: 0,
  speed: 1,
  velocity: 1,
  chance: 1,
  level: 1,
  swing: 1,
  slop: 0,
}

/**
 * What a list of warps comes to.
 *
 * Pitch adds and the rest multiply, and the difference is not arbitrary: two warps a third up each come
 * to a sixth up, while two at half speed each come to a quarter. Both are the same operation applied
 * twice, which is the property that lets them stack without anybody deciding which one wins.
 */
export function warpingOf(nodes: PatchNode[], applying: readonly NodeId[]): Warping {
  if (applying.length === 0) return NO_WARPING

  const total: Warping = { ...NO_WARPING }
  for (const id of applying) {
    const node = nodes.find((one) => one.id === id)
    if (node?.type !== 'warp') continue
    const params = node.params as WarpParams
    total.pitch += clamp(Math.round(params.transpose ?? 0), -MAX_WARP, MAX_WARP)
    total.speed *= clamp(params.speed ?? 1, MIN_WARP_RATIO, MAX_WARP_RATIO)
    total.velocity *= clamp(params.velocity ?? 1, 0, MAX_WARP_RATIO)
    total.chance *= clamp(params.chance ?? 1, 0, MAX_WARP_RATIO)
    total.level *= clamp(params.level ?? 1, 0, MAX_WARP_RATIO)
    // Only where the switch is on, which is what makes it a bypass rather than a second neutral point:
    // the ratio is remembered while off, so a groove can be listened to straight and put back.
    if (params.useSwing) total.swing *= clamp(params.swing ?? 1, MIN_SWING, MAX_SWING)
    // Added rather than multiplied, following the pitch: two warps asking for looseness make a branch
    // looser. Clamped after the sum, at the point where notes can meet and still not cross.
    if (params.useSlop) total.slop += clamp(params.slop ?? 0, 0, MAX_SLOP)
  }
  total.slop = clamp(total.slop, 0, MAX_SLOP)
  return total
}

/** Selectable sequence lengths. Append-only: the patch code stores the index into this. */
/**
 * How many steps a sequence may have: any number from one to sixteen.
 *
 * It was 2, 4, 8 and 16 — powers of two, which is the most bar-like constraint there is, in an instrument
 * whose whole premise is that there is no bar. Five against four is exactly what a cascade should sound
 * like and was the one thing it could not do. The engine never minded: `resizeSteps` has always taken any
 * number, and what actually forbade it was three bits of patch code holding an *index* into a list of
 * four rather than the count itself.
 *
 * Sixteen because a sequence longer than that stops being a phrase you can hear as one, and one because a
 * single-step oscillator is a usable thing — a drone, or a trigger for whatever hangs below it.
 */
export const MIN_STEPS = 1
export const MAX_STEPS = 16

/** Kept for the places that offer a few sensible lengths rather than all of them. */
export const STEP_COUNTS = [2, 4, 8, 16] as const

export type StepCount = number

export const DEFAULT_STEP_COUNT = 4

/** A patch could name any length; the engine only ever runs one of the four. */
export function normaliseStepCount(count: number): StepCount {
  if (!Number.isFinite(count)) return DEFAULT_STEP_COUNT
  return Math.min(MAX_STEPS, Math.max(MIN_STEPS, Math.round(count)))
}

/**
 * Which step is read in the slot at `index`, given a direction and which pass this is.
 *
 * Counting from zero, and pure over its arguments so the whole of direction is one testable expression
 * rather than a branch inside the scheduling loop.
 *
 * `pingpong` alternates by **pass**, since a pass is one traversal of the sequence and there is nowhere
 * inside it to turn round — the scheduler commits the lot the moment it is triggered. Odd passes run
 * forward and even ones back, so the endpoints repeat: 1 2 3 4 then 4 3 2 1.
 */
export function stepAt(index: number, count: number, direction: Direction, lap: number): number {
  if (count <= 0) return 0
  const back =
    direction === 'reverse' ||
    // Counting from one, so the first pass is the outward one.
    (direction === 'pingpong' && (((lap - 1) % 2) + 2) % 2 === 1)
  return back ? count - 1 - index : index
}

/**
 * Grows or shrinks a sequence by repeating it rather than padding with defaults. Doubling a
 * four-step phrase gives the same phrase twice, which is what a hardware sequencer does and
 * what you almost always want before editing the new half.
 */
export function resizeSteps(steps: Step[], count: number): Step[] {
  const source = steps.length > 0 ? steps : defaultOscParams().steps
  return Array.from({ length: count }, (_, i) => ({ ...source[i % source.length] }))
}

/** Default arpeggio: a freshly created node already sounds like something. */
const DEFAULT_NOTES = [48, 52, 55, 60] // C3 E3 G3 C4

export function defaultOscParams(): OscParams {
  return {
    waveform: 'square',
    pulseWidth: 0.5,
    // Dead centre, so a node made today is in tune exactly as one made before detune existed was.
    detune: 0,
    steps: DEFAULT_NOTES.map((note) => ({ note, active: true, velocity: 1 })),
    division: '1/8',
    gain: 0.25,
    attack: 4,
    // Zero, so a node created today sounds exactly as one created before decay existed did.
    decay: 0,
    release: 40,
    // No slide, so a node made today jumps between steps as one made before glide existed did.
    glide: 0,
    gate: 0.6,
    filterType: 'off',
    cutoff: 2000,
    resonance: 1,
    // Off, so a node made today sounds as one made before tracking existed did.
    keyTrack: 0,
    // Both off: a sequencer does what it always did until it is asked for more.
    useChance: false,
    useRatchet: false,
    // And free, which is not a scale switched off but the way everything played until there were any.
    scale: 'free',
    scaleRoot: 0,
    propagateMode: 'onEnd',
    direction: 'forward',
  }
}

const osc: NodeDefinition = {
  type: 'osc',
  label: 'OSC',
  place: 'cascade',
  ports: { trigger: 'both', side: 'either' },
  defaults: defaultOscParams,
  schedule({ node, time, bpm, engine, activity, warping = NO_WARPING, lap = 1 }) {
    const params = node.params as OscParams
    /*
     * A warp on the branch stretches or compresses every step below it.
     *
     * Divided rather than multiplied because the number is a speed and this is a duration: at twice the
     * speed a step lasts half as long. It changes how long the whole sequence takes, and therefore when
     * this node hands the cascade on — which is the point. A delay sets two branches a fixed distance
     * apart and they stay that far apart for ever; a ratio makes them drift and keep drifting.
     */
    const step = stepDuration(bpm, params.division) / warping.speed

    // Only layer while there is budget left, counted in work rather than in voices — a rack of
    // effects is paid for before a note is played, so it is the effects that decide how much
    // layering is left. Past the threshold the node restarts instead of piling up, and the texture
    // degrades on its own before glitches show up.
    const stillSounding = engine.nodeBusyUntil(node.id) > time
    const load = engine.voiceLoadAt(time) + engine.effectLoad()
    if (stillSounding && load >= MAX_LOAD * LAYER_THRESHOLD) {
      engine.releaseNodeVoices(node.id, time)
    }

    const count = normaliseStepCount(params.steps?.length ?? DEFAULT_STEP_COUNT)
    activity.push({ kind: 'node', id: node.id, time, duration: step * count })

    /*
     * Swing, as a pair of steps sharing their two step-lengths unevenly.
     *
     * The long half gets `swing / (swing + 1)` of the pair and the short half the rest, so **a pair keeps
     * its total** — a sequence takes exactly as long swung as straight, and hands the cascade on at the
     * same moment. That is what stops this being a Speed in disguise: it changes how a branch feels and
     * never when it ends, so swinging one branch cannot pull the patch apart.
     *
     * At a swing of 1 both halves are one step and every line below reduces to what it was.
     *
     * **Paired by where a step falls across the whole run, not by where it falls in this pass.** Step
     * counts used to be powers of two, so a pass always held whole pairs and the two readings agreed. Now
     * that a sequence can be five steps long a pass can end mid-pair, and pairing within the pass would
     * put two long halves together at the loop — a stumble rather than a groove.
     *
     * Counting from the top of the cascade instead, an odd-length line swings *continuously*: its pattern
     * comes round every two passes rather than breaking every one. The cost is that those two passes are
     * not the same length, which is honest — a swing genuinely does not fit an odd count in one lap, and
     * this instrument has never promised a fixed one. With an even count nothing changes at all.
     *
     * Only possible because a chain counts its passes now, which arrived for the SIEVE.
     */
    /*
     * This sequence's own feel, scaled by whatever a warp above asks for.
     *
     * The same relation `division` has to a warp's `speed`, one line above: absolute on the node,
     * relative on the warp. Which is what lets both cases exist — one oscillator swung on its own, and a
     * whole branch swung from one control — where the warp alone could only ever do the second, since it
     * reaches everything below whatever it is attached to.
     */
    const own = params.useSwing ? clamp(params.swing ?? 1, MIN_SWING, MAX_SWING) : 1
    const swing = clamp(own * warping.swing, MIN_SWING, MAX_SWING * MAX_SWING)

    const pair = step * 2
    const long = (pair * swing) / (swing + 1)
    /** Whether this pass begins mid-pair, which only an odd step count can cause. */
    const from = ((lap - 1) * count) % 2
    const lengthOf = (index: number) => ((index + from) % 2 === 0 ? long : pair - long)
    // Summed rather than solved: with a pass that can begin mid-pair there is no closed form worth the
    // trouble at sixteen steps.
    const startOf = (index: number) => {
      let at = 0
      for (let i = 0; i < index; i++) at += lengthOf(i)
      return at
    }

    /*
     * How far a note may fall from where it was written: a share of the shortest gap in this sequence.
     *
     * The short half rather than the step, so the guarantee survives a swing. Two notes each free to move
     * by this close on each other by twice it, and the share is capped at a half — so at the very worst
     * two notes meet, and none can ever land before the one in front of it. A note out of order does not
     * sound loose, it sounds broken.
     *
     * Measured against the sequence rather than in milliseconds because the same thirty milliseconds is
     * five per cent of the gap in a slow straight bass and two hundred and forty per cent of it in a fast
     * branch at heavy swing. One setting, two opposite results, in a machine whose branches run at
     * different speeds on purpose.
     */
    const ownSlop = params.useSlop ? clamp(params.slop ?? 0, 0, MAX_SLOP) : 0
    const wobble = (pair - long) * clamp(ownSlop + warping.slop, 0, MAX_SLOP)

    for (let i = 0; i < count; i++) {
      /*
       * Centred, so a branch is loose rather than late — always-late is a different feel and a different
       * control. The floor is the trigger instant: a branch cannot start before the thing that started
       * it, and the first note is the only one close enough to `now` for that to matter. Everything after
       * it is far enough ahead to move either way.
       */
      const nudge = wobble > 0 ? (engine.chance() * 2 - 1) * wobble : 0
      const at = Math.max(time, time + startOf(i) + nudge)
      const held = lengthOf(i)
      /*
       * Which step's *content* plays in this slot. The slot itself — when it starts, how long it lasts,
       * which half of a swung pair it is — belongs to `i` and does not move, which is what keeps a
       * reversed sequence swinging forward instead of running its groove backwards too.
       *
       * The lit bar follows the content rather than the slot: what you want to see is the step you are
       * hearing, and on the way back those are not the same number.
       */
      const from = stepAt(i, count, params.direction ?? 'forward', lap)
      const s = params.steps[from]
      activity.push({ kind: 'step', id: node.id, step: from, time: at, duration: held })
      if (!s || !s.active) continue

      /*
       * Rolled once for the whole step rather than once per hit.
       *
       * A step happens or it does not, and if it does, all of its hits do. Rolling for each hit of a
       * four-hit roll turns it into a stutter — a fine sound to want and a poor thing to get by default,
       * since it would make a plain sequence unpredictable in a way nobody asked it to be.
       */
      /*
       * A step's own chance, scaled by whatever the branch is being warped by.
       *
       * The branch scaling applies even where the oscillator does not use per-step chance, which is
       * deliberate: "this branch happens half the time" is worth wanting without having set a chance on
       * sixteen steps first. Clamped, since the product may land either side of what a chance can be.
       */
      const own = params.useChance ? (s.chance ?? 1) : 1
      const chance = clamp(own * warping.chance, 0, 1)
      if (chance < 1 && engine.chance() >= chance) continue

      /*
       * And its velocity, likewise scaled by the branch.
       *
       * Clamped to one because it feeds two things at once: how loud the note is, and — wherever a
       * per-note envelope takes its depth from velocity — how far that envelope opens. Past one the
       * first would only clip while the second went on climbing, so they part company.
       */
      const velocity = clamp(s.velocity * warping.velocity, 0, 1)

      // Hits share the slot, so a roll fits inside the step rather than running over the next one. The
      // step being swung, a roll on the long half is slower than the same roll on the short one — which
      // is what a roll played with a groove does.
      const asked = params.useRatchet ? (s.ratchet ?? 1) : 1
      const hits = Math.min(MAX_RATCHET, Math.max(1, Math.round(asked)))
      const slot = held / hits

      for (let hit = 0; hit < hits; hit++) {
        /*
         * Where in the roll this hit falls, and how loud that makes it.
         *
         * A ramp of one takes the last hit to silence and of minus one brings the first up from it, with
         * everything between them on a straight line. One hit is untouched: there is no roll to ramp
         * across, so the number has nothing to say.
         */
        const along = hits > 1 ? hit / (hits - 1) : 0
        const ramp = clamp(s.ratchetRamp ?? 0, -1, 1)
        const rolled = clamp(velocity * (1 - ramp * (ramp > 0 ? along : along - 1)), 0, 1)

        engine.playNote({
          nodeId: node.id,
          time: at + hit * slot,
          freq:
            midiToFreq(
              transposeBy(s.note, warping.pitch, params.scale ?? 'free', params.scaleRoot ?? 0),
            ) * detuneRatio(params.detune ?? 0),
          // ?? keeps patches saved before waveforms existed playable.
          waveform: params.waveform ?? 'square',
          pulseWidth: params.pulseWidth ?? 0.5,
          duration: slot * params.gate,
          /*
           * The oscillator's own gain, the step's rolled velocity, and whatever the branch is being
           * levelled by. Clamped at one, which is full scale: a branch already there cannot be made
           * louder, and one at a quarter — which is where most of them sit — has four times to give.
           *
           * Clamped here and not in `warpingOf`, because the ceiling belongs to the *note* and not to the
           * warp: two warps each asking for double is a fourfold ask, and whether that fits depends on
           * how loud the oscillator was to begin with.
           */
          gain: clamp(params.gain * rolled * warping.level, 0, 1),
          velocity: rolled,
          attack: params.attack,
          decay: params.decay ?? 0,
          release: params.release,
          // Only the note that was asked to slide, and only its first hit: the rest of a roll is the
          // same pitch, so there is nothing for them to slide from.
          glide: s.slide && hit === 0 ? (params.glide ?? 0) : 0,
          filterType: params.filterType ?? 'off',
          cutoff: trackedCutoff(
            params.cutoff ?? 2000,
            transposeBy(s.note, warping.pitch, params.scale ?? 'free', params.scaleRoot ?? 0),
            params.keyTrack ?? 0,
          ),
          resonance: params.resonance ?? 1,
        })
      }
    }

    /*
     * Where the sequence actually ends, which is where its last step ends.
     *
     * `count * step` while every count was even, since a whole number of pairs comes to exactly that.
     * An odd count under a swing does not: its pass holds one more long half than short, so the last
     * step ran past the end the node reported and the next pass began underneath it. Summing the steps
     * is right in both cases and identical in the old one.
     */
    const endTime = time + startOf(count)
    let outgoing: number[]
    switch (params.propagateMode) {
      case 'onStart':
        outgoing = [time]
        break
      case 'onStep':
        // Each step's own start, swing included: firing the branch below on the grid while the notes
        // above it were swung would be two rhythms, not one.
        outgoing = Array.from({ length: count }, (_, i) => time + startOf(i))
        break
      default:
        outgoing = [endTime]
    }
    return { endTime, outgoing }
  },
}

export function defaultFxParams(): FxParams {
  return {
    effect: 'reverb',
    mix: 0.5,
    decay: 2,
    drive: 0.4,
    shape: 'overdrive',
    time: '1/8',
    feedback: 0.35,
    filterType: 'lowpass',
    // Open enough that an effect does not arrive sounding muffled.
    cutoff: 6000,
    resonance: 1,
    rate: 1.5,
    depth: 0.4,
    bits: 8,
    reduction: MIN_REDUCTION,
    pan: 0,
    width: 0.3,
    sweep: 6,
    // A3, which is in the middle of the range and in the key most of the presets are in.
    pitch: 57,
    // Centred, so a wavefolder added and not touched makes odd harmonics only.
    bias: 0,
    // Flat, so an EQ added and not touched is a wire. A shelf or a bell at nought decibels is exactly
    // unity, which is what makes that true of the nodes and not only of the numbers.
    low: 0,
    mid: 0,
    high: 0,
    // One, which is a wire: every slice live, nothing repeated.
    repeats: MIN_REPEATS,
    // A compressor that is not compressing: nothing crosses a threshold at nought decibels, and a ratio
    // of one passes what it hears whatever it hears. Neutral at rest, like everything else here.
    threshold: 0,
    ratio: 1,
    attack: 10,
  }
}

/**
 * Audio only: it has no event ports, makes no sound of its own, and is never scheduled. What it
 * does is decided by the effect table in audio/effects.ts, and how it is wired is decided by the
 * router in audio/router.ts. This definition exists so the palette and the store know it is real.
 */
const fx: NodeDefinition = {
  type: 'fx',
  label: 'FX',
  place: 'side',
  ports: { side: 'either' },
  defaults: defaultFxParams,
}

/** A new MOD: a sine slow enough to hear as a shape, at a depth that is obvious but not violent. */
export function defaultModParams(): ModParams {
  return {
    target: 'level',
    kind: 'lfo',
    fires: 'trigger',
    wave: 'sine',
    rate: 2,
    depth: 0.6,
    attack: 40,
    decay: 600,
  }
}

/**
 * A modulator, and the only node that sits in **both** graphs.
 *
 * Its side port shapes whatever it is pointed at. Its top and bottom ports put it in the cascade,
 * which is what an envelope needs: a trigger arriving is what makes it run (PLAN §18.7). An LFO
 * ignores the trigger entirely and keeps to its own rate.
 *
 * **The trigger is passed on.** A MOD in the middle of a chain has to be transparent, or wiring one
 * there would silence everything below it and nothing on screen would say why. So it behaves like a
 * Delay with no wait — and that is also what makes "trigger this, sweep that, then carry on" a single
 * node rather than a fork.
 *
 * Because the trigger is explicit rather than inferred, the wiring gives three different behaviours
 * with no modes at all: under an Ignite it runs once per pass of the cascade; under a node deep in the
 * tree it runs when that branch lights up; behind a Delay it runs late.
 */
export function defaultSenseParams(): SenseParams {
  /*
   * Pointed at a level, because that is what a follower is nearly always for — one branch getting out of
   * the way of another — and with a **negative** depth for the same reason. A follower at a positive depth
   * on a level makes the loud thing louder, which is the opposite of every use anybody has for one.
   *
   * Fast up and slow down, which is the shape of a duck. Sensitivity at one: what it hears is what it
   * reads, until somebody tells it otherwise.
   */
  return { target: 'level', depth: -0.7, sensitivity: 1, attack: 5, release: 200 }
}

/**
 * A SENSE: it listens to a branch and moves something with what it hears.
 *
 * The one node whose input is audio and whose output is modulation, which is the cell the other four leave
 * empty — and the reason it is a node rather than a kind of MOD. What a cable *is* has to be decidable
 * from the types at its two ends, and a MOD that sometimes took audio would make `osc → mod` mean an audio
 * cable or a reversed modulation cable depending on a parameter. That invariant is where the two worst
 * faults of the week came from breaking (PLAN §37.1, §45.8).
 *
 * It is not in the cascade, so it has no trigger ports and never fires: it hears whatever is passing and
 * says how much of it there is, for as long as there is any.
 */
const sense: NodeDefinition = {
  type: 'sense',
  label: 'SENSE',
  place: 'side',
  ports: { side: 'directed' },
  defaults: defaultSenseParams,
}

const mod: NodeDefinition = {
  type: 'mod',
  label: 'MOD',
  place: 'side',
  ports: { trigger: 'both', side: 'either' },
  defaults: defaultModParams,
  schedule({ node, time, engine, activity }) {
    const params = node.params as ModParams
    // A per-note envelope has its own clock — every note the oscillator plays — so a trigger arriving
    // here means nothing to it. Firing the shared shape as well would sweep every voice together,
    // which is the other setting.
    if (params.kind === 'env' && params.fires !== 'note') {
      engine.fireEnvelope(node.id, time)
      // The flash lasts the envelope, so what you see is how long the sweep takes.
      const attack = clamp(params.attack ?? 40, MIN_MOD_ATTACK, MAX_MOD_ATTACK)
      const decay = clamp(params.decay ?? 600, MIN_MOD_DECAY, MAX_MOD_DECAY)
      activity.push({ kind: 'node', id: node.id, time, duration: (attack + decay) / 1000 })
    } else {
      /*
       * An LFO begins again here.
       *
       * The trigger port meant nothing to an LFO, which is a whole input wasted on the one node where a
       * phase is worth controlling. Now it gives the port one meaning across both kinds — **a trigger
       * means start now**: for an envelope that is fire, for an LFO it is begin again. Wired, the wobble
       * lines up with the cascade; unwired, it free-runs as before, so the cable is the setting and
       * there is no control to find.
       */
      engine.restartLfo(node.id, time)
      activity.push({ kind: 'node', id: node.id, time, duration: FLASH })
    }
    return { endTime: time, outgoing: [time] }
  },
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * The palette's order, and its grouping: what stands in a cascade first, then what hangs off one.
 *
 * Within each, the order a patch is built in — a cascade starts, then sounds, then waits; and a sound is
 * shaped, then swept, then moved.
 */
export const NODE_DEFINITIONS: NodeDefinition[] = [start, osc, delay, sieve, fx, mod, warp, sense]

const byType = new Map(NODE_DEFINITIONS.map((d) => [d.type, d]))

export function getDefinition(type: string): NodeDefinition | undefined {
  return byType.get(type)
}
