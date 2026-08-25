import { MAX_FM_CENTS, resolveTarget, type ModTargetKey } from './modulation'
import { wouldFeedBack } from '../state/connections'
import { defaultFmParams, defaultFollowParams } from '../nodes/registry'
import type { FmParams, FxParams, ModParams, NodeId, Patch, FollowParams } from '../types/patch'

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
  /**
   * Whether each effect is heard directly, which it is unless it feeds another one.
   *
   * The end of a chain goes to the master; the middle of one does not, or a distorted reverb would be
   * heard alongside the reverb it was made from — which is the parallel arrangement wearing a chain's
   * clothes. Held as a map of every effect rather than a set of the terminal ones, so the diff can see an
   * effect *stop* being terminal as readily as it sees one start.
   */
  terminals: Map<NodeId, boolean>
  /** `sourceId>fxId`, one per send. The source is an oscillator, or an effect feeding another. */
  sends: Set<string>
  /** MOD node id → its parameters. */
  modulators: Map<NodeId, ModParams>
  /** FOLLOW node id → its parameters. Kept apart from the MODs because it is built out of other parts. */
  followers: Map<NodeId, FollowParams>
  /**
   * FM node id → its parameters.
   *
   * Its own map for the same reason, and it holds only an index — which the cable carries, so nothing
   * here ever needs updating. A node whose whole setting travels on its connection is created, connected
   * and disposed, and never changed in place.
   */
  fms: Map<NodeId, FmParams>
  /**
   * `sourceId>listenerId`, one per audio cable into a follower or an FM node.
   *
   * A tap and not a send: what a listener hears is not routed anywhere, so feeding one does **not** take
   * the source off the master the way feeding an effect does. An oscillator wired only to a follower is
   * heard exactly as it was — which is most of the point of the node — and an FM modulator you can also
   * hear is a sound somebody may want, so Level is what silences it rather than the cable.
   */
  taps: Set<string>
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
  | { op: 'setToMaster'; id: NodeId; value: boolean }
  | { op: 'createMod'; id: NodeId; params: ModParams }
  | { op: 'updateMod'; id: NodeId; params: ModParams }
  | { op: 'disposeMod'; id: NodeId }
  | { op: 'connectMod'; from: NodeId; to: NodeId; target: ModTargetKey; depth: number }
  | { op: 'disconnectMod'; from: NodeId; to: NodeId }
  | { op: 'createFm'; id: NodeId }
  | { op: 'disposeFm'; id: NodeId }
  | { op: 'createFollow'; id: NodeId; params: FollowParams }
  | { op: 'updateFollow'; id: NodeId; params: FollowParams }
  | { op: 'disposeFollow'; id: NodeId }
  | { op: 'tap'; from: NodeId; to: NodeId }
  | { op: 'untap'; from: NodeId; to: NodeId }

