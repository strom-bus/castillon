import { resolveTarget, type ModTargetKey } from './modulation'
import type { FxParams, ModParams, NodeId, Patch } from '../types/patch'

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
  /** MOD node id → its parameters. */
  modulators: Map<NodeId, ModParams>
  /**
   * `modId>targetId`, one per modulation cable, with the target it resolved to.
   *
   * The target is resolved here rather than in the engine because it depends on what the cable landed
   * on: a MOD set to Mix and wired to an oscillator has to fall back, and that is a decision about
   * the patch rather than about Web Audio (PLAN §18.4).
   */
  mods: Map<string, { target: ModTargetKey; depth: number }>
}

export type RouterOp =
  | { op: 'createEffect'; id: NodeId; params: FxParams }
  | { op: 'replaceEffect'; id: NodeId; params: FxParams }
  | { op: 'updateEffect'; id: NodeId; params: FxParams }
  | { op: 'disposeEffect'; id: NodeId }
  | { op: 'connect'; from: NodeId; to: NodeId }
  | { op: 'disconnect'; from: NodeId; to: NodeId }
  | { op: 'setDirect'; id: NodeId; value: number }
  | { op: 'createMod'; id: NodeId; params: ModParams }
  | { op: 'updateMod'; id: NodeId; params: ModParams }
  | { op: 'disposeMod'; id: NodeId }
  | { op: 'connectMod'; from: NodeId; to: NodeId; target: ModTargetKey; depth: number }
  | { op: 'disconnectMod'; from: NodeId; to: NodeId }

export const EMPTY_GRAPH: AudioGraph = {
  bpm: 0,
  effects: new Map(),
  direct: new Map(),
  sends: new Set(),
  modulators: new Map(),
  mods: new Map(),
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

  const modulators = new Map<NodeId, ModParams>()
  for (const node of patch.nodes) {
    if (node.type === 'mod') modulators.set(node.id, node.params as ModParams)
  }

  const mods = new Map<string, { target: ModTargetKey; depth: number }>()
  for (const edge of patch.edges) {
    if (edge.kind !== 'mod') continue
    const params = modulators.get(edge.source)
    if (!params) continue
    const destination = effects.has(edge.target)
      ? 'fx'
      : oscillators.has(edge.target)
        ? 'osc'
        : undefined
    // The effect matters as much as the node type: which parameters exist depends on which effect it
    // is, so a MOD on a reverb resolves against a reverb's list (§18.4).
    const target = resolveTarget(params.target, destination, effects.get(edge.target)?.effect)
    if (!target) continue
    // Depth rides along because it is scaled to the target: the same 0.6 is half a hertz on one
    // parameter and thousands on another, so a change to either has to re-connect.
    mods.set(sendKey(edge.source, edge.target), { target, depth: params.depth ?? 0.6 })
  }

  return { bpm: patch.bpm, effects, direct, sends, modulators, mods }
}

function sameMod(a: ModParams, b: ModParams): boolean {
  return (
    a.kind === b.kind &&
    a.wave === b.wave &&
    a.rate === b.rate &&
    // Depth and target are not compared here: both are carried by the connection, so a change to
    // either shows up as a rewiring rather than as an update to the oscillator.
    a.wave === b.wave
  )
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

  for (const [key, before] of previous.mods) {
    // Also when the target or the depth moved: a cable pointing somewhere new has to let go of where
    // it was, since a parameter left connected keeps whatever offset it was holding.
    const after = next.mods.get(key)
    if (!after || after.target !== before.target || after.depth !== before.depth) {
      removals.push({ op: 'disconnectMod', ...splitSend(key) })
    }
  }

  for (const [id] of previous.effects) {
    if (!next.effects.has(id)) removals.push({ op: 'disposeEffect', id })
  }

  for (const [id] of previous.modulators) {
    if (!next.modulators.has(id)) removals.push({ op: 'disposeMod', id })
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

  for (const [id, params] of next.modulators) {
    const before = previous.modulators.get(id)
    if (!before) additions.push({ op: 'createMod', id, params })
    // `retimed` for the same reason an effect needs it: an LFO set in beats derives its rate from the
    // tempo, and nothing else would tell it the tempo had moved.
    else if (retimed || !sameMod(before, params)) updates.push({ op: 'updateMod', id, params })
  }

  for (const key of next.sends) {
    if (!previous.sends.has(key)) additions.push({ op: 'connect', ...splitSend(key) })
  }

  for (const [key, link] of next.mods) {
    const before = previous.mods.get(key)
    if (!before || before.target !== link.target || before.depth !== link.depth) {
      additions.push({ op: 'connectMod', ...splitSend(key), ...link })
    }
  }

  for (const [id, value] of next.direct) {
    if (previous.direct.get(id) !== value) updates.push({ op: 'setDirect', id, value })
  }

  return [...removals, ...additions, ...updates]
}
