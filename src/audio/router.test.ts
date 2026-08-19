import { describe, expect, it } from 'vitest'
import { defaultFxParams, defaultOscParams } from '../nodes/registry'
import type { FxParams, Patch, PatchEdge, PatchNode } from '../types/patch'
import { diff, EMPTY_GRAPH, graphOf, sendKey, type AudioGraph } from './router'

function osc(id: string, direct = 1): PatchNode {
  return {
    id,
    type: 'osc',
    position: { x: 0, y: 0 },
    params: { ...defaultOscParams(), direct },
  }
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
    const graph = graphOf(patchOf([osc('a', 0.5), fx('f')], [audio('a', 'f')]))
    expect([...graph.direct]).toEqual([['a', 0.5]])
    expect([...graph.effects.keys()]).toEqual(['f'])
    expect([...graph.sends]).toEqual(['a>f'])
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

    expect(ops.map((o) => o.op)).toEqual(['createEffect', 'connect'])
  })

  it('disconnects before disposing, so nothing feeds a node that is going away', () => {
    const before = graph(patchOf([osc('a'), fx('f')], [audio('a', 'f')]))
    const after = graph(patchOf([osc('a')]))
    const ops = diff(before, after)

    expect(ops.map((o) => o.op)).toEqual(['disconnect', 'disposeEffect'])
  })

  it('replaces the chain when the effect changes, without touching its cables', () => {
    const before = graph(patchOf([osc('a'), fx('f', { effect: 'drive' })], [audio('a', 'f')]))
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

  it('tracks Direct on its own, without disturbing the graph', () => {
    const before = graph(patchOf([osc('a', 1), fx('f')], [audio('a', 'f')]))
    const after = graph(patchOf([osc('a', 0), fx('f')], [audio('a', 'f')]))
    expect(diff(before, after)).toEqual([{ op: 'setDirect', id: 'a', value: 0 }])
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
