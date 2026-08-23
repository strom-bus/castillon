import { ModNode } from './nodes'
import { fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { canConnect, EVENT_IN, EVENT_OUT } from '../state/connections'
import { usePatchStore } from '../state/patchStore'
import type { ModParams } from '../types/patch'
import { Canvas } from './Canvas'
import { Inspector } from './Inspector'

/**
 * The MOD module as it is met: that it can be added, that it only accepts the cables it should, and
 * that its panel offers what the thing it is wired to actually has.
 */

beforeEach(() => usePatchStore.getState().resetPatch())

const store = () => usePatchStore.getState()

function addMod(): string {
  store().addNode('mod', { x: 0, y: 0 })
  return store().nodes[store().nodes.length - 1].id
}

describe('the MOD module', () => {
  it('is in the palette', () => {
    render(
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>,
    )
    expect(screen.getByText('+ MOD')).toBeDefined()
  })

  it('arrives as a slow sine on Level', () => {
    const id = addMod()
    const params = store().nodes.find((n) => n.id === id)!.data.params as ModParams
    expect(params).toMatchObject({ target: 'level', kind: 'lfo', wave: 'sine' })
    expect(params.rate).toBeGreaterThan(0)
  })

  it('may be wired to an oscillator or an effect, and nothing else', () => {
    const mod = addMod()
    store().addNode('fx', { x: 40, y: 0 })
    const fx = store().nodes[store().nodes.length - 1].id
    const osc = store().nodes.find((n) => n.type === 'osc')!.id
    const ignite = store().nodes.find((n) => n.type === 'start')!.id
    const rules = { nodes: store().nodes, edges: store().edges }
    const attempt = (source: string, target: string) => ({
      source,
      target,
      sourceHandle: 'signal-l',
      targetHandle: 'signal-l',
    })

    expect(canConnect(rules, attempt(mod, osc))).toBe(true)
    expect(canConnect(rules, attempt(mod, fx))).toBe(true)
    expect(canConnect(rules, attempt(mod, ignite))).toBe(false)
  })

  it('is made the source when the cable is drawn from the oscillator instead', () => {
    // Modulation only runs one way, so a drag the other way can only have meant this one. Refusing
    // it was the first behaviour and it was needlessly strict.
    const mod = addMod()
    const osc = store().nodes.find((n) => n.type === 'osc')!.id
    store().onConnect({
      source: osc,
      target: mod,
      sourceHandle: 'signal-l',
      targetHandle: 'signal-l',
    })

    const edge = store().edges.find((e) => e.data?.kind === 'mod')
    expect(edge?.source).toBe(mod)
    expect(edge?.target).toBe(osc)
  })

  it('cannot mix a modulation port with an audio one', () => {
    // The kind comes from the handles, and two kinds are not a cable.
    const mod = addMod()
    const fx = store().nodes.find((n) => n.type === 'fx')?.id ?? mod
    const rules = { nodes: store().nodes, edges: store().edges }
    expect(
      canConnect(rules, {
        source: mod,
        target: fx,
        sourceHandle: 'signal-l',
        targetHandle: 'signal-l',
      }),
    ).toBe(false)
  })

  it('offers only Level once wired to an oscillator', () => {
    const mod = addMod()
    const osc = store().nodes.find((n) => n.type === 'osc')!.id
    store().onConnect({
      source: mod,
      target: osc,
      sourceHandle: 'signal-l',
      targetHandle: 'signal-l',
    })
    store().select(mod)

    render(<Inspector />)
    const options = screen.getAllByRole('option').map((option) => option.textContent)
    expect(options).toContain('Level')
    expect(options).not.toContain('Mix')
  })

  it('says where to wire it while it is not wired to anything', () => {
    store().select(addMod())
    render(<Inspector />)
    expect(screen.getByText(/Wire it to the side/)).toBeDefined()
  })

  it('changes its rate from the panel', () => {
    const mod = addMod()
    store().select(mod)
    render(<Inspector />)

    const slider = screen.getByLabelText('Rate') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '6' } })
    expect((store().nodes.find((n) => n.id === mod)!.data.params as ModParams).rate).toBe(6)
  })
})

