import { fireEvent, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { canConnect } from '../state/connections'
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
