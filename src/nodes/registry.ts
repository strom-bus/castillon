import { detuneRatio, midiToFreq, stepDuration } from '../audio/clock'
import { trackedCutoff } from '../audio/filter'
import { transposeBy } from '../audio/scales'
import type { Engine } from '../audio/engine'
import { MIN_REDUCTION } from '../audio/dsp'
import { LAYER_THRESHOLD, MAX_LOAD } from '../audio/load'
import type {
  DelayParams,
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
  MAX_WARP,
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
}

export interface ScheduleResult {
  /** When the node finishes its work. Marks the end of the branch. */
  endTime: number
  /** Times at which this node fires its children. */
  outgoing: number[]
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

export function defaultWarpParams(): WarpParams {
  // Every dimension at its neutral point, so a warp just added does nothing until it is asked to.
  return { transpose: 0, speed: 1, velocity: 1, chance: 1 }
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
}

export const NO_WARPING: Warping = { pitch: 0, speed: 1, velocity: 1, chance: 1 }

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
  }
  return total
}

/** Selectable sequence lengths. Append-only: the patch code stores the index into this. */
export const STEP_COUNTS = [2, 4, 8, 16] as const

export type StepCount = (typeof STEP_COUNTS)[number]

export const DEFAULT_STEP_COUNT: StepCount = 4

/** A patch could name any length; the engine only ever runs one of the four. */
export function normaliseStepCount(count: number): StepCount {
  return (STEP_COUNTS as readonly number[]).includes(count)
    ? (count as StepCount)
    : DEFAULT_STEP_COUNT
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
  }
}

const osc: NodeDefinition = {
  type: 'osc',
  label: 'OSC',
  place: 'cascade',
  defaults: defaultOscParams,
  schedule({ node, time, bpm, engine, activity, warping = NO_WARPING }) {
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

    for (let i = 0; i < count; i++) {
      const at = time + i * step
      const s = params.steps[i]
      activity.push({ kind: 'step', id: node.id, step: i, time: at, duration: step })
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

      // Hits share the slot, so a roll fits inside the step rather than running over the next one.
      const asked = params.useRatchet ? (s.ratchet ?? 1) : 1
      const hits = Math.min(MAX_RATCHET, Math.max(1, Math.round(asked)))
      const slot = step / hits

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
          gain: params.gain * rolled,
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

    const endTime = time + count * step
    let outgoing: number[]
    switch (params.propagateMode) {
      case 'onStart':
        outgoing = [time]
        break
      case 'onStep':
        outgoing = Array.from({ length: count }, (_, i) => time + i * step)
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
const mod: NodeDefinition = {
  type: 'mod',
  label: 'MOD',
  place: 'side',
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
      // An LFO has its own clock and the trigger means nothing to it. It still flashes, so that a
      // cable running through it does not look dead.
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
export const NODE_DEFINITIONS: NodeDefinition[] = [start, osc, delay, fx, mod, warp]

const byType = new Map(NODE_DEFINITIONS.map((d) => [d.type, d]))

export function getDefinition(type: string): NodeDefinition | undefined {
  return byType.get(type)
}
