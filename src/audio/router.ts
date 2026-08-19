import type { FxParams, NodeId, Patch } from '../types/patch'

/**
 * Works out the smallest set of changes that takes the live audio graph to the one the patch
 * describes.
 *
 * It exists because the patch lives in a React store and the audio graph does not. Rebuilding the
 * graph on every store change would click and would cut the tail off any effect mid-decay, and
 * dragging a slider fires dozens of store changes a second. So this compares the two and emits
 * operations — and crucially it can tell "a number changed" from "the graph changed", so a slider
 * drag never rewires anything and moving a node emits nothing at all.
 *
 * A pure function over plain data, so the whole thing is testable without Web Audio.
 */

/** The audio-relevant projection of a patch. Position, steps, waveforms — none of it appears. */
export interface AudioGraph {
  /** Included because a synced effect's timing depends on it, so a tempo change has to reach one. */
  bpm: number
  /** FX node id → its parameters. */
  effects: Map<NodeId, FxParams>
  /**
   * Oscillator id → how much of it reaches the master without passing through an effect.
   *
   * Derived, not stored: an oscillator with no effects is heard whole, and one with effects is
   * heard through them, since each carries the dry across itself. That rule replaced a Direct
   * control which had to be set by hand and was wrong by default for six of the ten effects.
   */
  direct: Map<NodeId, number>
  /** `oscId>fxId`, one per send. */
  sends: Set<string>
}

export type RouterOp =
  | { op: 'createEffect'; id: NodeId; params: FxParams }
  | { op: 'replaceEffect'; id: NodeId; params: FxParams }
  | { op: 'updateEffect'; id: NodeId; params: FxParams }
  | { op: 'disposeEffect'; id: NodeId }
  | { op: 'connect'; from: NodeId; to: NodeId }
  | { op: 'disconnect'; from: NodeId; to: NodeId }
  | { op: 'setDirect'; id: NodeId; value: number }

export const EMPTY_GRAPH: AudioGraph = {
  bpm: 0,
  effects: new Map(),
  direct: new Map(),
  sends: new Set(),
}

export function sendKey(from: NodeId, to: NodeId): string {
  return `${from}>${to}`
}

function splitSend(key: string): { from: NodeId; to: NodeId } {
  const [from, to] = key.split('>')
  return { from, to }
}

/**
 * Audio cables only ever run from an oscillator to an FX node, so anything else in the patch is
 * dropped here rather than guarded against downstream.
 */
export function graphOf(patch: Patch): AudioGraph {
  const effects = new Map<NodeId, FxParams>()
  const oscillators = new Set<NodeId>()

  for (const node of patch.nodes) {
    if (node.type === 'fx') effects.set(node.id, node.params as FxParams)
    else if (node.type === 'osc') oscillators.add(node.id)
  }

  const sends = new Set<string>()
  const sending = new Set<NodeId>()
  for (const edge of patch.edges) {
    if (edge.kind !== 'audio') continue
    if (!oscillators.has(edge.source) || !effects.has(edge.target)) continue
    sends.add(sendKey(edge.source, edge.target))
    sending.add(edge.source)
  }

  const direct = new Map<NodeId, number>()
  for (const id of oscillators) direct.set(id, sending.has(id) ? 0 : 1)

  return { bpm: patch.bpm, effects, direct, sends }
}

function sameParams(a: FxParams, b: FxParams): boolean {
  const keys = Object.keys(a) as (keyof FxParams)[]
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => a[key] === b[key])
}

/**
 * Order matters and is the reason this returns a list rather than applying as it goes:
 *
 *  1. disconnect and dispose first, so nothing is left feeding a node about to vanish;
 *  2. create next, so a connection always has both ends;
 *  3. connect;
 *  4. parameter changes last, since they depend on nothing.
 */
export function diff(previous: AudioGraph, next: AudioGraph): RouterOp[] {
  const removals: RouterOp[] = []
  const additions: RouterOp[] = []
  const updates: RouterOp[] = []

  for (const key of previous.sends) {
    if (!next.sends.has(key)) removals.push({ op: 'disconnect', ...splitSend(key) })
  }

  for (const [id] of previous.effects) {
    if (!next.effects.has(id)) removals.push({ op: 'disposeEffect', id })
  }

  // A tempo change has to reach every effect: an echo's delay time is derived from it, and there
  // is no other signal that would tell the chain to recalculate.
  const retimed = previous.bpm !== next.bpm

  for (const [id, params] of next.effects) {
    const before = previous.effects.get(id)
    if (!before) {
      additions.push({ op: 'createEffect', id, params })
    } else if (before.effect !== params.effect) {
      // The node's input and output survive, so this rebuilds the middle and leaves every cable
      // attached to it exactly where it was.
      updates.push({ op: 'replaceEffect', id, params })
    } else if (retimed || !sameParams(before, params)) {
      updates.push({ op: 'updateEffect', id, params })
    }
  }

  for (const key of next.sends) {
    if (!previous.sends.has(key)) additions.push({ op: 'connect', ...splitSend(key) })
  }

  for (const [id, value] of next.direct) {
    if (previous.direct.get(id) !== value) updates.push({ op: 'setDirect', id, value })
  }

  return [...removals, ...additions, ...updates]
}
