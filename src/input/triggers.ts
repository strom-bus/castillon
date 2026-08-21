/**
 * Where a press comes from, and what an Ignite does with one.
 *
 * The whole point of this module is that **an Ignite must not know it was a keyboard** (PLAN §17.3).
 * A source emits `press` and `release` against an identity; this decides which Ignites answer to that
 * identity and what each of them does about it.
 *
 * That is not a convenience — it is the shape MIDI already has. Note-on and note-off *are* press and
 * release, so `hold` needs both and `toggle` listens to the press alone. Adding MIDI later is a
 * second source calling the same two functions, and nothing here changes.
 */
import { bindingKey, type Patch, type StartParams } from '../types/patch'

export interface Firing {
  /** Begin this Ignite's cascade now. */
  fire(nodeId: string): void
  /** Stop it, in flight. */
  release(nodeId: string): void
  /** Whether it is currently sounding, which is what a toggle needs. */
  isFiring(nodeId: string): boolean
}

/** The bound Ignites answering to an identity. Several may: one key launching many cascades is a feature. */
export function ignitesFor(patch: Patch, identity: string): { id: string; params: StartParams }[] {
  return patch.nodes
    .filter((node) => node.type === 'start')
    .map((node) => ({ id: node.id, params: node.params as StartParams }))
    .filter(
      (node) => node.params.trigger === 'bound' && bindingKey(node.params.binding) === identity,
    )
}

/**
 * A press arrived.
 *
 * `hold` starts and keeps going while down. `toggle` asks what it is doing and does the other thing,
 * which is why the scheduler has to be able to answer that question.
 */
export function press(patch: Patch, identity: string, firing: Firing): void {
  for (const ignite of ignitesFor(patch, identity)) {
    if (ignite.params.behaviour === 'toggle') {
      if (firing.isFiring(ignite.id)) firing.release(ignite.id)
      else firing.fire(ignite.id)
    } else {
      firing.fire(ignite.id)
    }
  }
}

/** A release arrived. Only `hold` cares: a toggle is waiting for the next press, not for this. */
export function release(patch: Patch, identity: string, firing: Firing): void {
  for (const ignite of ignitesFor(patch, identity)) {
    if (ignite.params.behaviour !== 'toggle') firing.release(ignite.id)
  }
}
