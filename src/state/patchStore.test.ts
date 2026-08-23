import { beforeEach, describe, expect, it } from 'vitest'
import type { OscParams } from '../types/patch'
import { toPatch, EDGE_COMPONENT, usePatchStore } from './patchStore'

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
    expect(patch.nodes.filter((n) => n.type === 'osc')).toHaveLength(5)
    expect(patch.nodes.filter((n) => n.type === 'delay')).toHaveLength(1)
    expect(patch.edges).toHaveLength(6)
  })

  it('covers four waveforms plus a noise colour, so Play is not one flat timbre', () => {
    const waveforms = toPatch()
      .nodes.filter((n) => n.type === 'osc')
      .map((n) => (n.params as OscParams).waveform)
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

describe('rolling a random patch', () => {
  it('replaces the patch with one that plays', () => {
    usePatchStore.getState().randomisePatch()
    const patch = toPatch()

    expect(patch.nodes.filter((n) => n.type === 'start').length).toBeGreaterThan(0)
    expect(patch.nodes.filter((n) => n.type === 'osc').length).toBeGreaterThan(0)
  })

  it('leaves the canvas in a state the app can draw', () => {
    // Straight from the generator into React Flow, so every cable needs its ports named the same
    // way a loaded patch does.
    //
    // Against the app's own table rather than a copy of it kept here. The copy was a hand-written map of
    // three kinds, and it went stale twice: once the day the die learned to roll a modulator, and again
    // the day a fourth kind of cable existed — both times asserting that the new cable draws itself as a
    // cascade, which is the exact failure it was written to catch.
    usePatchStore.getState().randomisePatch()
    for (const edge of usePatchStore.getState().edges) {
      expect(edge.sourceHandle).toBeTruthy()
      expect(edge.targetHandle).toBeTruthy()
      expect(edge.type).toBe(EDGE_COMPONENT[edge.data?.kind ?? 'event'])
    }
  })

  it('clears the selection, since the selected node is gone', () => {
    const osc = usePatchStore.getState().nodes.find((n) => n.type === 'osc')!
    usePatchStore.getState().select(osc.id)
    usePatchStore.getState().randomisePatch()
    expect(usePatchStore.getState().selectedId).toBeNull()
  })

  it('gives something different each roll', () => {
    const codes = new Set<string>()
    for (let i = 0; i < 12; i++) {
      usePatchStore.getState().randomisePatch()
      codes.add(JSON.stringify(toPatch()))
    }
    expect(codes.size).toBeGreaterThan(9)
  })
})

describe('loading a patch the app did not write', () => {
  // React Flow renders an unrecognised node type as its own default node: a blank white box
  // with no ports. These are the guards against a patch quietly turning into blank boxes.
  const base = () => ({ version: 1 as const, bpm: 120, loop: true, nodes: [], edges: [] })

  it('accepts a node saved under a type that has since been renamed', () => {
    usePatchStore.getState().loadPatch({
      ...base(),
      nodes: [{ id: 'x', type: 'osc4', position: { x: 0, y: 0 }, params: {} }],
    })
    const [node] = usePatchStore.getState().nodes
    expect(node.type).toBe('osc')
    expect((node.data.params as OscParams).steps).toHaveLength(4)
  })

  it('drops a node of a type the registry does not know', () => {
    usePatchStore.getState().loadPatch({
      ...base(),
      nodes: [
        { id: 'good', type: 'osc', position: { x: 0, y: 0 }, params: {} },
        { id: 'alien', type: 'wormhole', position: { x: 0, y: 0 }, params: {} },
      ],
      edges: [{ id: 'e', kind: 'event', source: 'good', target: 'alien' }],
    })
    expect(usePatchStore.getState().nodes.map((n) => n.id)).toEqual(['good'])
    // Its cables go with it, rather than dangling at an id that is no longer there.
    expect(usePatchStore.getState().edges).toHaveLength(0)
  })

  it('fills in parameters the saved patch predates', () => {
    usePatchStore.getState().loadPatch({
      ...base(),
      nodes: [
        { id: 'x', type: 'osc', position: { x: 0, y: 0 }, params: { gain: 0.9 } as OscParams },
      ],
    })
    const params = usePatchStore.getState().nodes[0].data.params as OscParams
    expect(params.gain).toBe(0.9)
    expect(params.filterType).toBe('off')
    expect(params.waveform).toBe('square')
    expect(params.steps).toHaveLength(4)
  })
})

describe('ports on a loaded patch', () => {
  // A patch code stores which nodes a cable joins but not which port. An oscillator has three
  // source handles, so an unnamed cable would bind to whichever React Flow found first — which is
  // how event cables ended up leaving through the audio ports.
  it('routes event cables through the event ports', () => {
    for (const edge of usePatchStore.getState().edges) {
      if (edge.data?.kind !== 'event') continue
      expect(edge.sourceHandle).toBe('out')
      expect(edge.targetHandle).toBe('in')
    }
  })

  it('names a handle on every cable, so none is left for React Flow to guess', () => {
    for (const edge of usePatchStore.getState().edges) {
      expect(edge.sourceHandle).toBeTruthy()
      expect(edge.targetHandle).toBeTruthy()
    }
  })

  it('attaches an audio cable on the side the effect already sits on', () => {
    const base = { version: 1 as const, bpm: 120, loop: true }
    const osc = { id: 'a', type: 'osc', position: { x: 200, y: 0 }, params: {} }
    const cable = { id: 'x', kind: 'audio' as const, source: 'a', target: 'f' }

    usePatchStore.getState().loadPatch({
      ...base,
      nodes: [osc, { id: 'f', type: 'fx', position: { x: 600, y: 0 }, params: {} }],
      edges: [cable],
    })
    const toTheRight = usePatchStore.getState().edges[0]
    expect(toTheRight.sourceHandle).toBe('signal-r')
    expect(toTheRight.targetHandle).toBe('signal-l')

    usePatchStore.getState().loadPatch({
      ...base,
      nodes: [osc, { id: 'f', type: 'fx', position: { x: -300, y: 0 }, params: {} }],
      edges: [cable],
    })
    const toTheLeft = usePatchStore.getState().edges[0]
    expect(toTheLeft.sourceHandle).toBe('signal-l')
    expect(toTheLeft.targetHandle).toBe('signal-r')
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
    return usePatchStore.getState().nodes.find((n) => n.type === 'osc')!
  }

  it('doubles by repeating the phrase, not by padding with defaults', () => {
    const osc = firstOsc()
    const before = (osc.data.params as OscParams).steps.map((s) => s.note)
    usePatchStore.getState().setStepCount(osc.id, 8)

    const after = (firstOsc().data.params as OscParams).steps.map((s) => s.note)
    expect(after).toHaveLength(8)
    expect(after).toEqual([...before, ...before])
  })

  it('shrinks by keeping the front of the phrase', () => {
    const osc = firstOsc()
    const before = (osc.data.params as OscParams).steps.map((s) => s.note)
    usePatchStore.getState().setStepCount(osc.id, 2)

    const after = (firstOsc().data.params as OscParams).steps.map((s) => s.note)
    expect(after).toEqual(before.slice(0, 2))
  })

  it('round-trips 2, 4, 8 and 16', () => {
    const osc = firstOsc()
    for (const count of [2, 4, 8, 16]) {
      usePatchStore.getState().setStepCount(osc.id, count)
      expect((firstOsc().data.params as OscParams).steps).toHaveLength(count)
    }
  })

  it('refuses a length the engine cannot run', () => {
    const osc = firstOsc()
    usePatchStore.getState().setStepCount(osc.id, 7)
    expect((firstOsc().data.params as OscParams).steps).toHaveLength(4)
  })

  it('leaves other nodes alone', () => {
    const [first, second] = usePatchStore.getState().nodes.filter((n) => n.type === 'osc')
    usePatchStore.getState().setStepCount(first.id, 16)

    const other = usePatchStore.getState().nodes.find((n) => n.id === second.id)!
    expect((other.data.params as OscParams).steps).toHaveLength(4)
  })
})

describe('serialisation', () => {
  it('round-trips a patch through toPatch and loadPatch', () => {
    const original = toPatch()
    usePatchStore.getState().loadPatch({ ...original, nodes: [], edges: [] })
    expect(usePatchStore.getState().nodes).toHaveLength(0)

    usePatchStore.getState().loadPatch(original)
    expect(toPatch()).toEqual(original)
  })

  it('keeps params editable after a round trip', () => {
    usePatchStore.getState().loadPatch(toPatch())
    const osc = usePatchStore.getState().nodes.find((n) => n.type === 'osc')!
    usePatchStore.getState().updateParams(osc.id, { waveform: 'pink', gain: 0.5 })

    const updated = usePatchStore.getState().nodes.find((n) => n.id === osc.id)!
    const params = updated.data.params as OscParams
    expect(params.waveform).toBe('pink')
    expect(params.gain).toBe(0.5)
    // Updating one field must not drop the rest.
    expect(params.steps).toHaveLength(4)
  })
})
