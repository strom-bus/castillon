import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { defaultOscParams } from '../nodes/registry'
import { usePatchStore } from '../state/patchStore'
import { installHistory, labelFor, useHistoryStore, type PatchSnap } from './patchHistory'

/**
 * The history against the real store, which is where the derived label has to earn its keep: it is
 * what decides that a drag is one step and that two sliders on one node are two.
 */

let teardown: () => void

beforeEach(() => {
  usePatchStore.getState().resetPatch()
  teardown = installHistory()
})

afterEach(() => teardown())

const store = () => usePatchStore.getState()
const history = () => useHistoryStore.getState()
const release = () => window.dispatchEvent(new Event('pointerup'))

const snapOf = (nodes: PatchSnap['nodes'], bpm = 120): PatchSnap => ({
  nodes,
  edges: [],
  bpm,
  loop: true,
})
const node = (id: string, x = 0, y = 0) => ({ id, type: 'osc', x, y, params: defaultOscParams() })

describe('labelFor', () => {
  it('calls a tempo change its own thing', () => {
    expect(labelFor(snapOf([]), snapOf([], 130))).toBe('bpm')
  })

  it('calls a position change a move', () => {
    expect(labelFor(snapOf([node('a')]), snapOf([node('a', 40, 0)]))).toBe('move')
  })

  it('names the node whose parameters changed, so two nodes are two gestures', () => {
    const before = snapOf([node('a'), node('b')])
    const after = snapOf([
      { ...node('a'), params: { ...defaultOscParams(), gain: 0.9 } },
      node('b'),
    ])
    expect(labelFor(before, after)).toBe('params:a')
  })

  it('calls adding or removing structure, whatever else moved with it', () => {
    expect(labelFor(snapOf([node('a')]), snapOf([node('a'), node('b')]))).toMatch(/^structure:/)
    expect(labelFor(snapOf([node('a'), node('b')]), snapOf([node('a')]))).toMatch(/^structure:/)
  })

  it('gives two different structures two different labels, so they cannot merge', () => {
    // Adding a node and then resetting were one step until this: both said "structure", and a shared
    // label is what makes consecutive changes collapse.
    const add = labelFor(snapOf([node('a')]), snapOf([node('a'), node('b')]))
    const reset = labelFor(snapOf([node('a'), node('b')]), snapOf([node('c')]))
    expect(add).not.toBe(reset)
  })

  it('gives the same structure the same label, so one act stays one step', () => {
    const before = snapOf([node('a')])
    const after = snapOf([node('a'), node('b')])
    expect(labelFor(before, after)).toBe(labelFor(before, after))
  })
})

describe('the history over the real store', () => {
  it('starts with the patch it found, and nothing to undo', () => {
    expect(history().canUndo).toBe(false)
    expect(history().canRedo).toBe(false)
  })

  it('records adding a node, and undoing removes it', () => {
    const before = store().nodes.length
    store().addNode('osc', { x: 10, y: 10 })
    expect(store().nodes).toHaveLength(before + 1)
    expect(history().canUndo).toBe(true)

    history().undo()
    expect(store().nodes).toHaveLength(before)
    expect(history().canRedo).toBe(true)
  })

  it('puts it back on redo', () => {
    store().addNode('osc', { x: 10, y: 10 })
    const after = store().nodes.length
    history().undo()
    history().redo()
    expect(store().nodes).toHaveLength(after)
  })

  it('collapses a slider drag into one step', () => {
    // The case the whole design exists for: a range input fires a change per frame.
    const id = store().nodes.find((n) => n.type === 'osc')!.id
    for (let i = 1; i <= 40; i++) store().updateParams(id, { gain: i / 100 })

    history().undo()
    // One step back reaches the value before the drag started, not the previous frame.
    const params = store().nodes.find((n) => n.id === id)!.data.params as { gain: number }
    expect(params.gain).not.toBeCloseTo(0.39, 2)
  })

  it('treats two drags of the same slider as two steps once released', () => {
    const id = store().nodes.find((n) => n.type === 'osc')!.id
    store().updateParams(id, { gain: 0.3 })
    release()
    store().updateParams(id, { gain: 0.6 })

    history().undo()
    expect((store().nodes.find((n) => n.id === id)!.data.params as { gain: number }).gain).toBe(0.3)
  })

  it('does not record a selection', () => {
    // Clicking around the canvas is not editing, and React Flow marks selection on the nodes.
    const id = store().nodes[0].id
    store().select(id)
    store().select(null)
    expect(history().canUndo).toBe(false)
  })

  it('undoes the die, which is the most destructive thing in the app', () => {
    const before = store()
      .nodes.map((n) => n.id)
      .join()
    store().randomisePatch()
    expect(
      store()
        .nodes.map((n) => n.id)
        .join(),
    ).not.toBe(before)

    history().undo()
    expect(
      store()
        .nodes.map((n) => n.id)
        .join(),
    ).toBe(before)
  })

  it('undoes a reset back to the patch that was replaced', () => {
    store().addNode('hold', { x: 5, y: 5 })
    const withHold = store().nodes.length
    store().resetPatch()
    history().undo()
    expect(store().nodes).toHaveLength(withHold)
  })

  it('restores tempo and loop, which belong to the patch', () => {
    // Read rather than assumed: the example patch runs at 300, which a hard-coded 120 got wrong.
    const started = store().bpm
    store().setBpm(145)
    store().setLoop(false)
    history().undo()
    expect(store().loop).toBe(true)
    history().undo()
    expect(store().bpm).toBe(started)
  })

  it('keeps cables through an undo, handles and all', () => {
    // A cable losing its handles is how a loaded patch once ended up wired to the wrong ports. What
    // is compared is what a cable *is* — ends, handles, kind — not how the object is spelled, since
    // undoing rebuilds it.
    const wiring = () =>
      store().edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        from: edge.sourceHandle ?? null,
        to: edge.targetHandle ?? null,
        kind: edge.data?.kind ?? null,
      }))
    const before = wiring()
    store().addNode('osc', { x: 1, y: 1 })
    history().undo()
    expect(wiring()).toEqual(before)
  })

  it('drops a selection pointing at a node that undoing removed', () => {
    store().addNode('osc', { x: 20, y: 20 })
    const added = store().nodes[store().nodes.length - 1].id
    store().select(added)
    history().undo()
    expect(store().selectedId).toBeNull()
  })

  it('makes the die safe to press on impulse, which is why it no longer asks first', () => {
    // The confirmation was the only protection and it was the wrong kind: a question people learn to
    // dismiss without reading, in front of the one action most worth doing without thinking.
    const before = JSON.stringify(store().nodes.map((n) => n.id))
    store().randomisePatch()
    store().randomisePatch()
    store().randomisePatch()

    history().undo()
    history().undo()
    history().undo()
    expect(JSON.stringify(store().nodes.map((n) => n.id))).toBe(before)
  })

  it('stops recording once torn down', () => {
    teardown()
    store().addNode('osc', { x: 0, y: 0 })
    expect(history().canUndo).toBe(false)
    // Re-armed so afterEach has something to close.
    teardown = installHistory()
  })
})