export const EMPTY_GRAPH: AudioGraph = {
  bpm: 0,
  effects: new Map(),
  direct: new Map(),
  terminals: new Map(),
  sends: new Set(),
  modulators: new Map(),
  followers: new Map(),
  fms: new Map(),
  taps: new Set(),
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
  const followers = new Map<NodeId, FollowParams>()
  const fms = new Map<NodeId, FmParams>()

  for (const node of patch.nodes) {
    if (node.type === 'fx') effects.set(node.id, node.params as FxParams)
    else if (node.type === 'osc') oscillators.add(node.id)
    else if (node.type === 'fm')
      fms.set(node.id, { ...defaultFmParams(), ...(node.params as FmParams) })
    // Merged over the defaults, unlike the others: a follower's depth is the one modulation control whose
    // resting value is negative, so an absent key falling back to a generic 0.6 would turn a duck into a
    // swell. Merging here means the engine and the diff both see a complete node.
    else if (node.type === 'follow') {
      followers.set(node.id, { ...defaultFollowParams(), ...(node.params as FollowParams) })
    }
  }

  /*
   * Audio sends: an oscillator into an effect, and an effect into another one, which is how effects go in
   * series. The order is the cables and there is no setting.
   *
   * **A loop is dropped rather than built.** A patch code, the dice or a paste can carry one — the
   * connection rules refuse to *draw* one but nothing stops one arriving — and an audio loop is a gain
   * feeding itself, which is not a glitch but a sound nobody can stop. Taken in patch order and skipping
   * any cable that would close a loop against the ones already accepted, so which cable is dropped is the
   * same every time rather than a matter of iteration.
   */
  const sends = new Set<string>()
  const sending = new Set<NodeId>()
  const chained = new Set<NodeId>()
  const accepted: { source: NodeId; target: NodeId; kind: 'audio' }[] = []
  const taps = new Set<string>()
  for (const edge of patch.edges) {
    if (edge.kind !== 'audio') continue
    const fromOsc = oscillators.has(edge.source)
    const fromFx = effects.has(edge.source)
    if (!(fromOsc || fromFx)) continue
    /*
     * A follower listening, which is the other thing an audio cable can mean and the only one that
     * changes nothing about where the sound goes. Taken before the loop check for the same reason it is
     * kept out of `sends`: a tap has no output, so it cannot be part of a cycle and it cannot take an
     * oscillator off the master.
     */
    if (followers.has(edge.target) || fms.has(edge.target)) {
      taps.add(sendKey(edge.source, edge.target))
      continue
    }
    if (!effects.has(edge.target)) continue
    if (wouldFeedBack(edge.source, edge.target, accepted)) continue

    accepted.push({ source: edge.source, target: edge.target, kind: 'audio' })
    sends.add(sendKey(edge.source, edge.target))
    if (fromOsc) sending.add(edge.source)
    // An effect that feeds another is not the end of its chain, so it does not go to the master.
    else chained.add(edge.source)
  }

  const direct = new Map<NodeId, number>()
  for (const id of oscillators) direct.set(id, sending.has(id) ? 0 : 1)

  /*
   * Which effects are heard directly.
   *
   * The end of a chain goes to the master and the middle of one does not — otherwise a distorted reverb
   * would be heard *and* the reverb it was made from, which is the parallel arrangement wearing a chain's
   * clothes. Derived here rather than tracked in the engine: this is the one place that knows the shape of
   * the whole graph, and an effect that stopped being terminal would otherwise need someone to remember
   * to unhook it.
   */
  const terminals = new Map<NodeId, boolean>()
  for (const id of effects.keys()) terminals.set(id, !chained.has(id))

  const modulators = new Map<NodeId, ModParams>()
  for (const node of patch.nodes) {
    if (node.type === 'mod') modulators.set(node.id, node.params as ModParams)
  }

  const mods = new Map<string, { target: ModTargetKey; depth: number }>()
  for (const edge of patch.edges) {
    if (edge.kind !== 'mod') continue
    /*
     * A MOD or a follower: two nodes that make modulation, and from here down one path.
     *
     * They differ in where the shape comes from and in nothing else — a signal at unit amplitude through
     * a depth, pointed at a parameter — so the cable, the resolving and the whole of the engine's
     * destination machinery are shared. What a follower cannot do is drive a parameter that is rebuilt
     * rather than connected, so it resolves against the narrower list.
     */
    const fm = fms.get(edge.source)
    const params = modulators.get(edge.source) ?? followers.get(edge.source)
    if (!fm && !params) continue
    const destination = effects.has(edge.target)
      ? 'fx'
      : oscillators.has(edge.target)
        ? 'osc'
        : undefined

    /*
     * An FM node names no target: it has one, and the cable is what says so. Its index is in cents and
     * the depth every cable carries is a share of the target's own span, so the conversion happens here
     * — the one place that knows both numbers — rather than as a second range inside the engine.
     */
    if (fm) {
      const target = resolveTarget('fm', destination, undefined, 'fm')
      if (target !== 'fm') continue
      const index = Math.min(MAX_FM_CENTS, Math.max(-MAX_FM_CENTS, fm.index ?? 0))
      mods.set(sendKey(edge.source, edge.target), { target, depth: index / MAX_FM_CENTS })
      continue
    }
    if (!params) continue

    // The effect matters as much as the node type: which parameters exist depends on which effect it
    // is, so a MOD on a reverb resolves against a reverb's list (§18.4).
    const target = resolveTarget(
      params.target as ModTargetKey | undefined,
      destination,
      effects.get(edge.target)?.effect,
      followers.has(edge.source) ? 'follow' : 'mod',
    )
    if (!target) continue
    // Depth rides along because it is scaled to the target: the same 0.6 is half a hertz on one
    // parameter and thousands on another, so a change to either has to re-connect.
    mods.set(sendKey(edge.source, edge.target), { target, depth: params.depth ?? 0.6 })
  }

  return {
    bpm: patch.bpm,
    effects,
    direct,
    terminals,
    sends,
    modulators,
    followers,
    fms,
    taps,
    mods,
  }
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

/**
 * Depth and target are left out for the same reason they are on a MOD: both are carried by the cable, so
 * a change to either arrives as a rewiring rather than as an update to the follower.
 */
function sameFollower(a: FollowParams, b: FollowParams): boolean {
  return a.attack === b.attack && a.release === b.release && a.sensitivity === b.sensitivity
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

  for (const key of previous.taps) {
    if (!next.taps.has(key)) removals.push({ op: 'untap', ...splitSend(key) })
  }

  for (const [id] of previous.followers) {
    if (!next.followers.has(id)) removals.push({ op: 'disposeFollow', id })
  }

  for (const [id] of previous.fms) {
    if (!next.fms.has(id)) removals.push({ op: 'disposeFm', id })
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

  /*
   * Only ever created or disposed, never updated. An FM node's one setting is carried by its cable — the
   * same rule a MOD's depth follows — so changing the index arrives as a rewiring, and comparing the
   * parameters here would emit an operation with nothing to do.
   */
  for (const [id] of next.fms) {
    if (!previous.fms.has(id)) additions.push({ op: 'createFm', id })
  }

  for (const [id, params] of next.followers) {
    const before = previous.followers.get(id)
    // No `retimed` here, and nothing else either: a follower has no tempo and no shape to rebuild, so
    // every one of its settings is a number on a live parameter.
    if (!before) additions.push({ op: 'createFollow', id, params })
    else if (!sameFollower(before, params)) updates.push({ op: 'updateFollow', id, params })
  }

  for (const key of next.taps) {
    if (!previous.taps.has(key)) additions.push({ op: 'tap', ...splitSend(key) })
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

  /*
   * Absent counts as *not* connected, which is what a freshly built effect is: `createEffect` leaves its
   * output unhooked and waits to be told. That is the whole reason this is a diff rather than something
   * the engine tracks — an effect that stops being the end of a chain has to be unhooked, and nothing in
   * the engine knows that has happened.
   */
  for (const [id, value] of next.terminals) {
    if ((previous.terminals.get(id) ?? false) !== value) {
      updates.push({ op: 'setToMaster', id, value })
    }
  }

  return [...removals, ...additions, ...updates]
}
