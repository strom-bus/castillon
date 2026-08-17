import { getDefinition } from '../nodes/registry'
import type { NodeId, Patch, PatchNode } from '../types/patch'
import type { ActivityBus } from '../viz/activity'
import type { Engine } from './engine'

/** Cuánto se programa por delante del reloj de audio. */
export const LOOKAHEAD = 0.1
/** Cada cuánto despierta el scheduler. */
export const TICK_MS = 25
/** Tope de profundidad de una cadena; también es lo que corta los ciclos. */
export const MAX_DEPTH = 16
/** Margen antes del primer evento, para no programar en el pasado. */
const START_OFFSET = 0.06
/**
 * Una cascada no puede repetirse más rápido que esto. Sin este mínimo, un Start sin hijos
 * completa su cadena en duración cero y el loop se convierte en un bucle infinito.
 */
const MIN_CHAIN_DURATION = 0.25
/** Cortafuegos: nunca procesar más de estos eventos en un solo tick. */
const MAX_EVENTS_PER_TICK = 2000
/** Duración del destello de un cable. */
const EDGE_FLASH = 0.2

export interface TriggerEvent {
  nodeId: NodeId
  time: number
  depth: number
  chainId: number
}

interface Chain {
  /** Triggers de esta cascada aún sin procesar. Al llegar a cero, la cascada ha terminado. */
  pending: number
  /** Instante en que termina la rama más larga. */
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
 * Propaga triggers por el grafo de eventos (PLAN.md §2).
 *
 * Trabaja siempre por delante del reloj de audio, así que detecta que una cascada se ha
 * vaciado ~100 ms antes de que suene su última nota. Ese margen es justo lo que permite
 * reprogramar el Start a tiempo y que el loop no tenga un hueco audible en cada vuelta.
 */
export class CascadeScheduler {
  /** Ordenada por `time` ascendente. */
  private queue: TriggerEvent[] = []
  private chains = new Map<number, Chain>()
  private nextChainId = 1
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private deps: SchedulerDeps

  constructor(deps: SchedulerDeps) {
    this.deps = deps
  }

  get isRunning(): boolean {
    return this.running
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

  /** Procesa todo lo que caiga dentro del horizonte. Público para poder probarlo sin relojes. */
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
      // El nodo se borró mientras su trigger viajaba. La rama muere aquí.
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

  /** Si la cascada se ha vaciado, la cierra y —si toca— la vuelve a lanzar. */
  private settle(chainId: number, patch: Patch): void {
    const chain = this.chains.get(chainId)
    if (!chain || chain.pending > 0) return

    this.chains.delete(chainId)
    if (!this.running || !patch.loop) return
    if (!patch.nodes.some((n) => n.id === chain.startNodeId)) return

    const next = Math.max(chain.lastEnd, chain.startTime + MIN_CHAIN_DURATION)
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
