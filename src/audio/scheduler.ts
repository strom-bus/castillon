import { getDefinition, shiftsOn, stepsOf } from '../nodes/registry'
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

export interface TriggerEvent {
  nodeId: NodeId
  time: number
  depth: number
  chainId: number
  /**
   * What every TRANSFORM above this point adds up to, carried down the branch.
   *
   * Alongside the depth and for the same reason: it is a fact about the path taken to get here rather
   * than about the node that arrived, so it travels with the trigger. Which ones rather than how much,
   * since a patch may loop back on itself and a total would add the same transform on every lap.
   */
  shifts: readonly NodeId[]
}

interface Chain {
  /** Triggers of this cascade still unprocessed. At zero, the cascade is done. */
  pending: number
  /** When the longest branch ends. */
  lastEnd: number
  startNodeId: NodeId
  startTime: number
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
    const edgesBySource = new Map<NodeId, { id: string; target: NodeId }[]>()
    const fxBySource = new Map<NodeId, NodeId[]>()
    for (const edge of patch.edges) {
      if (edge.kind === 'event') {
        const list = edgesBySource.get(edge.source)
        if (list) list.push({ id: edge.id, target: edge.target })
        else edgesBySource.set(edge.source, [{ id: edge.id, target: edge.target }])
      } else if (edge.kind === 'audio') {
        const list = fxBySource.get(edge.source)
        if (list) list.push(edge.target)
        else fxBySource.set(edge.source, [edge.target])
      }
    }

    let processed = 0
    while (this.queue.length > 0 && this.queue[0].time <= horizon) {
      if (++processed > (this.deps.maxEventsPerDrain ?? MAX_EVENTS_PER_TICK)) break
      const event = this.queue.shift() as TriggerEvent
      this.process(event, patch, nodeById, edgesBySource, fxBySource)
    }
  }

  private process(
    event: TriggerEvent,
    patch: Patch,
    nodeById: Map<NodeId, PatchNode>,
    edgesBySource: Map<NodeId, { id: string; target: NodeId }[]>,
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

    const carried = shiftsOn(patch.edges, node.id, event.shifts)

    const result = definition.schedule({
      node,
      time: event.time,
      bpm: patch.bpm,
      engine: this.deps.engine,
      activity: this.deps.activity,
      /*
       * What arrived, plus whatever is hanging on this node.
       *
       * Read here rather than carried out of a node's own schedule, because a transform is attached to a
       * node instead of standing between two — so there is no moment at which it runs, only a node that
       * has one on it. Added, so two on the same node stack and so do one up the branch and one down it.
       */
      transpose: stepsOf(patch.nodes, carried),
    })

    if (chain && result.endTime > chain.lastEnd) chain.lastEnd = result.endTime

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
      const children = edgesBySource.get(node.id)
      if (children) {
        for (const edge of children) {
          for (const at of result.outgoing) {
            this.deps.activity.push({ kind: 'edge', id: edge.id, time: at, duration: EDGE_FLASH })
            this.enqueue({
              nodeId: edge.target,
              time: at,
              depth: event.depth + 1,
              chainId: event.chainId,
              shifts: carried,
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

    const next =
      chain.lastEnd > chain.startTime ? chain.lastEnd : chain.startTime + EMPTY_CHAIN_DELAY
    this.beginChain(chain.startNodeId, next)
  }

  private beginChain(startNodeId: NodeId, time: number): void {
    const chainId = this.nextChainId++
    this.chains.set(chainId, { pending: 0, lastEnd: time, startNodeId, startTime: time })
    // A cascade begins in the key it was written in; only a TRANSFORM in the branch moves it.
    this.enqueue({ nodeId: startNodeId, time, depth: 0, chainId, shifts: [] })
  }

  private enqueue(event: TriggerEvent): void {
    const chain = this.chains.get(event.chainId)
    if (chain) chain.pending++
    let i = this.queue.length
    while (i > 0 && this.queue[i - 1].time > event.time) i--
    this.queue.splice(i, 0, event)
  }
}
