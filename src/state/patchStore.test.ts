import { beforeEach, describe, expect, it } from 'vitest'
import type { Osc4Params } from '../types/patch'
import { toPatch, usePatchStore } from './patchStore'

beforeEach(() => {
  usePatchStore.getState().resetPatch()
})

describe('the starting patch', () => {
  // It is stored as a patch code, so a bad edit to that constant would silently boot an empty
  // canvas rather than fail loudly. This is what catches that.
  it('decodes into the intended patch', () => {
    const patch = toPatch()
    expect(patch.bpm).toBe(300)
    expect(patch.loop).toBe(true)
    expect(patch.nodes.filter((n) => n.type === 'start')).toHaveLength(2)
    expect(patch.nodes.filter((n) => n.type === 'osc4')).toHaveLength(5)
    expect(patch.nodes.filter((n) => n.type === 'delay')).toHaveLength(1)
    expect(patch.edges).toHaveLength(6)
  })

  it('covers four waveforms plus a noise colour, so Play is not one flat timbre', () => {
    const waveforms = toPatch()
      .nodes.filter((n) => n.type === 'osc4')
      .map((n) => (n.params as Osc4Params).waveform)
    expect(new Set(waveforms).size).toBeGreaterThanOrEqual(4)
    expect(waveforms).toContain('white')
    expect(waveforms).toContain('brown')
  })

  it('every oscillator is reachable from an ignite node', () => {
    const patch = toPatch()
    const reachable = new Set(patch.nodes.filter((n) => n.type === 'start').map((n) => n.id))
    for (let pass = 0; pass < patch.nodes.length; pass++) {
      for (const edge of patch.edges) {
        if (reachable.has(edge.source)) reachable.add(edge.target)
      }
    }
    for (const node of patch.nodes) {
      expect(reachable.has(node.id)).toBe(true)
    }
  })
})

describe('connections', () => {
  it('removes a cable by id', () => {
    const { edges, removeEdge } = usePatchStore.getState()
    const target = edges[0]
    removeEdge(target.id)

    const remaining = usePatchStore.getState().edges
    expect(remaining).toHaveLength(edges.length - 1)
    expect(remaining.some((e) => e.id === target.id)).toBe(false)
  })

  it('ignores an unknown id instead of clearing everything', () => {
    const before = usePatchStore.getState().edges.length
    usePatchStore.getState().removeEdge('does-not-exist')
    expect(usePatchStore.getState().edges).toHaveLength(before)
  })

  it('refuses to connect a node to itself', () => {
    const { nodes, onConnect } = usePatchStore.getState()
    const before = usePatchStore.getState().edges.length
    onConnect({ source: nodes[1].id, target: nodes[1].id, sourceHandle: null, targetHandle: null })
    expect(usePatchStore.getState().edges).toHaveLength(before)
  })

  it('refuses to duplicate an existing cable', () => {
    const { edges, onConnect } = usePatchStore.getState()
    const existing = edges[0]
    onConnect({
      source: existing.source,
      target: existing.target,
      sourceHandle: null,
      targetHandle: null,
    })
    expect(usePatchStore.getState().edges).toHaveLength(edges.length)
  })

  it('accepts a genuinely new connection as an event cable', () => {
    const { nodes, onConnect } = usePatchStore.getState()
    const b = nodes[2]
    const c = nodes[3]
    onConnect({ source: b.id, target: c.id, sourceHandle: null, targetHandle: null })

    const added = usePatchStore.getState().edges.find((e) => e.source === b.id && e.target === c.id)
    expect(added).toBeDefined()
    expect(added?.data?.kind).toBe('event')
  })
})

describe('sequence length', () => {
  function firstOsc() {
    return usePatchStore.getState().nodes.find((n) => n.type === 'osc4')!
  }

  it('doubles by repeating the phrase, not by padding with defaults', () => {
    const osc = firstOsc()
    const before = (osc.data.params as Osc4Params).steps.map((s) => s.note)
    usePatchStore.getState().setStepCount(osc.id, 8)

    const after = (firstOsc().data.params as Osc4Params).steps.map((s) => s.note)
    expect(after).toHaveLength(8)
    expect(after).toEqual([...before, ...before])
  })

  it('shrinks by keeping the front of the phrase', () => {
    const osc = firstOsc()
    const before = (osc.data.params as Osc4Params).steps.map((s) => s.note)
    usePatchStore.getState().setStepCount(osc.id, 2)

    const after = (firstOsc().data.params as Osc4Params).steps.map((s) => s.note)
    expect(after).toEqual(before.slice(0, 2))
  })

  it('round-trips 2, 4, 8 and 16', () => {
    const osc = firstOsc()
    for (const count of [2, 4, 8, 16]) {
      usePatchStore.getState().setStepCount(osc.id, count)
      expect((firstOsc().data.params as Osc4Params).steps).toHaveLength(count)
    }
  })

  it('refuses a length the engine cannot run', () => {
    const osc = firstOsc()
    usePatchStore.getState().setStepCount(osc.id, 7)
    expect((firstOsc().data.params as Osc4Params).steps).toHaveLength(4)
  })

  it('leaves other nodes alone', () => {
    const [first, second] = usePatchStore.getState().nodes.filter((n) => n.type === 'osc4')
    usePatchStore.getState().setStepCount(first.id, 16)

    const other = usePatchStore.getState().nodes.find((n) => n.id === second.id)!
    expect((other.data.params as Osc4Params).steps).toHaveLength(4)
  })
})

describe('serialisation', () => {
  it('round-trips a patch through toPatch and loadPatch', () => {
    const original = toPatch()
    usePatchStore.getState().clear()
    expect(usePatchStore.getState().nodes).toHaveLength(0)

    usePatchStore.getState().loadPatch(original)
    expect(toPatch()).toEqual(original)
  })

  it('keeps params editable after a round trip', () => {
    usePatchStore.getState().loadPatch(toPatch())
    const osc = usePatchStore.getState().nodes.find((n) => n.type === 'osc4')!
    usePatchStore.getState().updateParams(osc.id, { waveform: 'pink', gain: 0.5 })

    const updated = usePatchStore.getState().nodes.find((n) => n.id === osc.id)!
    const params = updated.data.params as Osc4Params
    expect(params.waveform).toBe('pink')
    expect(params.gain).toBe(0.5)
    // Updating one field must not drop the rest.
    expect(params.steps).toHaveLength(4)
  })
})
