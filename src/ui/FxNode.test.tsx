import { ReactFlowProvider } from '@xyflow/react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { depthToBits } from '../audio/dsp'
import { EFFECTS } from '../audio/effects'
import { diff, graphOf } from '../audio/router'
import { canConnect } from '../state/connections'
import { toPatch, usePatchStore } from '../state/patchStore'
import type { FxParams, OscParams } from '../types/patch'
import { Inspector } from './Inspector'
import { FxNode } from './nodes'

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

describe('the three states of an FX node', () => {
  function renderFx(id: string) {
    const { container } = render(
      <ReactFlowProvider>
        <FxNode
          id={id}
          data={usePatchStore.getState().nodes.find((n) => n.id === id)!.data}
          type="fx"
          selected={false}
          dragging={false}
          draggable
          selectable
          deletable
          zIndex={0}
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
        />
      </ReactFlowProvider>,
    )
    return container.querySelector('.node-fx') as HTMLElement
  }

  it('reads as idle with nothing attached', () => {
    const fx = addFx()
    expect(renderFx(fx).className).toContain('idle')
  })

  it('reads as wired once an oscillator reaches it', () => {
    const fx = addFx()
    wire(firstOsc(), fx)
    expect(renderFx(fx).className).toContain('wired')
  })

  it('goes back to idle when the cable is removed', () => {
    const fx = addFx()
    wire(firstOsc(), fx)
    const edge = usePatchStore.getState().edges.at(-1)!
    usePatchStore.getState().removeEdge(edge.id)
    expect(renderFx(fx).className).toContain('idle')
  })

  it('does not count an event cable as being wired', () => {
    // Nothing can draw one to an FX node, but the state must depend on audio and not on any cable.
    const fx = addFx()
    usePatchStore.setState((s) => ({
      edges: [
        ...s.edges,
        { id: 'bogus', source: firstOsc(), target: fx, type: 'cascade', data: { kind: 'event' } },
      ],
    }))
    expect(renderFx(fx).className).toContain('idle')
  })
})

describe('the FX inspector', () => {
  it('shows the same number the node shows, so the two agree', () => {
    const first = addFx()
    const second = addFx()

    usePatchStore.getState().select(first)
    const one = render(<Inspector />)
    expect(one.container.querySelector('.inspector-title')?.textContent?.trim()).toBe('FX 01')
    one.unmount()

    usePatchStore.getState().select(second)
    const two = render(<Inspector />)
    expect(two.container.querySelector('.inspector-title')?.textContent?.trim()).toBe('FX 02')
  })

  it('shows Mix for every effect, since every effect has it', () => {
    const fx = addFx()
    usePatchStore.getState().select(fx)

    for (const effect of EFFECTS) {
      usePatchStore.getState().updateParams(fx, { effect: effect.kind })
      const view = render(<Inspector />)
      expect(view.container.querySelector('[aria-label="Mix"]')).not.toBeNull()
      // What is specific to one effect sits below a line; Mix sits above it.
      expect(view.container.querySelector('.inspector-section')).not.toBeNull()
      view.unmount()
    }
  })

  it('shows only the controls the chosen effect declares', () => {
    const fx = addFx()
    usePatchStore.getState().select(fx)

    const shown = (effect: string) => {
      usePatchStore.getState().updateParams(fx, { effect: effect as never })
      const view = render(<Inspector />)
      // The label's own text node, so a unit suffix in a nested span does not run into the name.
      const labels = [...view.container.querySelectorAll('.inspector-label')].map((l) =>
        l.firstChild?.textContent?.trim(),
      )
      view.unmount()
      return labels
    }

    expect(shown('reverb')).toContain('Decay')
    expect(shown('reverb')).not.toContain('Drive')
    expect(shown('drive')).toContain('Drive')
    expect(shown('drive')).not.toContain('Decay')
    expect(shown('crush')).toContain('Bits')
    // Every effect gets the shared tone control.
    for (const effect of EFFECTS) expect(shown(effect.kind)).toContain('Tone')
  })

  it('falls back rather than breaking on an effect this build does not have', () => {
    // 'gain' existed while the routing was being proven and was removed once it had served. A
    // patch naming it, or any effect from a later build, has to still open.
    const fx = addFx()
    usePatchStore.getState().updateParams(fx, { effect: 'chorus' as never })
    usePatchStore.getState().select(fx)

    const { container } = render(<Inspector />)
    expect(container.querySelector('[aria-label="Mix"]')).not.toBeNull()
  })

  it('syncs the echo to the transport, so a tempo change reaches it', () => {
    const fx = addFx()
    usePatchStore.getState().updateParams(fx, { effect: 'echo' })
    const before = graphOf(toPatch())

    usePatchStore.getState().setBpm(200)
    const ops = diff(before, graphOf(toPatch()))

    // Nothing about the effect itself changed; the tempo did, and its delay time derives from it.
    expect(ops.map((o) => o.op)).toEqual(['updateEffect'])
  })

  it('sets bit depth in bits while the patch stores it normalised', () => {
    const fx = addFx()
    usePatchStore.getState().updateParams(fx, { effect: 'crush' })
    usePatchStore.getState().select(fx)
    render(<Inspector />)

    fireEvent.change(screen.getByLabelText('Bits'), { target: { value: '6' } })
    const depth = (usePatchStore.getState().nodes.find((n) => n.id === fx)!.data.params as FxParams)
      .depth
    expect(depthToBits(depth)).toBe(6)
  })

  it('offers only effects that are actually built', () => {
    // EffectKind names every effect planned; EFFECTS holds the ones with a chain behind them.
    // Offering one without the other would put a dead option in front of the user.
    usePatchStore.getState().select(addFx())
    const { container } = render(<Inspector />)

    const offered = [...container.querySelectorAll('option')].map((o) => o.textContent)
    expect(offered).toEqual(EFFECTS.map((e) => e.label))
  })

  it('changes the mix without rewiring anything', () => {
    const fx = addFx()
    usePatchStore.getState().select(fx)
    render(<Inspector />)

    const before = graphOf(toPatch())
    fireEvent.change(screen.getByLabelText('Mix'), { target: { value: '0.3' } })

    const ops = diff(before, graphOf(toPatch()))
    expect(ops.map((o) => o.op)).toEqual(['updateEffect'])
    expect(
      (usePatchStore.getState().nodes.find((n) => n.id === fx)!.data.params as FxParams).mix,
    ).toBeCloseTo(0.3, 2)
  })
})

describe('Direct on the oscillator', () => {
  it('defaults to the whole signal, which is what an oscillator with no effects does', () => {
    const params = usePatchStore.getState().nodes.find((n) => n.type === 'osc')!.data
      .params as OscParams
    expect(params.direct).toBe(1)
  })

  it('is a mix change and nothing more', () => {
    const osc = firstOsc()
    usePatchStore.getState().select(osc)
    render(<Inspector />)

    const before = graphOf(toPatch())
    fireEvent.change(screen.getByLabelText('Direct'), { target: { value: '0' } })

    expect(diff(before, graphOf(toPatch()))).toEqual([{ op: 'setDirect', id: osc, value: 0 }])
  })
})
