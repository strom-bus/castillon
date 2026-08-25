import { getDefinition, warpingOf, warpsOn } from '../nodes/registry'
import type { NodeId, Patch, PatchNode, StartParams } from '../types/patch'
import type { ActivityBus } from '../viz/activity'
import type { Engine } from './engine'

/** How far ahead of the audio clock work is scheduled. */
export const LOOKAHEAD = 0.1
/** How often the scheduler wakes up. */
export const TICK_MS = 25
/** Chain depth cap; it is also what breaks cycles. */
export const MAX_DEPTH = 16
/** Margin before the first event, so nothing is scheduled in the past. */
const START_OFFSET = 0.06
/**
 * Only a cascade of genuinely zero length gets held back, and only far enough that the loop
 * cannot run away — an Ignite with no children completes instantly and would otherwise restart
 * forever inside a single tick.
 *
 * Because it now applies only to zero-length chains, it can stay generous. As a blanket floor
 * it could not: at 300 BPM four 1/16 steps last 200 ms, so it was quietly stretching every
 * loop faster than a quarter second.
 */
const EMPTY_CHAIN_DELAY = 0.25
/**
 * Firebreak: never process more than this many events in a single tick.
 *
 * Sized for a 25 ms tick with a 100 ms horizon. An offline render schedules a whole piece in one
 * call, so it raises this rather than being silently truncated at two thousand events.
 */
export const MAX_EVENTS_PER_TICK = 2000
/** How long a cable stays lit. */
const EDGE_FLASH = 0.2
/** Fallback flash for an effect fed by a node with no duration of its own. */
const FX_FLASH = 0.12

/** One rung of the traversal: the cable, where it leads, and whether it switches the wave upward. */
interface Step {
  id: string
  target: NodeId
  up: boolean
}

export interface TriggerEvent {
  nodeId: NodeId
  time: number
  depth: number
  chainId: number
  /**
   * What every WARP above this point adds up to, carried down the branch.
   *
   * Alongside the depth and for the same reason: it is a fact about the path taken to get here rather
   * than about the node that arrived, so it travels with the trigger. Which ones rather than how much,
   * since a patch may loop back on itself and a total would add the same transform on every lap.
   */
  shifts: readonly NodeId[]
  /**
   * Whether this trigger is climbing rather than descending.
   *
   * Alongside the depth and the warp set, and for the same reason: it is a fact about the path taken to
   * get here rather than about the node that arrived. A node has no idea which way the wave is going and
   * should not need one — it plays its sequence and says it has finished, and the chain decides where
   * "next" is.
   *
   * Both directions live in **one** chain, so a pass ends when both waves have drained and its length is
   * the longer of the two. That needs no new logic anywhere, which is most of the argument for doing it
   * this way.
   */
  up: boolean
}

interface Chain {
  /** Triggers of this cascade still unprocessed. At zero, the cascade is done. */
  pending: number
  /** When the longest branch ends. */
  lastEnd: number
  startNodeId: NodeId
  startTime: number
  /**
   * Which time round this is, counting from one.
   *
   * The cascade has no bar, so this is the only sense in which anything here recurs: a pass is one run of
   * a chain, and the next pass is the same chain begun again. Counting it is what lets a node decide to
   * happen on some passes and not others — which is the whole of trig conditions, and alternation falls
   * out of two nodes disagreeing about which passes are theirs.
   *
   * Each pass gets a fresh `chainId`, so the count has to be handed on at `settle` rather than kept
   * against the id.
   */
  lap: number
  /**
   * How long the pass before this one lasted, and the floor under this one.
   *
   * **A pass must not get shorter because part of it did not happen.** A SIEVE that blocks costs its
   * branch nothing, so a cascade whose only branch is withheld has nothing left to wait for: the pass
   * ends at once and comes round again immediately, and a branch set to every other pass fires at
   * irregular intervals instead of alternating. Which is the opposite of what was asked for.
   *
   * The previous lap rather than the longest ever seen, so a patch that is genuinely shortened settles
   * within two passes instead of holding an old period for ever.
   *
   * And it applies only where something was actually withheld, which `withheld` below records. A pass
   * that is short because it *is* short — an odd-length sequence under a swing, whose two passes are
   * legitimately different lengths — must be left alone, or the floor pads it with silence and the very
   * thing it was carrying across the loop is broken.
   */
  previousLength: number
  /** Whether a SIEVE kept something from happening this pass. */
  withheld: boolean
}

