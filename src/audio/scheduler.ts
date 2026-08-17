import { getDefinition } from '../nodes/registry'
import type { NodeId, Patch, PatchNode } from '../types/patch'
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
/** Firebreak: never process more than this many events in a single tick. */
const MAX_EVENTS_PER_TICK = 2000
/** How long a cable stays lit. */
const EDGE_FLASH = 0.2

export interface TriggerEvent {
  nodeId: NodeId
  time: number
  depth: number
  chainId: number
}

interface Chain {
  /** Triggers of this cascade still unprocessed. At zero, the cascade is done. */
  pending: number
  /** When the longest branch ends. */
  lastEnd: number
  startNodeId: NodeId
  startTime: number
}

interface SchedulerDeps {
  engine: Engine
  activity: ActivityBus
  getPatch: () => Patch
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
  private running = false
  private deps: SchedulerDeps

  constructor(deps: SchedulerDeps) {
    this.deps = deps
  }

  start(): void {
    if (this.running) return
    this.running = true
    const t0 = this.deps.engine.now() + START_OFFSET
    for (const node of this.deps.getPatch().nodes) {
      if (node.type === 'start') this.beginChain(node.id, t0)
    }
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.tick()
  }

  stop(): void {
    this.running = false
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
    for (const edge of patch.edges) {
      if (edge.kind !== 'event') continue
      const list = edgesBySource.get(edge.source)
      if (list) list.push({ id: edge.id, target: edge.target })
      else edgesBySource.set(edge.source, [{ id: edge.id, target: edge.target }])
    }

    let processed = 0
    while (this.queue.length > 0 && this.queue[0].time <= horizon) {
      if (++processed > MAX_EVENTS_PER_TICK) break
      const event = this.queue.shift() as TriggerEvent
      this.process(event, patch, nodeById, edgesBySource)
    }
  }

  private process(
    event: TriggerEvent,
    patch: Patch,
    nodeById: Map<NodeId, PatchNode>,
    edgesBySource: Map<NodeId, { id: string; target: NodeId }[]>,
  ): void {
    const chain = this.chains.get(event.chainId)
    if (chain) chain.pending--

    const node = nodeById.get(event.nodeId)
    const definition = node ? getDefinition(node.type) : undefined
    if (!node || !definition) {
      // The node was deleted while its trigger was in flight. The branch dies here.
      this.settle(event.chainId, patch)
      return
    }

    const result = definition.schedule({
      node,
      time: event.time,
      bpm: patch.bpm,
      engine: this.deps.engine,
      activity: this.deps.activity,
    })

    if (chain && result.endTime > chain.lastEnd) chain.lastEnd = result.endTime

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

    const next =
      chain.lastEnd > chain.startTime ? chain.lastEnd : chain.startTime + EMPTY_CHAIN_DELAY
    this.beginChain(chain.startNodeId, next)
  }

  private beginChain(startNodeId: NodeId, time: number): void {
    const chainId = this.nextChainId++
    this.chains.set(chainId, { pending: 0, lastEnd: time, startNodeId, startTime: time })
    this.enqueue({ nodeId: startNodeId, time, depth: 0, chainId })
  }

  private enqueue(event: TriggerEvent): void {
    const chain = this.chains.get(event.chainId)
    if (chain) chain.pending++
    let i = this.queue.length
    while (i > 0 && this.queue[i - 1].time > event.time) i--
    this.queue.splice(i, 0, event)
  }
}
