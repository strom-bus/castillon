/**
 * Queue of visual events, decoupled from both the audio and the React store.
 *
 * The scheduler queues audio up to 100 ms ahead; if the UI reacted at that moment the flash
 * would run ahead of the sound. So visual events are queued with their timestamp and dispatched
 * from `requestAnimationFrame` once the audio clock catches up to them.
 */

export type ActivityEvent =
  | { kind: 'node'; id: string; time: number; duration: number }
  | { kind: 'step'; id: string; step: number; time: number; duration: number }
  /**
   * A trigger crossing a cable.
   *
   * `up` is which way it crossed, not which kind of cable it is — the same cable carries a descent and a
   * climb in any patch wired from both of the Ignite's ports, so the direction belongs to the trigger.
   * The canvas animates the pulse along it, and a pulse running the wrong way says the opposite of what
   * happened.
   */
  | { kind: 'edge'; id: string; time: number; duration: number; up?: boolean }

type Listener = (event: ActivityEvent) => void

export const nodeKey = (id: string) => `node:${id}`
export const edgeKey = (id: string) => `edge:${id}`

export class ActivityBus {
  private queue: ActivityEvent[] = []
  private listeners = new Map<string, Set<Listener>>()
  private frame: number | null = null
  private clock: () => number

  constructor(clock: () => number) {
    this.clock = clock
  }

  push(event: ActivityEvent): void {
    this.queue.push(event)
  }

  clear(): void {
    this.queue.length = 0
  }

  subscribe(key: string, listener: Listener): () => void {
    let set = this.listeners.get(key)
    if (!set) {
      set = new Set()
      this.listeners.set(key, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(key)
    }
  }

  start(): void {
    if (this.frame !== null) return
    const loop = () => {
      this.drain()
      this.frame = requestAnimationFrame(loop)
    }
    this.frame = requestAnimationFrame(loop)
  }

  stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
  }

  private drain(): void {
    const now = this.clock()
    let i = 0
    while (i < this.queue.length) {
      const event = this.queue[i]
      if (event.time <= now) {
        this.queue.splice(i, 1)
        this.dispatch(event)
      } else {
        i++
      }
    }
  }

  private dispatch(event: ActivityEvent): void {
    const key = event.kind === 'edge' ? edgeKey(event.id) : nodeKey(event.id)
    const set = this.listeners.get(key)
    if (!set) return
    for (const listener of set) listener(event)
  }
}