/** Whether this node waits for an input rather than for the transport. */
function isBound(node: PatchNode): boolean {
  return node.type === 'start' && (node.params as StartParams).trigger === 'bound'
}

interface SchedulerDeps {
  engine: Engine
  activity: ActivityBus
  getPatch: () => Patch
  /** Raised by the offline render, which drains a whole piece in a single call. */
  maxEventsPerDrain?: number
}

/**
 * Propagates triggers through the event graph.
 *
 * It always runs ahead of the audio clock, so it notices a cascade has drained roughly 100 ms
 * before its last note sounds. That margin is exactly what lets the Start be rescheduled in
 * time, so the loop has no audible gap on each pass.
 */
export class CascadeScheduler {
  /** Sorted by ascending `time`. */
  private queue: TriggerEvent[] = []
  private chains = new Map<number, Chain>()
  /**
   * Triggers that have reached each node since the transport started.
   *
   * Across passes rather than per chain, because a divider does not begin again every bar — and there is
   * no bar here to begin again at. Cleared when the transport restarts, which is the only moment the
   * count means anything different.
   */
  private arrivals = new Map<NodeId, number>()
  private nextChainId = 1
  private timer: ReturnType<typeof setInterval> | null = null
  /** Bound Ignites currently sounding. A press on one already in this set is auto-repeat, not a note. */
  private holding = new Set<NodeId>()
  private running = false
  private deps: SchedulerDeps

  constructor(deps: SchedulerDeps) {
    this.deps = deps
  }

  /**
   * Starts the tick without seeding anything.
   *
   * Ticking and playing are not the same thing, and a bound Ignite is why: pressing its key has to
   * sound its own cascade without starting every automatic one alongside it (§17.1).
   */
  private activate(): void {
    this.running = true
    if (this.timer === null) {
      this.timer = setInterval(() => this.tick(), TICK_MS)
    }
  }

  start(): void {
    if (this.running) return
    this.activate()
    // Counted from the transport, so pressing Play twice gives the same patch twice rather than
    // continuing a count nobody can see.
    this.arrivals.clear()
    const t0 = this.deps.engine.now() + START_OFFSET
    for (const node of this.deps.getPatch().nodes) {
      // A bound Ignite waits for its input and is not seeded by the transport, which is the point of
      // binding it (PLAN §17.1).
      if (node.type === 'start' && !isBound(node)) this.beginChain(node.id, t0)
    }
    this.tick()
  }

  /** Whether triggers are being propagated, so callers need not track it themselves. */
  get active(): boolean {
    return this.running
  }

  /**
   * Throws away everything in flight and seeds the cascade again from the patch as it stands now.
   *
   * Needed because replacing the whole patch — rolling the die, pasting a code, resetting — leaves
   * the scheduler holding chains whose Start nodes no longer exist. `settle` refuses to re-loop a
   * chain whose Start has gone, correctly, so those chains simply stop; and nothing was ever seeding
   * the *new* patch's Starts. The result was a cascade that faded out and never came back while the
   * transport still claimed to be playing.
   */
  restart(): void {
    if (!this.running) return
    this.queue.length = 0
    this.chains.clear()
    this.arrivals.clear()
    const t0 = this.deps.engine.now() + START_OFFSET
    for (const node of this.deps.getPatch().nodes) {
      if (node.type === 'start' && !isBound(node)) this.beginChain(node.id, t0)
    }
  }

