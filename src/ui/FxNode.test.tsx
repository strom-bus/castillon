import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { EFFECTS } from '../audio/effects'
import { diff, graphOf } from '../audio/router'
import { canConnect } from '../state/connections'
import { toPatch, usePatchStore } from '../state/patchStore'
import type { FxParams, OscParams } from '../types/patch'
import { Inspector } from './Inspector'

function addFx(): string {
  usePatchStore.getState().addNode('fx', { x: 700, y: 200 })
  return usePatchStore.getState().nodes.at(-1)!.id
}

function firstOsc(): string {
  return usePatchStore.getState().nodes.find((n) => n.type === 'osc')!.id
}

function wire(from: string, to: string) {
  usePatchStore
    .getState()
    .onConnect({ source: from, target: to, sourceHandle: 'audio-r', targetHandle: 'audio-l' })
}

beforeEach(() => {
  usePatchStore.getState().resetPatch()
})

describe('wiring an effect to an oscillator', () => {
  it('records it as an audio cable, drawn with the signal component', () => {
    const fx = addFx()
    wire(firstOsc(), fx)

    const edge = usePatchStore.getState().edges.at(-1)!
    expect(edge.data?.kind).toBe('audio')
    expect(edge.type).toBe('signal')
  })

  it('turns into a create-then-connect pair for the engine', () => {
    const fx = addFx()
    const before = graphOf(toPatch())
    wire(firstOsc(), fx)

    const ops = diff(before, graphOf(toPatch()))
    expect(ops.map((o) => o.op)).toEqual(['connect'])
  })

  it('rejects a second cable from the oscillator’s other side', () => {
    const fx = addFx()
    const osc = firstOsc()
    wire(osc, fx)

    const { nodes, edges } = usePatchStore.getState()
    expect(
      canConnect(
        { nodes, edges },
        { source: osc, target: fx, sourceHandle: 'audio-l', targetHandle: 'audio-r' },
      ),
    ).toBe(false)
  })

  it('takes several effects on one oscillator', () => {
    const osc = firstOsc()
    const a = addFx()
    const b = addFx()
    wire(osc, a)
    wire(osc, b)

    expect([...graphOf(toPatch()).sends].sort()).toEqual([`${osc}>${a}`, `${osc}>${b}`].sort())
  })

  it('takes one effect fed by several oscillators', () => {
    const fx = addFx()
    const [a, b] = usePatchStore.getState().nodes.filter((n) => n.type === 'osc')
    wire(a.id, fx)
    wire(b.id, fx)

    expect(graphOf(toPatch()).sends.size).toBe(2)
  })
})

describe('the FX inspector', () => {
  it('offers only effects that are actually built', () => {
    // EffectKind names every effect planned; EFFECTS holds the ones with a chain behind them.
    // Offering one without the other would put a dead option in front of the user.
    usePatchStore.getState().select(addFx())
    const { container } = render(<Inspector />)

    const offered = [...container.querySelectorAll('option')].map((o) => o.textContent)
    expect(offered).toEqual(EFFECTS.map((e) => e.label))
  })

  it('changes the level without rewiring anything', () => {
    const fx = addFx()
    usePatchStore.getState().select(fx)
    render(<Inspector />)

    const before = graphOf(toPatch())
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: '0.3' } })

    const ops = diff(before, graphOf(toPatch()))
    expect(ops.map((o) => o.op)).toEqual(['updateEffect'])
    expect(
      (usePatchStore.getState().nodes.find((n) => n.id === fx)!.data.params as FxParams).level,
    ).toBeCloseTo(0.3, 2)
  })
})

describe('Direct on the oscillator', () => {
  it('defaults to the whole signal, which is what an oscillator with no effects does', () => {
    const params = usePatchStore.getState().nodes.find((n) => n.type === 'osc')!.data
      .params as OscParams
    expect(params.direct).toBe(1)
  })

  it('is a level change and nothing more', () => {
    const osc = firstOsc()
    usePatchStore.getState().select(osc)
    render(<Inspector />)

    const before = graphOf(toPatch())
    fireEvent.change(screen.getByLabelText('Direct'), { target: { value: '0' } })

    expect(diff(before, graphOf(toPatch()))).toEqual([{ op: 'setDirect', id: osc, value: 0 }])
  })
})
