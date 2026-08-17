import { midiToFreq, stepDuration } from '../audio/clock'
import { MAX_VOICES, OVERLAP_THRESHOLD, type Engine } from '../audio/engine'
import type { NodeParams, Osc4Params, PatchNode } from '../types/patch'
import type { ActivityBus } from '../viz/activity'

export interface ScheduleArgs {
  node: PatchNode
  /** Instante absoluto en que el nodo recibe el trigger. */
  time: number
  bpm: number
  engine: Engine
  activity: ActivityBus
}

export interface ScheduleResult {
  /** Cuándo termina el nodo su trabajo. Marca el final de la rama. */
  endTime: number
  /** Instantes en los que este nodo dispara a sus hijos. */
  outgoing: number[]
}

export interface NodeDefinition {
  type: string
  label: string
  category: 'source' | 'sequencer' | 'utility'
  defaults(): NodeParams
  schedule(args: ScheduleArgs): ScheduleResult
}

/** Duración del destello de un nodo que no tiene duración propia. */
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

export const STEP_COUNT = 4

/** Arpegio por defecto: un nodo recién creado ya suena a algo. */
const DEFAULT_NOTES = [48, 52, 55, 60] // C3 E3 G3 C4

export function defaultOsc4Params(): Osc4Params {
  return {
    waveform: 'square',
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

    // Solapamiento (PLAN.md §2.2): superponer sólo mientras haya presupuesto de voces.
    // Al pasar del umbral, el nodo reinicia en lugar de acumular, y la textura se degrada
    // sola antes de que aparezcan los glitches.
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

export const NODE_DEFINITIONS: NodeDefinition[] = [start, osc4]

const byType = new Map(NODE_DEFINITIONS.map((d) => [d.type, d]))

export function getDefinition(type: string): NodeDefinition | undefined {
  return byType.get(type)
}