describe('the event ports', () => {
  /** A MOD of a given kind on the canvas, plus optionally a trigger wired into it. */
  function place(kind: 'lfo' | 'env', triggered = false) {
    const store = usePatchStore.getState()
    store.addNode('mod', { x: 0, y: 0 })
    const mod = usePatchStore.getState().nodes.at(-1)!
    usePatchStore.getState().updateParams(mod.id, { kind })

    if (triggered) {
      const ignite = usePatchStore.getState().nodes.find((n) => n.type === 'start')!
      usePatchStore.getState().onConnect({
        source: ignite.id,
        target: mod.id,
        sourceHandle: EVENT_OUT,
        targetHandle: EVENT_IN,
      })
    }
    return mod.id
  }

  const portsOn = (id: string) => {
    const node = document.querySelector(`[data-id="${id}"]`) ?? document.body
    return {
      top: node.querySelector('.port-in') !== null,
      bottom: node.querySelector('.port-out') !== null,
    }
  }

  it('are hidden on an LFO, where a trigger would mean nothing', () => {
    // The first thing anybody asked about them was what they were for, and on an LFO the honest answer
    // is nothing: it keeps its own clock. A visible port that does not respond is worse than no port.
    const id = place('lfo')
    render(
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>,
    )
    expect(portsOn(id)).toEqual({ top: false, bottom: false })
  })

  it('appear on an envelope, which cannot run without one', () => {
    const id = place('env')
    render(
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>,
    )
    expect(portsOn(id)).toEqual({ top: true, bottom: true })
  })

  it('stay while a cable is attached, whatever the kind says', () => {
    // Switching an envelope back to an LFO must not take away the port a cable was drawn to.
    const id = place('env', true)
    usePatchStore.getState().updateParams(id, { kind: 'lfo' })
    render(
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>,
    )
    expect(portsOn(id)).toEqual({ top: true, bottom: true })
  })
})

/**
 * That a modulator says which kind it is, and not only shows the consequence.
 *
 * Two envelopes with the same target read identically on the canvas while having visibly different
 * shapes: one waits for a trigger and carries ports to take one, the other runs on every note and has
 * none. The ports were the only clue, and they are downstream of a setting the node never mentioned —
 * which is how it came to look like the dice was producing two different things at random.
 */
describe('what a modulator says about itself', () => {
  function showMod(params: ModParams): string {
    const store = usePatchStore.getState()
    store.addNode('mod', { x: 0, y: 0 })
    const mod = usePatchStore.getState().nodes.at(-1)!
    usePatchStore.getState().updateParams(mod.id, params)

    const { container } = render(
      <ReactFlowProvider>
        <ModNode
          id={mod.id}
          data={{
            params: usePatchStore.getState().nodes.find((n) => n.id === mod.id)!.data.params,
          }}
          selected={false}
          type="mod"
          dragging={false}
          zIndex={0}
          isConnectable
          draggable
          selectable
          deletable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
        />
      </ReactFlowProvider>,
    )
    return container.querySelector('.node-meta')?.textContent ?? ''
  }

  it('tells an envelope waiting for a trigger from one running on every note', () => {
    const onTrigger = showMod({ kind: 'env', fires: 'trigger', target: 'level' })
    const onNote = showMod({ kind: 'env', fires: 'note', target: 'level' })

    expect(onTrigger).not.toBe(onNote)
    expect(onNote).toMatch(/note/)
    expect(onTrigger).toMatch(/trig/)
  })

  it('says nothing about firing on an LFO, which has no firing to report', () => {
    // Its clock is its own, so the question does not arise — and answering it anyway would put a word
    // on the node that means nothing there.
    const lfo = showMod({ kind: 'lfo', rate: 2, target: 'level' })
    expect(lfo).not.toMatch(/note|trig/)
  })
})
