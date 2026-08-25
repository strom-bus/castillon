import { describe, expect, it } from 'vitest'
import { defaultFxParams, defaultOscParams } from '../nodes/registry'
import type { FxParams, ModParams, Patch, PatchEdge, PatchNode } from '../types/patch'
import { diff, EMPTY_GRAPH, graphOf, sendKey, type AudioGraph } from './router'

function osc(id: string): PatchNode {
  return { id, type: 'osc', position: { x: 0, y: 0 }, params: defaultOscParams() }
}

function fx(id: string, overrides: Partial<FxParams> = {}): PatchNode {
  return {
    id,
    type: 'fx',
    position: { x: 0, y: 0 },
    params: { ...defaultFxParams(), ...overrides },
  }
}

function audio(source: string, target: string): PatchEdge {
  return { id: `${source}>${target}`, kind: 'audio', source, target }
}

function event(source: string, target: string): PatchEdge {
  return { id: `e${source}${target}`, kind: 'event', source, target }
}

function patchOf(nodes: PatchNode[], edges: PatchEdge[] = []): Patch {
  return { version: 1, bpm: 120, loop: true, nodes, edges }
}

describe('graphOf', () => {
  it('keeps only what affects audio', () => {
    const graph = graphOf(patchOf([osc('a'), fx('f')], [audio('a', 'f')]))
    expect([...graph.effects.keys()]).toEqual(['f'])
    expect([...graph.sends]).toEqual(['a>f'])
  })

  it('an oscillator with nothing attached is heard whole', () => {
    expect(graphOf(patchOf([osc('a')])).direct.get('a')).toBe(1)
  })

  it('an oscillator with an effect is heard through it, not alongside it', () => {
    // Derived rather than stored. Each effect carries the dry across itself, so a second path to
    // the master would count the clean signal twice — which is what a Direct control used to do
    // whenever it was left at its default.
    const graph = graphOf(patchOf([osc('a'), fx('f')], [audio('a', 'f')]))
    expect(graph.direct.get('a')).toBe(0)
  })

  it('goes back to being heard whole when the last effect is unwired', () => {
    const before = graphOf(patchOf([osc('a'), fx('f')], [audio('a', 'f')]))
    const after = graphOf(patchOf([osc('a'), fx('f')]))
    expect(diff(before, after)).toEqual([
      { op: 'disconnect', from: 'a', to: 'f' },
      { op: 'setDirect', id: 'a', value: 1 },
    ])
  })

  it('ignores event cables', () => {
    const graph = graphOf(patchOf([osc('a'), osc('b')], [event('a', 'b')]))
    expect(graph.sends.size).toBe(0)
  })

  it('drops an audio cable whose ends are not an oscillator and an effect', () => {
    // Nothing in the UI can draw these, but a hand-edited patch or a future node type could.
    const graph = graphOf(
      patchOf(
        [osc('a'), fx('f'), { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }],
        [audio('f', 'a'), audio('s', 'f'), audio('a', 'missing')],
      ),
    )
    expect(graph.sends.size).toBe(0)
  })

  it('takes several effects on one oscillator and one effect on several', () => {
    const graph = graphOf(
      patchOf(
        [osc('a'), osc('b'), fx('f'), fx('g')],
        [audio('a', 'f'), audio('a', 'g'), audio('b', 'f')],
      ),
    )
    expect([...graph.sends].sort()).toEqual(['a>f', 'a>g', 'b>f'])
  })
})

