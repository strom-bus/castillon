/** Modelo de datos del patch. Todo aquí es serializable a JSON: ningún objeto de Web Audio. */

export type NodeId = string

/**
 * Los dos grafos superpuestos (PLAN.md §2). En el PoC sólo se dibujan cables de evento,
 * pero el campo existe desde ya para no tener que migrar patches en la Fase 3.
 */
export type EdgeKind = 'event' | 'audio'

export type Division = '1/4' | '1/8' | '1/16'

export type PropagateMode = 'onEnd' | 'onStart' | 'onStep'

export interface Step {
  /** Nota MIDI. C1 = 24, C6 = 84. */
  note: number
  active: boolean
  velocity: number
}

export interface Osc4Params {
  waveform: 'square'
  steps: Step[]
  division: Division
  /** 0–1 */
  gain: number
  /** Milisegundos. */
  attack: number
  release: number
  /** Fracción del paso que dura la nota. 0.6 = percusivo, 1 = legato. */
  gate: number
  propagateMode: PropagateMode
}

export type StartParams = Record<string, never>

export type NodeParams = Osc4Params | StartParams

export interface PatchNode {
  id: NodeId
  type: string
  position: { x: number; y: number }
  params: NodeParams
}

export interface PatchEdge {
  id: string
  kind: EdgeKind
  source: NodeId
  target: NodeId
}

export interface Patch {
  version: 1
  bpm: number
  loop: boolean
  nodes: PatchNode[]
  edges: PatchEdge[]
}

export const MIN_NOTE = 24 // C1
export const MAX_NOTE = 84 // C6
