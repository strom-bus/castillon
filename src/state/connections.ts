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
/**
 * The Ignite's second trigger output, at the top, whose cables run the cascade upward.
 *
 * Its own handle rather than a setting on the cable, because that is what makes the direction *visible*:
 * which port a cable left from is readable on the canvas without selecting anything, the same way a side
 * port says a cable carries signal rather than a trigger.
 */
export const EVENT_UP = 'up'

/**
 * Whether joining `from` to `to` would close a loop in the audio graph.
 *
 * The one rule the event graph does not need, and the reason is worth stating because the asymmetry looks
 * arbitrary: **an event cycle is bounded and an audio cycle is not.** A trigger going round and round runs
 * out of depth at `MAX_DEPTH` and the pass ends. Audio going round and round is a gain — every trip adds
 * to itself, and nothing anywhere stops it. So cycles are a feature in one graph and a fault in the other,
 * and this is where that gets said.
 *
 * Asked of the graph as it stands plus the cable being proposed: walk forward from where the cable would
 * land and see whether it comes back to where it left. A cable onto its own node is the shortest loop
 * there is and is caught by the same walk.
 */
export function wouldFeedBack(from: string, to: string, edges: EdgeLike[]): boolean {
  if (from === to) return true

  const onward = new Map<string, string[]>()
  for (const edge of edges) {
    if (kindOf(edge) !== 'audio') continue
    const list = onward.get(edge.source)
    if (list) list.push(edge.target)
    else onward.set(edge.source, [edge.target])
  }

  const seen = new Set<string>([to])
  const queue = [to]
  while (queue.length > 0) {
    const at = queue.pop() as string
    if (at === from) return true
    for (const next of onward.get(at) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return false
}

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

/**
 * A cable, as either half of the app keeps one.
 *
 * The canvas holds React Flow's shape, which puts everything of ours inside a `data` bag; a patch holds
 * ours, where the same facts are fields. These rules are asked by both — `isValidConnection` during a
 * drag, with the canvas's edges, and the store when it commits, with the same — so it has to read either.
 *
 * Which is a boundary and not a duplication, but it is exactly the shape of thing this codebase keeps
 * getting wrong, so there is one accessor below and nothing reads the field directly.
 */
interface EdgeLike {
  source: string
  target: string
  /** Set on a trigger cable that runs the cascade upward, so a pair can carry one of each. */
  up?: boolean
  /** Which sort of cable it is, where that matters — the audio graph's own shape is one rule (§45). */
  kind?: string
  data?: { up?: boolean; kind?: string }
}

/**
 * Whether a cable runs the cascade upward, wherever the half of the app it came from keeps that.
 *
 * Read from one place because reading it from two is how this went wrong: the rules looked at `edge.up`
 * and the canvas passes edges that carry it as `edge.data.up`, so every cable the canvas offered looked
 * like a descent. The duplicate check then allowed a *second* climb to the same node — permissive rather
 * than strict, which is the harder kind to notice.
 */
function isClimbing(edge: EdgeLike): boolean {
  return edge.up === true || edge.data?.up === true
}

/**
 * Which sort of cable it is, wherever the half of the app it came from keeps that.
 *
 * The same boundary as `isClimbing`, and written the same day the flag version of this bug was found: the
 * canvas keeps it in `data.kind` and a patch keeps it as a field, and reading one of the two is how an
 * audio rule came to look at every cable on the canvas and see no kind at all. An event cable defaults —
 * absent has meant event since the first version of the format.
 */
function kindOf(edge: EdgeLike): string {
  return edge.kind ?? edge.data?.kind ?? 'event'
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
/** Whether this kind of node's two sides mean different things. Only a SENSE's do. */
function directedSides(type: string | undefined): boolean {
  return NODE_DEFINITIONS.find((definition) => definition.type === type)?.ports.side === 'directed'
}

/** Whether this kind of node has the upward trigger output at all. Only the Ignite does. */
function hasUpPort(type: string | undefined): boolean {
  return NODE_DEFINITIONS.find((definition) => definition.type === type)?.ports.up === true
}

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
  /** Set on a trigger cable drawn from the Ignite's upward port. Absent means the ordinary way. */
  up?: boolean
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

  /*
   * Audio runs out of an oscillator and into an effect, and out of an effect into another one — which is
   * how effects go in series, and the whole of how their order is said. There is no setting: the order is
   * the cables, the same as everywhere else here.
   *
   * That second rule is what this comment used to say made a cycle check unnecessary. The audio graph is
   * no longer one hop deep, so the check exists — see `wouldFeedBack`, and §37 for why an audio loop is a
   * different animal from an event one.
   */
  if (from === 'osc' && to === 'fx') return 'audio'
  if (from === 'fx' && to === 'osc') return 'reversed'
  if (from === 'fx' && to === 'fx') return 'audio'

  /*
   * A SENSE listens to audio and puts out modulation, so **both** directions between it and an oscillator
   * are legal and they are different kinds of cable. Nothing else here is like that: everywhere else, one
   * direction is the cable and the other is the same cable drawn backwards.
   *
   * Which is why its sides are directed — audio in the left, modulation out the right. The drag alone
   * cannot say which of two legal, different cables was meant; the port can. See `NodeDefinition.ports`.
   */
  if ((from === 'osc' || from === 'fx') && to === 'sense') return 'audio'
  if (from === 'sense' && (to === 'osc' || to === 'fx')) return 'mod'

  /*
   * An FM node hears the same two things a SENSE does and reaches **only an oscillator**.
   *
   * Not an effect, and that is a rule rather than an omission: its one control is a deviation in cents
   * against a note, and an effect has no note. A comb resonator has a pitch and could in principle be
   * bent this way, which is a real sound and a different node's job — this one means one thing, and a
   * cable that meant it *sometimes* would be the invariant this file exists to protect, broken again.
   */
  if ((from === 'osc' || from === 'fx') && to === 'fm') return 'audio'
  if (from === 'fm' && to === 'osc') return 'mod'

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
  /*
   * Whether this pair is already joined by a cable of the same *sort*.
   *
   * By node pair rather than by handle pair, because a node has a side port at each end and reaching the
   * same destination from both would send it twice over.
   *
   * But the direction counts, and it was left out at first — which made the very first thing anybody
   * would try impossible. One Ignite and one oscillator, wired down from the bottom port and then up
   * from the top one, is two cables between the same pair that do entirely different things; refusing
   * the second as a duplicate is refusing the feature on its simplest patch. A descent and a climb are
   * not the same cable said twice.
   */
  const already = (from: string, to: string, climbing = false) =>
    rules.edges.some(
      (edge) => edge.source === from && edge.target === to && isClimbing(edge) === climbing,
    )

  if (sideStart) {
    /*
     * On a node whose sides are directed, which side a cable uses is not cosmetic: the left is where audio
     * comes in and the right is where modulation goes out. A cable that leaves by the input, or arrives at
     * the output, is refused rather than turned round — turning it round would be guessing at which of two
     * legal cables was meant, which is the thing the ports exist to stop.
     *
     * `null` handles pass: a patch code stores which nodes a cable joins and not which port, so the sides
     * are chosen on load from what the cable *is* (see `fromPatch`) rather than checked here.
     */
    if (
      (directedSides(typeOf(source)) && sourceHandle === SIGNAL_LEFT) ||
      (directedSides(typeOf(target)) && targetHandle === SIGNAL_RIGHT)
    ) {
      return null
    }

    const decided = orient(typeOf(source), typeOf(target))
    if (decided === null) return null

    /*
     * Which way the cable ends up, and what kind it is, resolved once before anything is returned.
     *
     * Two reasons a drag is turned round, and they are different:
     *
     * - **Only one direction exists.** A MOD only ever drives, an oscillator only ever feeds. `orient`
     *   answers `'reversed'` and the kind is read from the other direction.
     * - **Only one direction can carry anything.** Between two effects *both* are legal — that is the
     *   whole point of effects in series — so the drag decides. Except when the end it was drawn from is
     *   fed by nothing and the other end is fed: then there is exactly one reading under which the cable
     *   does something, and that is what was meant. Dragging from the new effect back to the one already
     *   in the chain is how a hand extends a chain, and refusing to understand it built a backwards chain
     *   that was silent and dark and looked broken.
     *
     * Only when it is unambiguous. Two effects both fed, or neither fed — which is what building a chain
     * from scratch looks like — keep the direction they were drawn in, because there is nothing to go on.
     * That distinction is why the first version of this rejected the whole idea: the objection was about
     * the ambiguous case and the rule is only for the unambiguous one.
     */
    const forwards = decided !== 'reversed'
    const kind = forwards ? decided : orient(typeOf(target), typeOf(source))
    if (kind === null || kind === 'reversed') return null

    let turned = !forwards
    if (kind === 'audio' && typeOf(source) === 'fx' && typeOf(target) === 'fx') {
      const fed = (id: string) =>
        rules.edges.some((edge) => edge.target === id && kindOf(edge) === 'audio')
      if (!fed(source) && fed(target)) turned = true
    }

    const from = turned ? target : source
    const to = turned ? source : target

    /*
     * An audio cable that would close a loop is refused outright, whichever way round it ended up. This is
     * the audio graph: a loop here is a gain feeding itself, not a finite re-triggering, so there is no cap
     * that saves it and nothing to be gained by allowing it (§45).
     */
    if (kind === 'audio' && wouldFeedBack(from, to, rules.edges)) return null
    if (already(from, to)) return null

    return {
      source: from,
      target: to,
      sourceHandle: turned ? targetHandle : sourceHandle,
      targetHandle: turned ? sourceHandle : targetHandle,
      kind,
    }
  }

  // Triggers run down the cascade: out of a bottom port and into a top one. Drawn the other way, it
  // is turned round rather than refused.
  /*
   * An upward cable leaves the Ignite's top port and lands on the **bottom** of what it fires, which is
   * the opposite end from every other trigger cable and the right one.
   *
   * A trigger enters a node at the end the wave is coming from. Descending, that is the top; climbing,
   * it is the bottom — and then the wave leaves through the top, into whatever is above. So a climb is
   * the whole picture mirrored, and drawing it into the top port would have the cable arriving at the
   * end the wave is meant to leave by. It was built that way first, on the argument that every trigger
   * should arrive at the same port; that argument is about the *port* and this one is about the *wave*,
   * and the wave is what somebody is reading when they look at the patch.
   *
   * Only nodes that declare the port may offer one, checked against the registry rather than the handle
   * name for the same reason the trigger ports are.
   */
  const climbing = sourceHandle === EVENT_UP && hasUpPort(typeOf(source))
  if (climbing) {
    return canTrigger(typeOf(source), typeOf(target)) &&
      (targetHandle === EVENT_OUT || targetHandle === null) &&
      !already(source, target, true)
      ? { source, target, sourceHandle, targetHandle, kind: 'event', up: true }
      : null
  }

  /*
   * The same cable dragged the other way — from the bottom of the node up to the Ignite's port, which is
   * the direction a hand takes when the wave in mind is going that way. Turned round rather than refused,
   * exactly as an ordinary trigger cable drawn backwards already is.
   */
  if (targetHandle === EVENT_UP && hasUpPort(typeOf(target)) && sourceHandle === EVENT_OUT) {
    return canTrigger(typeOf(target), typeOf(source)) && !already(target, source, true)
      ? {
          source: target,
          target: source,
          sourceHandle: targetHandle,
          targetHandle: sourceHandle,
          kind: 'event',
          up: true,
        }
      : null
  }

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