  /**
   * Fires one Ignite now, whatever the transport is doing.
   *
   * How a bound Ignite plays (§17.1). Immediate rather than quantised to the grid: a key that answers
   * on the next beat is not an instrument, and a cascade started off the grid drifting against the
   * automatic ones is the same polyrhythm the whole design is built on.
   *
   * Already running is left alone, so holding a key down through the browser's auto-repeat does not
   * stack a cascade on top of itself.
   */
  fire(startNodeId: NodeId): void {
    if (this.holding.has(startNodeId)) return
    // A key works with the transport stopped, so firing starts the tick if nothing else has.
    this.activate()
    this.holding.add(startNodeId)
    this.beginChain(startNodeId, this.deps.engine.now() + START_OFFSET)
    // Straight away rather than on the next tick, so a key press sounds when it is pressed.
    this.tick()
  }

  /**
   * Stops one Ignite's cascade, in flight.
   *
   * The new capability §17.2 called for: auto cascades only ever end by draining, and `stop()` clears
   * everything. This drops the queued events belonging to that Ignite's chains, releases the voices
   * its nodes are holding, and leaves every other cascade untouched.
   */
  release(startNodeId: NodeId): void {
    this.holding.delete(startNodeId)

    const mine = new Set<number>()
    for (const [id, chain] of this.chains) {
      if (chain.startNodeId === startNodeId) mine.add(id)
    }
    if (mine.size === 0) return

    // Voices are released rather than cut: the note's own release time turns a stopped cascade into a
    // fade instead of a click.
    //
    // Everything downstream of the Ignite, not the nodes still in the queue. A node that is *already
    // sounding* has had its event consumed and left the queue, so reading the queue released only the
    // nodes that had not made a sound yet — precisely backwards.
    const at = this.deps.engine.now()
    for (const nodeId of this.downstreamOf(startNodeId)) {
      this.deps.engine.releaseNodeVoices(nodeId, at)
    }

    this.queue = this.queue.filter((event) => !mine.has(event.chainId))
    for (const id of mine) this.chains.delete(id)
    this.deps.activity.clear()
  }

