import { beforeEach, describe, expect, it } from 'vitest'
import type { FxParams, OscParams } from '../types/patch'
import { usePatchStore } from './patchStore'

const state = () => usePatchStore.getState()

function select(...ids: string[]) {
  const chosen = new Set(ids)
  usePatchStore.setState((s) => ({
    nodes: s.nodes.map((n) => ({ ...n, selected: chosen.has(n.id) })),
    selectedId: ids[0] ?? null,
  }))
}

const oscs = () => state().nodes.filter((n) => n.type === 'osc')
const paramsOf = (id: string) => state().nodes.find((n) => n.id === id)!.data.params as OscParams

beforeEach(() => {
  usePatchStore.getState().resetPatch()
})

describe('copying and pasting a node', () => {
  it('brings the parameters with it', () => {
    const source = oscs()[0]
    usePatchStore.getState().updateParams(source.id, { waveform: 'brown', gain: 0.42 })
    select(source.id)

    state().copySelection()
    state().pasteClipboard()

    const copy = oscs().at(-1)!
    expect(copy.id).not.toBe(source.id)
    expect((copy.data.params as OscParams).waveform).toBe('brown')
    expect((copy.data.params as OscParams).gain).toBeCloseTo(0.42, 2)
    expect((copy.data.params as OscParams).steps.map((s) => s.note)).toEqual(
      paramsOf(source.id).steps.map((s) => s.note),
    )
  })

  it('clones the sequence rather than sharing it', () => {
    // A sequence is an array. A shallow copy would leave both oscillators editing one, and every
    // note change would hit both.
    const source = oscs()[0]
    select(source.id)
    state().copySelection()
    state().pasteClipboard()
    const copy = oscs().at(-1)!

    state().updateStep(source.id, 0, { note: 30 })
    expect((copy.data.params as OscParams).steps[0].note).not.toBe(30)
  })

  it('is not disturbed by the original being deleted afterwards', () => {
    const source = oscs()[0]
    select(source.id)
    state().copySelection()
    usePatchStore.setState((s) => ({ nodes: s.nodes.filter((n) => n.id !== source.id) }))

    state().pasteClipboard()
    expect(oscs().length).toBeGreaterThan(0)
  })

  it('lands clear of what it came from, and of the paste before it', () => {
    const source = oscs()[0]
    const origin = source.position
    select(source.id)
    state().copySelection()

    state().pasteClipboard()
    const first = oscs().at(-1)!.position
    state().pasteClipboard()
    const second = oscs().at(-1)!.position

    expect(first).not.toEqual(origin)
    expect(second).not.toEqual(first)
  })

  it('leaves the paste selected, so it can be dragged into place', () => {
    const source = oscs()[0]
    select(source.id)
    state().copySelection()
    state().pasteClipboard()

    const pasted = state().nodes.at(-1)!
    expect(pasted.selected).toBe(true)
    expect(state().selectedId).toBe(pasted.id)
    // And the node it came from is no longer selected, or dragging would move both.
    expect(state().nodes.find((n) => n.id === source.id)!.selected).toBe(false)
  })
})

describe('copying more than one node', () => {
  it('brings the cables between them', () => {
    const [a, b] = oscs()
    const cable = state().edges.find((e) => e.source === a.id && e.target === b.id)
    // The starting patch wires its first oscillator to its second.
    expect(cable).toBeDefined()

    select(a.id, b.id)
    const before = state().edges.length
    state().copySelection()
    state().pasteClipboard()

    expect(state().edges).toHaveLength(before + 1)
    const added = state().edges.at(-1)!
    // Rewired to the copies, not left pointing at the originals.
    expect(added.source).not.toBe(a.id)
    expect(added.target).not.toBe(b.id)
  })

  it('leaves behind a cable reaching outside the selection', () => {
    // Copying one end of a cable cannot bring the cable, or the paste would wire itself to a node
    // that was never copied.
    const [a, b] = oscs()
    select(b.id)
    const before = state().edges.length

    state().copySelection()
    state().pasteClipboard()
    // A node arrived, but no cable: the one that fed it was left where it was.
    expect(state().edges).toHaveLength(before)
    expect(state().nodes.at(-1)!.id).not.toBe(a.id)
  })

  it('copies an effect with its oscillator, cable and all', () => {
    const osc = oscs()[0]
    usePatchStore.getState().addNode('fx', { x: 900, y: 200 })
    const fx = state().nodes.at(-1)!
    usePatchStore.getState().setEffect(fx.id, 'crush')
    usePatchStore.getState().onConnect({
      source: osc.id,
      target: fx.id,
      sourceHandle: 'audio-r',
      targetHandle: 'audio-l',
    })

    select(osc.id, fx.id)
    state().copySelection()
    state().pasteClipboard()

    const copiedFx = state()
      .nodes.filter((n) => n.type === 'fx')
      .at(-1)!
    expect(copiedFx.id).not.toBe(fx.id)
    expect((copiedFx.data.params as FxParams).effect).toBe('crush')
    // The audio cable comes too, pointing at the copies.
    const audio = state().edges.filter((e) => e.data?.kind === 'audio')
    expect(audio).toHaveLength(2)
    expect(audio.at(-1)!.target).toBe(copiedFx.id)
  })
})

describe('when there is nothing to do', () => {
  it('copying nothing keeps whatever was on the clipboard', () => {
    const source = oscs()[0]
    select(source.id)
    state().copySelection()

    select()
    state().copySelection()
    state().pasteClipboard()

    // The earlier copy is still there rather than having been wiped by an empty selection.
    expect(oscs().length).toBeGreaterThan(5)
  })

  it('pasting an empty clipboard changes nothing', () => {
    usePatchStore.setState({ clipboard: null })
    const before = state().nodes.length
    state().pasteClipboard()
    expect(state().nodes).toHaveLength(before)
  })

  it('carries a node across into another patch', () => {
    // Deliberate: roll the dice, find an oscillator worth keeping, roll again, paste it in. The
    // clipboard outliving the patch it came from is what makes that possible.
    const source = oscs()[0]
    usePatchStore.getState().updateParams(source.id, { waveform: 'ramp', gain: 0.37 })
    select(source.id)
    state().copySelection()

    usePatchStore.getState().randomisePatch()
    const before = state().nodes.length
    state().pasteClipboard()

    expect(state().nodes).toHaveLength(before + 1)
    const pasted = state().nodes.at(-1)!
    expect((pasted.data.params as OscParams).waveform).toBe('ramp')
  })

  it('falls back to the inspector selection when the canvas has none', () => {
    // Clicking a node in the canvas marks it; loading a patch and picking one in the panel does not.
    const source = oscs()[0]
    usePatchStore.setState({ selectedId: source.id })
    const before = oscs().length

    state().copySelection()
    state().pasteClipboard()
    expect(oscs()).toHaveLength(before + 1)
  })
})