describe('diff', () => {
  const graph = (patch: Patch) => graphOf(patch)

  it('emits nothing when nothing audio-relevant changed', () => {
    const before = graph(patchOf([osc('a'), fx('f')], [audio('a', 'f')]))
    const after = graph(patchOf([osc('a'), fx('f')], [audio('a', 'f')]))
    expect(diff(before, after)).toEqual([])
  })

  it('emits nothing when a node is only dragged', () => {
    // The whole reason for diffing: dragging fires a store update per frame.
    const before = graph(patchOf([osc('a'), fx('f')], [audio('a', 'f')]))
    const moved = patchOf([osc('a'), fx('f')], [audio('a', 'f')])
    moved.nodes[0].position = { x: 900, y: 400 }
    expect(diff(before, graph(moved))).toEqual([])
  })

  it('creates and connects a new effect, in that order', () => {
    const before = graph(patchOf([osc('a')]))
    const after = graph(patchOf([osc('a'), fx('f')], [audio('a', 'f')]))
    const ops = diff(before, after)

    /*
     * Muting the direct path belongs to the same change: the effect carries the dry from here on. And
     * hooking the effect to the master belongs to it too — `createEffect` no longer does that, because
     * where an effect's output goes depends on whether anything is downstream of it, which is a fact
     * about the graph rather than about the node.
     */
    expect(ops.map((o) => o.op)).toEqual(['createEffect', 'connect', 'setDirect', 'setToMaster'])
  })

  it('disconnects before disposing, so nothing feeds a node that is going away', () => {
    const before = graph(patchOf([osc('a'), fx('f')], [audio('a', 'f')]))
    const after = graph(patchOf([osc('a')]))
    const ops = diff(before, after)

    expect(ops.map((o) => o.op)).toEqual(['disconnect', 'disposeEffect', 'setDirect'])
  })

  it('replaces the chain when the effect changes, without touching its cables', () => {
    const before = graph(patchOf([osc('a'), fx('f', { effect: 'distortion' })], [audio('a', 'f')]))
    const after = graph(patchOf([osc('a'), fx('f', { effect: 'reverb' })], [audio('a', 'f')]))
    const ops = diff(before, after)

    expect(ops).toEqual([
      { op: 'replaceEffect', id: 'f', params: expect.objectContaining({ effect: 'reverb' }) },
    ])
    // The point of the fixed input/output pair: no rewiring at all.
    expect(ops.some((o) => o.op === 'connect' || o.op === 'disconnect')).toBe(false)
  })

  it('updates parameters in place when only a number moved', () => {
    const before = graph(patchOf([osc('a'), fx('f', { mix: 0.8 })]))
    const after = graph(patchOf([osc('a'), fx('f', { mix: 0.4 })]))
    const ops = diff(before, after)

    expect(ops).toEqual([
      { op: 'updateEffect', id: 'f', params: expect.objectContaining({ mix: 0.4 }) },
    ])
  })

  it('mutes the direct path in the same pass that wires the effect up', () => {
    const before = graph(patchOf([osc('a'), fx('f')]))
    const after = graph(patchOf([osc('a'), fx('f')], [audio('a', 'f')]))
    const ops = diff(before, after)

    expect(ops).toEqual([
      { op: 'connect', from: 'a', to: 'f' },
      { op: 'setDirect', id: 'a', value: 0 },
    ])
  })

  it('builds the whole graph from empty', () => {
    const after = graph(patchOf([osc('a'), osc('b'), fx('f')], [audio('a', 'f'), audio('b', 'f')]))
    const ops = diff(EMPTY_GRAPH, after)

    expect(ops.filter((o) => o.op === 'createEffect')).toHaveLength(1)
    expect(ops.filter((o) => o.op === 'connect')).toHaveLength(2)
    // Two oscillators at the default Direct of 1, which the live graph does not know yet.
    expect(ops.filter((o) => o.op === 'setDirect')).toHaveLength(2)
    expect(ops.findIndex((o) => o.op === 'createEffect')).toBeLessThan(
      ops.findIndex((o) => o.op === 'connect'),
    )
  })

  it('tears the whole graph down', () => {
    const before = graph(patchOf([osc('a'), fx('f')], [audio('a', 'f')]))
    const ops = diff(before, EMPTY_GRAPH)
    expect(ops.map((o) => o.op)).toEqual(['disconnect', 'disposeEffect'])
  })

  it('handles one send moving from one effect to another', () => {
    const before = graph(patchOf([osc('a'), fx('f'), fx('g')], [audio('a', 'f')]))
    const after = graph(patchOf([osc('a'), fx('f'), fx('g')], [audio('a', 'g')]))
    const ops = diff(before, after)

    expect(ops).toEqual([
      { op: 'disconnect', from: 'a', to: 'f' },
      { op: 'connect', from: 'a', to: 'g' },
    ])
  })

  it('is stable under a round trip through its own key format', () => {
    expect(sendKey('a', 'b')).toBe('a>b')
    const before: AudioGraph = { ...EMPTY_GRAPH, sends: new Set([sendKey('a', 'b')]) }
    expect(diff(before, before)).toEqual([])
  })
})

