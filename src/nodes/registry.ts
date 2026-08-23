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
  OscParams,
  PatchNode,
  Step,
  TransformParams,
} from '../types/patch'
import {
  MAX_DELAY_MS,
  MAX_MOD_ATTACK,
  MAX_RATCHET,
  MAX_TRANSPOSE,
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
  /** What every TRANSFORM above this node adds up to. Zero unless one of them is in the branch. */
  transpose?: number
}

export interface ScheduleResult {
  /** When the node finishes its work. Marks the end of the branch. */
  endTime: number
  /** Times at which this node fires its children. */
  outgoing: number[]
  /**
   * Steps this node adds to what everything below it plays, if any.
   *
   * Added to what arrived rather than replacing it, so two of them stacked come to the sum of the two —
   * which is the property that makes it worth being a node. Anything that replaced instead would raise
   * the question of which one wins, and there is no good answer to that.
   */
  transpose?: number
}

export interface NodeDefinition {
  /** Identifies the type in a patch and in the patch code. */
  type: string
  /** What the palette button says. */
  label: string
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

export function defaultTransformParams(): TransformParams {
  return { transpose: 0 }
}

/**
 * A node that changes what happens below it and makes no sound of its own.
 *
 * The same shape as a DELAY, which is the argument for it being a node at all: a delay moves a branch in
 * time and this moves one in pitch. Put it on an oscillator instead and it stops being per-branch — ten
 * oscillators down a branch would be ten edits — and stacking two would mean nothing.
 *
 * It passes the trigger straight through. Everything it does happens to the notes underneath, and the
 * scheduler is what carries it there.
 */
const transform: NodeDefinition = {
  type: 'transform',
  label: 'TRANSFORM',
  defaults: defaultTransformParams,
  schedule({ node, time, activity }) {
    const params = node.params as TransformParams
    activity.push({ kind: 'node', id: node.id, time, duration: FLASH })
    return {
      endTime: time,
      outgoing: [time],
      transpose: clamp(Math.round(params.transpose ?? 0), -MAX_TRANSPOSE, MAX_TRANSPOSE),
    }
  },
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
  defaults: defaultOscParams,
  schedule({ node, time, bpm, engine, activity, transpose = 0 }) {
    const params = node.params as OscParams
    const step = stepDuration(bpm, params.division)

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
      const chance = params.useChance ? (s.chance ?? 1) : 1
      if (chance < 1 && engine.chance() >= chance) continue

      // Hits share the slot, so a roll fits inside the step rather than running over the next one.
      const asked = params.useRatchet ? (s.ratchet ?? 1) : 1
      const hits = Math.min(MAX_RATCHET, Math.max(1, Math.round(asked)))
      const slot = step / hits

      for (let hit = 0; hit < hits; hit++) {
        engine.playNote({
          nodeId: node.id,
          time: at + hit * slot,
          freq:
            midiToFreq(
              transposeBy(s.note, transpose, params.scale ?? 'free', params.scaleRoot ?? 0),
            ) * detuneRatio(params.detune ?? 0),
          // ?? keeps patches saved before waveforms existed playable.
          waveform: params.waveform ?? 'square',
          pulseWidth: params.pulseWidth ?? 0.5,
          duration: slot * params.gate,
          gain: params.gain * s.velocity,
          velocity: s.velocity,
          attack: params.attack,
          decay: params.decay ?? 0,
          release: params.release,
          // Only the note that was asked to slide, and only its first hit: the rest of a roll is the
          // same pitch, so there is nothing for them to slide from.
          glide: s.slide && hit === 0 ? (params.glide ?? 0) : 0,
          filterType: params.filterType ?? 'off',
          cutoff: trackedCutoff(
            params.cutoff ?? 2000,
            transposeBy(s.note, transpose, params.scale ?? 'free', params.scaleRoot ?? 0),
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

/** This order is the palette's order: what a cascade needs, in the order you need it. */
export const NODE_DEFINITIONS: NodeDefinition[] = [start, osc, fx, mod, delay, transform]

const byType = new Map(NODE_DEFINITIONS.map((d) => [d.type, d]))

export function getDefinition(type: string): NodeDefinition | undefined {
  return byType.get(type)
}
