import { NODE_DEFINITIONS } from '../nodes/registry'
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

/**
 * What a WARP can be attached to: the thing that plays notes, and nothing else.
 *
 * This said `start`, `osc`, `delay` for four commits and two of those three were wrong — found because
 * a warp rolled by the dice came out with no cable on it. The rules permitted an Ignite and the Ignite
 * had no side port, so the cable was refused when drawn by hand and *invisible* when it arrived from a
 * preset, the dice or a patch code: the patch played warped with nothing on screen saying why.
 *
 * The first fix was to give an Ignite and a Delay side ports, and it was the wrong fix — a hole
 * covered rather than closed. Neither node has anything a warp can bend. A Delay's wait is a number in
 * milliseconds that no ratio scales; an Ignite has no notes, no pitch and no tempo of its own. A warp
 * attached to either was never bending that node at all, it was using it as a place to stand while it
 * reached the oscillators below — reach dressed up as attachment, and paid for with two signal ports on
 * nodes that have nothing to do with signal.
 *
 * So the rule matches what a warp can actually do, and the ports stop needing to be invented: **it
 * attaches to an oscillator**, and bends that one and everything the cascade reaches from it. A whole
 * cascade is still one warp, on the oscillator at the top of it, because reach travels downward and
 * always did. What is genuinely lost is one case — an Ignite with two oscillators directly under it,
 * where a single warp used to cover both and now takes two. Two warps that each cover their own branch
 * is a thing anybody can read; a warp hanging off a trigger source is not.
 *
 * Exported because the canvas has to render a side port on every one of these, and there is no way to
 * derive one list from the other by reading the components. `ui/ports.test.tsx` is what makes them
 * agree, and it is the test that would have caught the original fault on the day it was introduced.
 */
export const WARPABLE = new Set(['osc'])

/*
 * There is deliberately no "does this node have side ports" guard in `orient`.
 *
 * One was added when a warp turned out to be attachable to an Ignite, and it was the wrong shape of fix:
 * a rule naming a type that cannot take the cable is a rule to correct, not a rule to filter afterwards.
 * Every type named below has side ports, and `connections.test.ts` asserts that over the whole rule set
 * rather than re-checking it on every call — which catches a rule added wrongly in future, where a guard
 * would only have made one silently do nothing.
 */

const triggerOf = (type: string | undefined) =>
  NODE_DEFINITIONS.find((one) => one.type === type)?.ports.trigger

/** Whether a trigger can run from one node type into another: one has a way out, the other a way in. */
function canTrigger(from: string | undefined, to: string | undefined): boolean {
  const out = triggerOf(from)
  const into = triggerOf(to)
  return (out === 'out' || out === 'both') && (into === 'in' || into === 'both')
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

  /*
   * A WARP attaches to whatever it is meant to bend, and bends that thing and everything the cascade
   * reaches from it. Onto an Ignite it takes the whole cascade, onto an oscillator just that branch —
   * which is the point of attaching rather than standing in the chain. Standing in it meant the cable
   * joining two nodes had to be broken to get between them, and one wired beside that cable instead of
   * in place of it does nothing you can hear: the node below fires twice, and the unwarped pass masks
   * the warped one.
   */
  if (from === 'warp' && WARPABLE.has(to ?? '')) return 'warp'
  if (to === 'warp' && WARPABLE.has(from ?? '')) return 'reversed'

  // Audio only ever runs from an oscillator to an effect. That single restriction is what makes the
  // audio graph bipartite and one hop deep, which is why there is no cycle check to write.
  if (from === 'osc' && to === 'fx') return 'audio'
  if (from === 'fx' && to === 'osc') return 'reversed'

  return null
}

/**
 * Whether a cable of this kind may run from one node type to the other, stored this way round.
 *
 * The rule `connectionFor` applies, asked without a drag. A patch that arrives already built — from a
 * preset, the dice, or a patch code — never goes through a drag, so nothing was checking its edges
 * against the rules at all. A warp wired to an Ignite survived four commits that way: permitted by a
 * rule, undrawable by the canvas, and present in three shipped patches.
 *
 * Asked per kind rather than "what cable goes between these two", because one pair of types can carry
 * more than one. An oscillator and a MOD take a modulation cable from the MOD *and* a trigger cable
 * into it, and a function returning one answer has to throw the other away.
 */
export function permits(from: string | undefined, to: string | undefined, kind: EdgeKind): boolean {
  // A trigger runs out of a bottom port and into a top one, so it is a question about ports. Read from
  // the node definitions rather than assumed, so this and the canvas answer from one declaration
  // instead of from two lists somebody has to keep in step.
  if (kind === 'event') return canTrigger(from, to)

  return orient(from, to) === kind
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
    // Checked against the port declarations and not only against the handle names. A handle that is
    // null — which is what a patch code carries, since it stores which nodes a cable joins and not
    // which port — would otherwise be taken as a trigger port on any node at all, including one that
    // has none. That is the same fault as a warp on an Ignite, in the other direction.
    return canTrigger(typeOf(source), typeOf(target)) && !already(source, target)
      ? { source, target, sourceHandle, targetHandle, kind: 'event' }
      : null
  }
  if (sourceHandle === EVENT_IN && targetHandle === EVENT_OUT) {
    return canTrigger(typeOf(target), typeOf(source)) && !already(target, source)
      ? {
          source: target,
          target: source,
          sourceHandle: targetHandle,
          targetHandle: sourceHandle,
          kind: 'event',
        }
      : null
  }

  return null
}

export function canConnect(rules: ConnectionRules, attempt: ConnectionAttempt): boolean {
  return connectionFor(rules, attempt) !== null
}
