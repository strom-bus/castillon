import { beforeEach, describe, expect, it } from 'vitest'
import type { Osc4Params } from '../types/patch'
import { toPatch, usePatchStore } from './patchStore'

beforeEach(() => {
  usePatchStore.getState().resetPatch()
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
