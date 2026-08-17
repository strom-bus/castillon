import { midiToFreq, stepDuration } from '../audio/clock'
import { MAX_VOICES, OVERLAP_THRESHOLD, type Engine } from '../audio/engine'
import type { DelayParams, NodeParams, Osc4Params, PatchNode } from '../types/patch'
import { MAX_DELAY_MS, MIN_DELAY_MS } from '../types/patch'
import type { ActivityBus } from '../viz/activity'

export interface ScheduleArgs {
  node: PatchNode
  /** Absolute time at which the node receives the trigger. */
  time: number
  bpm: number
  engine: Engine
  activity: ActivityBus
}

export interface ScheduleResult {
  /** When the node finishes its work. Marks the end of the branch. */
  endTime: number
  /** Times at which this node fires its children. */
  outgoing: number[]
}

export interface NodeDefinition {
  type: string
  label: string
  category: 'source' | 'sequencer' | 'utility'
  defaults(): NodeParams
  schedule(args: ScheduleArgs): ScheduleResult
}

/** Flash length for a node with no duration of its own. */
const FLASH = 0.12

const start: NodeDefinition = {
  type: 'start',
  label: 'Start',
  category: 'utility',
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
  label: 'Delay',
  category: 'utility',
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

export const STEP_COUNT = 4

/** Default arpeggio: a freshly created node already sounds like something. */
const DEFAULT_NOTES = [48, 52, 55, 60] // C3 E3 G3 C4

export function defaultOsc4Params(): Osc4Params {
  return {
    waveform: 'square',
    pulseWidth: 0.5,
    steps: DEFAULT_NOTES.map((note) => ({ note, active: true, velocity: 1 })),
    division: '1/8',
    gain: 0.25,
    attack: 4,
    release: 40,
    gate: 0.6,
    propagateMode: 'onEnd',
  }
}

const osc4: NodeDefinition = {
  type: 'osc4',
  label: 'Osc 4',
  category: 'sequencer',
  defaults: defaultOsc4Params,
  schedule({ node, time, bpm, engine, activity }) {
    const params = node.params as Osc4Params
    const step = stepDuration(bpm, params.division)

    // Layering (PLAN.md §2.2): only layer while there is voice budget left. Past the
    // threshold the node restarts instead of piling up, so the texture degrades on its own
    // before glitches show up.
    const stillSounding = engine.nodeBusyUntil(node.id) > time
    if (stillSounding && engine.voicesAt(time) >= MAX_VOICES * OVERLAP_THRESHOLD) {
      engine.releaseNodeVoices(node.id, time)
    }

    activity.push({ kind: 'node', id: node.id, time, duration: step * STEP_COUNT })

    for (let i = 0; i < STEP_COUNT; i++) {
      const at = time + i * step
      const s = params.steps[i]
      activity.push({ kind: 'step', id: node.id, step: i, time: at, duration: step })
      if (!s || !s.active) continue
      engine.playNote({
        nodeId: node.id,
        time: at,
        freq: midiToFreq(s.note),
        // ?? keeps patches saved before waveforms existed playable.
        waveform: params.waveform ?? 'square',
        pulseWidth: params.pulseWidth ?? 0.5,
        duration: step * params.gate,
        gain: params.gain * s.velocity,
        attack: params.attack,
        release: params.release,
      })
    }

    const endTime = time + STEP_COUNT * step
    let outgoing: number[]
    switch (params.propagateMode) {
      case 'onStart':
        outgoing = [time]
        break
      case 'onStep':
        outgoing = Array.from({ length: STEP_COUNT }, (_, i) => time + i * step)
        break
      default:
        outgoing = [endTime]
    }
    return { endTime, outgoing }
  },
}

export const NODE_DEFINITIONS: NodeDefinition[] = [start, osc4, delay]

const byType = new Map(NODE_DEFINITIONS.map((d) => [d.type, d]))

export function getDefinition(type: string): NodeDefinition | undefined {
  return byType.get(type)
}