  /**
   * Every node an Ignite can reach through event cables, itself included.
   *
   * Depth-capped by the same `MAX_DEPTH` the cascade uses, which is also what stops a cycle here.
   */
  private downstreamOf(startNodeId: NodeId): Set<NodeId> {
    const patch = this.deps.getPatch()
    const children = new Map<NodeId, NodeId[]>()
    for (const edge of patch.edges) {
      if (edge.kind !== 'event') continue
      const list = children.get(edge.source)
      if (list) list.push(edge.target)
      else children.set(edge.source, [edge.target])
    }

    const found = new Set<NodeId>([startNodeId])
    let frontier = [startNodeId]
    for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
      const next: NodeId[] = []
      for (const id of frontier) {
        for (const child of children.get(id) ?? []) {
          if (found.has(child)) continue
          found.add(child)
          next.push(child)
        }
      }
      frontier = next
    }
    return found
  }

  /** Whether this Ignite is currently sounding, which is what a toggle needs to know. */
  isFiring(startNodeId: NodeId): boolean {
    return this.holding.has(startNodeId)
  }

  stop(): void {
    this.running = false
    this.holding.clear()
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.queue.length = 0
    this.chains.clear()
  }

  tick(): void {
    this.drain(this.deps.engine.now() + LOOKAHEAD)
  }

  /** Processes everything inside the horizon. Public so it can be tested without clocks. */
  drain(horizon: number): void {
    const patch = this.deps.getPatch()
    const nodeById = new Map<NodeId, PatchNode>(patch.nodes.map((n) => [n.id, n]))
    const edgesBySource = new Map<NodeId, Step[]>()
    /*
     * The same cables indexed the other way, for a wave that is climbing.
     *
     * Upward cables are left out of it on purpose. One of those is how a climbing wave *starts*, not a
     * rung it can use — followed backwards it would take the wave straight to the IGNITE it came from,
     * firing it a second time and flashing the cable the wrong way.
     */
    const edgesByTarget = new Map<NodeId, Step[]>()
    const fxBySource = new Map<NodeId, NodeId[]>()
    for (const edge of patch.edges) {
      if (edge.kind === 'event') {
        const down = { id: edge.id, target: edge.target, up: edge.up === true }
        const list = edgesBySource.get(edge.source)
        if (list) list.push(down)
        else edgesBySource.set(edge.source, [down])

        if (!down.up) {
          const climbing = { id: edge.id, target: edge.source, up: false }
          const above = edgesByTarget.get(edge.target)
          if (above) above.push(climbing)
          else edgesByTarget.set(edge.target, [climbing])
        }
      } else if (edge.kind === 'audio') {
        const list = fxBySource.get(edge.source)
        if (list) list.push(edge.target)
        else fxBySource.set(edge.source, [edge.target])
      }
    }

    /*
     * Every effect a node reaches, not only the ones it is cabled straight to.
     *
     * Effects go in series now, so an oscillator's sound passes through a whole chain — and the flash has
     * to follow it. Built as one hop before series existed, which meant the *second* effect in a chain
     * never lit at all: it was carrying the sound and looked as dead as a node wired to nothing, which
     * from the outside is indistinguishable from it not working.
     *
     * `seen` per source rather than a global visited set, since two oscillators can share a chain and
     * both must light it. It also stops a loop — the router drops looping cables and the rules refuse to
     * draw them, but this map is built from the raw edges and cannot assume either has run.
     */
    const reaches = new Map<NodeId, NodeId[]>()
    for (const source of fxBySource.keys()) {
      const found: NodeId[] = []
      const seen = new Set<NodeId>()
      const queue = [...(fxBySource.get(source) ?? [])]
      while (queue.length > 0) {
        const id = queue.shift() as NodeId
        if (seen.has(id)) continue
        seen.add(id)
        found.push(id)
        for (const next of fxBySource.get(id) ?? []) queue.push(next)
      }
      reaches.set(source, found)
    }

    let processed = 0
    while (this.queue.length > 0 && this.queue[0].time <= horizon) {
      if (++processed > (this.deps.maxEventsPerDrain ?? MAX_EVENTS_PER_TICK)) break
      const event = this.queue.shift() as TriggerEvent
      this.process(event, patch, nodeById, edgesBySource, edgesByTarget, reaches)
    }
  }

  private process(
    event: TriggerEvent,
    patch: Patch,
    nodeById: Map<NodeId, PatchNode>,
    edgesBySource: Map<NodeId, Step[]>,
    edgesByTarget: Map<NodeId, Step[]>,
    fxBySource: Map<NodeId, NodeId[]>,
  ): void {
    const chain = this.chains.get(event.chainId)
    if (chain) chain.pending--

    const node = nodeById.get(event.nodeId)
    const definition = node ? getDefinition(node.type) : undefined
    if (!node || !definition?.schedule) {
      // Either the node was deleted while its trigger was in flight, or it is an audio-only node
      // that nothing should have been able to trigger. Either way the branch dies here.
      this.settle(event.chainId, patch)
      return
    }

    const carried = warpsOn(patch.edges, node.id, event.shifts)

    /*
     * How many triggers have reached this node, counting from one.
     *
     * Kept per node and across passes rather than per chain, because that is what makes it useful: a
     * divider does not start over every bar, and there is no bar here to start over at. It runs for as
     * long as the transport does and is cleared when that restarts.
     *
     * Counted for every node whether or not it cares — one map write per trigger, against a branch that
     * would have to know which node types read it, which is the sort of second place a rule goes to rot.
     */
    const arrival = (this.arrivals.get(node.id) ?? 0) + 1
    this.arrivals.set(node.id, arrival)

    const result = definition.schedule({
      node,
      time: event.time,
      bpm: patch.bpm,
      // Which pass this is. A node that only happens on some of them needs to know; every other node
      // ignores it, which is why it is handed down rather than asked for.
      lap: this.chains.get(event.chainId)?.lap ?? 1,
      arrival,
      engine: this.deps.engine,
      activity: this.deps.activity,
      /*
       * What arrived, plus whatever is hanging on this node.
       *
       * Read here rather than carried out of a node's own schedule, because a transform is attached to a
       * node instead of standing between two — so there is no moment at which it runs, only a node that
       * has one on it. Added, so two on the same node stack and so do one up the branch and one down it.
       */
      warping: warpingOf(patch.nodes, carried),
    })

    if (chain && result.endTime > chain.lastEnd) chain.lastEnd = result.endTime
    // Remembered for `settle`: a pass cut short by a withheld trigger keeps the cycle's length, and one
    // that is simply shorter does not.
    if (chain && result.withheld) chain.withheld = true

    // Effects light up with whatever is feeding them. This belongs here rather than in the node
    // definition, which has no idea what is wired to it — and that is what keeps effects cheap to
    // add.
    for (const fxId of fxBySource.get(node.id) ?? []) {
      this.deps.activity.push({
        kind: 'node',
        id: fxId,
        time: event.time,
        duration: result.endTime - event.time || FX_FLASH,
      })
    }

    if (event.depth < MAX_DEPTH) {
      // Down the cascade, or up it. Which one is a fact about this trigger, not about this node.
      const onward = event.up ? edgesByTarget.get(node.id) : edgesBySource.get(node.id)
      if (onward) {
        for (const edge of onward) {
          for (const at of result.outgoing) {
            this.deps.activity.push({
              kind: 'edge',
              id: edge.id,
              time: at,
              duration: EDGE_FLASH,
              /*
               * Which way the trigger crossed, which is not the same as which kind of cable it is. A
               * climb crosses ordinary cables from their target to their source, so its pulse has to run
               * backwards along them; the upward cable that *starts* a climb is crossed the ordinary way,
               * source to target, so it does not. Hence `event.up` and not `edge.up`.
               */
              up: event.up || undefined,
            })
            this.enqueue({
              nodeId: edge.target,
              time: at,
              depth: event.depth + 1,
              chainId: event.chainId,
              shifts: carried,
              /*
               * An upward cable switches the wave; anything else keeps it going the way it was. Which
               * means the flag only ever does something when read *forward*, and a climbing wave — whose
               * index has none of them in it — simply stays climbing.
               */
              up: event.up || edge.up,
            })
          }
        }
      }
    }

    this.settle(event.chainId, patch)
  }

  /** If the cascade has drained, closes it and — when appropriate — fires it again. */
  private settle(chainId: number, patch: Patch): void {
    const chain = this.chains.get(chainId)
    if (!chain || chain.pending > 0) return

    this.chains.delete(chainId)
    if (!this.running || !patch.loop) return
    if (!patch.nodes.some((n) => n.id === chain.startNodeId)) return
    // A bound Ignite loops for as long as it is held and not a moment longer. Without this a released
    // key would come round again, which is the opposite of releasing it.
    const node = patch.nodes.find((n) => n.id === chain.startNodeId)
    if (node && isBound(node) && !this.holding.has(chain.startNodeId)) return

    /*
     * Never shorter than the pass before it.
     *
     * With nothing conditional in a patch this changes nothing: every pass is the same length, so the
     * floor is the length. It matters only where a branch decided not to happen, which is exactly where
     * the cascade would otherwise race — and a cycle that speeds up whenever something is skipped is not
     * a cycle anybody can play against.
     */
    const own = chain.lastEnd - chain.startTime
    const floor = chain.withheld ? chain.previousLength : 0
    const length = Math.max(own, floor, own > 0 ? 0 : EMPTY_CHAIN_DELAY)
    this.beginChain(chain.startNodeId, chain.startTime + length, chain.lap + 1, length)
  }

  private beginChain(startNodeId: NodeId, time: number, lap = 1, previousLength = 0): void {
    const chainId = this.nextChainId++
    this.chains.set(chainId, {
      pending: 0,
      lastEnd: time,
      startNodeId,
      startTime: time,
      lap,
      previousLength,
      withheld: false,
    })
    // A cascade begins in the key it was written in; only a WARP in the branch moves it.
    this.enqueue({ nodeId: startNodeId, time, depth: 0, chainId, shifts: [], up: false })
  }

  private enqueue(event: TriggerEvent): void {
    const chain = this.chains.get(event.chainId)
    if (chain) chain.pending++
    let i = this.queue.length
    while (i > 0 && this.queue[i - 1].time > event.time) i--
    this.queue.splice(i, 0, event)
  }
}