describe('modulation in the graph', () => {
  const modNode = (id: string, params: Partial<ModParams> = {}): PatchNode => ({
    id,
    type: 'mod',
    position: { x: 0, y: 0 },
    params: { target: 'level', kind: 'lfo', wave: 'sine', rate: 2, depth: 0.6, ...params },
  })

  const modEdge = (source: string, target: string): PatchEdge => ({
    id: `${source}~${target}`,
    kind: 'mod',
    source,
    target,
  })

  it('sees a modulator and its cable', () => {
    const graph = graphOf(patchOf([modNode('m'), osc('a')], [modEdge('m', 'a')]))
    expect(graph.modulators.has('m')).toBe(true)
    expect(graph.mods.get('m>a')?.target).toBe('level')
  })

  it('resolves the target against what the cable landed on', () => {
    // Mix does not exist on an oscillator, so it falls back rather than doing nothing (§18.4).
    const graph = graphOf(patchOf([modNode('m', { target: 'mix' }), osc('a')], [modEdge('m', 'a')]))
    expect(graph.mods.get('m>a')?.target).toBe('level')
  })

  it('keeps Mix when the cable lands on an effect', () => {
    const graph = graphOf(patchOf([modNode('m', { target: 'mix' }), fx('f')], [modEdge('m', 'f')]))
    expect(graph.mods.get('m>f')?.target).toBe('mix')
  })

  it('drops a cable to something with nothing to modulate', () => {
    const graph = graphOf(
      patchOf(
        [modNode('m'), { id: 'd', type: 'hold', position: { x: 0, y: 0 }, params: {} }],
        [modEdge('m', 'd')],
      ),
    )
    expect(graph.mods.size).toBe(0)
  })

  it('builds and wires a new modulator, in that order', () => {
    const ops = diff(EMPTY_GRAPH, graphOf(patchOf([modNode('m'), osc('a')], [modEdge('m', 'a')])))
    const kinds = ops.map((op) => op.op)
    expect(kinds).toContain('createMod')
    expect(kinds).toContain('connectMod')
    expect(kinds.indexOf('createMod')).toBeLessThan(kinds.indexOf('connectMod'))
  })

  it('emits nothing when nothing about it changed', () => {
    // The property the whole router exists for: dragging a node must not rewire anything.
    const patch = patchOf([modNode('m'), osc('a')], [modEdge('m', 'a')])
    expect(diff(graphOf(patch), graphOf(patch))).toEqual([])
  })

  it('updates rather than rebuilds when the rate moves', () => {
    const before = graphOf(patchOf([modNode('m'), osc('a')], [modEdge('m', 'a')]))
    const after = graphOf(patchOf([modNode('m', { rate: 7 }), osc('a')], [modEdge('m', 'a')]))
    const ops = diff(before, after)
    expect(ops.map((op) => op.op)).toEqual(['updateMod'])
  })

  it('lets go of the old parameter when the target moves', () => {
    // A parameter left connected keeps whatever offset it was holding when the cable moved on.
    const before = graphOf(patchOf([modNode('m', { target: 'mix' }), fx('f')], [modEdge('m', 'f')]))
    const after = graphOf(
      patchOf([modNode('m', { target: 'level' }), fx('f')], [modEdge('m', 'f')]),
    )
    const ops = diff(before, after)
    expect(ops.map((op) => op.op)).toContain('disconnectMod')
    expect(ops.map((op) => op.op)).toContain('connectMod')
    expect(ops.findIndex((op) => op.op === 'disconnectMod')).toBeLessThan(
      ops.findIndex((op) => op.op === 'connectMod'),
    )
  })

  it('disposes a modulator that has gone', () => {
    const before = graphOf(patchOf([modNode('m'), osc('a')], [modEdge('m', 'a')]))
    const after = graphOf(patchOf([osc('a')], []))
    const kinds = diff(before, after).map((op) => op.op)
    expect(kinds).toContain('disconnectMod')
    expect(kinds).toContain('disposeMod')
    expect(kinds.indexOf('disconnectMod')).toBeLessThan(kinds.indexOf('disposeMod'))
  })

  it('does not count a modulation cable as an audio send', () => {
    // Two graphs sharing a node pair: one cable each. The audio path must not see the modulation one.
    const graph = graphOf(
      patchOf([modNode('m'), osc('a'), fx('f')], [modEdge('m', 'a'), audio('a', 'f')]),
    )
    expect(graph.sends.has('a>f')).toBe(true)
    expect(graph.sends.has('m>a')).toBe(false)
  })
})

describe('a tempo change and the nodes that derive from it', () => {
  /**
   * An echo's delay time comes from the tempo and so, now, does a synced LFO's rate. Neither is told by
   * anything else that the tempo has moved — there is no signal for it — so the diff has to notice and
   * push an update, and it noticed only for effects.
   *
   * Which meant sync was doing nothing the moment somebody changed the BPM: the wobble stayed at
   * whatever hertz it had been resolved to when it was built, which is the one thing sync exists to
   * prevent.
   */
  const withMod = (bpm: number, params: Partial<ModParams> = {}): Patch => ({
    version: 1,
    bpm,
    loop: true,
    nodes: [
      osc('a'),
      {
        id: 'm',
        type: 'mod',
        position: { x: 0, y: 0 },
        params: { kind: 'lfo', wave: 'sine', rate: 2, depth: 0.5, target: 'cutoff', ...params },
      },
    ],
    edges: [{ id: 'mm', kind: 'mod', source: 'm', target: 'a' }],
  })

  const opsFor = (from: Patch, to: Patch) => diff(graphOf(from), graphOf(to)).map((op) => op.op)

  it('reaches a modulator, the way it already reached an effect', () => {
    const ops = opsFor(
      withMod(120, { sync: true, beats: 4 }),
      withMod(150, { sync: true, beats: 4 }),
    )
    expect(ops).toContain('updateMod')
  })

  it('reaches one that is not synced too, which costs a rebuild of nothing', () => {
    /*
     * Told anyway rather than worked out here. Whether the rate is derived is the modulator's own
     * business, and a diff that had to know would be a second place holding the same rule — the shape of
     * mistake that had `connectMod` naming the filter targets by hand.
     */
    expect(opsFor(withMod(120), withMod(150))).toContain('updateMod')
  })

  it('says nothing when the tempo has not moved', () => {
    expect(opsFor(withMod(120, { sync: true }), withMod(120, { sync: true }))).toEqual([])
  })
})
