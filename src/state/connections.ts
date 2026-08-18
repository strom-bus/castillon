import type { EdgeKind } from '../types/patch'

/**
 * Handle ids carrying audio start with this. An oscillator has two of them, left and right, so an
 * effect can be attached on whichever side it happens to sit and the cable stays short.
 */
const AUDIO_PREFIX = 'audio'

export const AUDIO_LEFT = 'audio-l'
export const AUDIO_RIGHT = 'audio-r'
export const EVENT_IN = 'in'
export const EVENT_OUT = 'out'

export function handleKind(handle: string | null | undefined): EdgeKind {
  return handle?.startsWith(AUDIO_PREFIX) ? 'audio' : 'event'
}

export interface ConnectionAttempt {
  source: string | null
  target: string | null
  sourceHandle?: string | null
  targetHandle?: string | null
}

interface NodeLike {
  id: string
  type?: string
}

interface EdgeLike {
  source: string
  target: string
}

export interface ConnectionRules {
  nodes: NodeLike[]
  edges: EdgeLike[]
}

/**
 * One place for every rule about what may be wired to what, so the canvas's live validation and
 * the store's commit cannot drift apart.
 *
 * Audio only ever runs from an oscillator to an effect. That single restriction is what makes the
 * audio graph bipartite and one hop deep, which is why there is no cycle check here to write.
 */
export function connectionKind(attempt: ConnectionAttempt): EdgeKind | null {
  const from = handleKind(attempt.sourceHandle)
  const to = handleKind(attempt.targetHandle)
  return from === to ? from : null
}

export function canConnect(rules: ConnectionRules, attempt: ConnectionAttempt): boolean {
  const { source, target } = attempt
  if (!source || !target || source === target) return false

  const kind = connectionKind(attempt)
  if (!kind) return false

  // Compared by node pair rather than by handle pair: an oscillator has an audio out on both
  // sides, and reaching the same effect from each would send it twice over.
  if (rules.edges.some((e) => e.source === source && e.target === target)) return false

  if (kind === 'audio') {
    const sourceType = rules.nodes.find((n) => n.id === source)?.type
    const targetType = rules.nodes.find((n) => n.id === target)?.type
    return sourceType === 'osc' && targetType === 'fx'
  }

  return true
}
