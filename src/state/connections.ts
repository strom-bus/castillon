import type { EdgeKind } from '../types/patch'

/**
 * One place for every rule about what may be wired to what, so the canvas's live validation and the
 * store's commit cannot drift apart.
 *
 * **A side port takes any signal cable, in either direction.** There is one per side rather than one
 * per kind, and what the cable *is* comes from the nodes at its ends: an oscillator reaching an effect
 * is audio, a modulator reaching either is modulation. Two ports per side was the first attempt and it
 * was worse twice over — they sat on top of each other, and it put the same rule in two places, the
 * port names and the node types.
 *
 * The cost of one port is that React Flow can no longer check direction for us: a handle it will let
 * you drag from is a handle it will let you drag to. So direction is decided here, by what is at each
 * end, and a cable drawn backwards is turned round rather than refused. That is the better behaviour
 * anyway — dragging from an oscillator onto a modulator means the same thing as the reverse.
 */

/** Side ports carry signal: audio out of an oscillator, modulation into one. */
const SIGNAL_PREFIX = 'signal'

export const SIGNAL_LEFT = 'signal-l'
export const SIGNAL_RIGHT = 'signal-r'
export const EVENT_IN = 'in'
export const EVENT_OUT = 'out'

/** Whether a handle is on the side of a node, as opposed to its top or bottom. */
export function isSignalHandle(handle: string | null | undefined): boolean {
  return handle?.startsWith(SIGNAL_PREFIX) ?? false
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

/** A connection as it will be stored: which way round it goes, and what kind of cable it is. */
export interface Connected {
  source: string
  target: string
  sourceHandle: string | null
  targetHandle: string | null
  kind: EdgeKind
}

/** Which end of a signal cable is which, decided by the node types rather than by the drag. */
function orient(from: string | undefined, to: string | undefined): EdgeKind | 'reversed' | null {
  // Modulation runs out of a MOD and into something that makes or shapes sound, and only that way.
  if (from === 'mod' && (to === 'osc' || to === 'fx')) return 'mod'
  if (to === 'mod' && (from === 'osc' || from === 'fx')) return 'reversed'

  // Audio only ever runs from an oscillator to an effect. That single restriction is what makes the
  // audio graph bipartite and one hop deep, which is why there is no cycle check to write.
  if (from === 'osc' && to === 'fx') return 'audio'
  if (from === 'fx' && to === 'osc') return 'reversed'

  return null
}

/**
 * Works out the connection an attempt describes, or null if it describes none.
 *
 * Everything else about connecting goes through this: the canvas asks it while a cable is being
 * dragged, and the store asks it again before committing, so the two cannot disagree.
 */
export function connectionFor(
  rules: ConnectionRules,
  attempt: ConnectionAttempt,
): Connected | null {
  const { source, target, sourceHandle = null, targetHandle = null } = attempt
  if (!source || !target || source === target) return null

  const sideStart = isSignalHandle(sourceHandle)
  const sideEnd = isSignalHandle(targetHandle)

  // A side port and a top or bottom one are not two ends of anything.
  if (sideStart !== sideEnd) return null

  const typeOf = (id: string) => rules.nodes.find((node) => node.id === id)?.type
  const already = (from: string, to: string) =>
    // By node pair rather than by handle pair: a node has a side port at each end, and reaching the
    // same destination from both would send it twice over.
    rules.edges.some((edge) => edge.source === from && edge.target === to)

  if (sideStart) {
    const decided = orient(typeOf(source), typeOf(target))
    if (decided === null) return null

    if (decided === 'reversed') {
      return already(target, source)
        ? null
        : {
            source: target,
            target: source,
            sourceHandle: targetHandle,
            targetHandle: sourceHandle,
            kind: orient(typeOf(target), typeOf(source)) as EdgeKind,
          }
    }
    return already(source, target)
      ? null
      : { source, target, sourceHandle, targetHandle, kind: decided }
  }

  // Triggers run down the cascade: out of a bottom port and into a top one. Drawn the other way, it
  // is turned round rather than refused.
  const startsAtOutput = sourceHandle === EVENT_OUT || sourceHandle === null
  const endsAtInput = targetHandle === EVENT_IN || targetHandle === null
  if (startsAtOutput && endsAtInput) {
    return already(source, target)
      ? null
      : { source, target, sourceHandle, targetHandle, kind: 'event' }
  }
  if (sourceHandle === EVENT_IN && targetHandle === EVENT_OUT) {
    return already(target, source)
      ? null
      : {
          source: target,
          target: source,
          sourceHandle: targetHandle,
          targetHandle: sourceHandle,
          kind: 'event',
        }
  }

  return null
}

export function canConnect(rules: ConnectionRules, attempt: ConnectionAttempt): boolean {
  return connectionFor(rules, attempt) !== null
}
