import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { usePatchStore } from './state/patchStore'

/**
 * Boot test: mounts the whole app. It checks nothing about looks — only that the canvas, the
 * nodes and the transport mount without blowing up, which a green build does not guarantee.
 */
describe('App', () => {
  it('mounts the transport, the canvas and the starting patch', () => {
    render(<App />)

    expect(screen.getByText('Castill_ON')).toBeDefined()
    expect(screen.getByText('COLMENA')).toBeDefined()
    expect(screen.getByText('▶ PLAY')).toBeDefined()

    // The starting patch: two independent cascades, five oscillators and a delay.
    expect(screen.getAllByText('IGNITE')).toHaveLength(2)
    expect(screen.getAllByText('OSC')).toHaveLength(5)
    expect(screen.getByText('DELAY')).toBeDefined()
  })

  it('draws each sequencer four bars with their notes', () => {
    const { container } = render(<App />)
    const steps = container.querySelectorAll('.step-track')
    // 5 oscillators x 4 steps.
    expect(steps).toHaveLength(20)
    expect(screen.getAllByText('C3').length).toBeGreaterThan(0)
  })

  it('the inspector shows the selected node params', () => {
    const osc = usePatchStore.getState().nodes.find((n) => n.type === 'osc4')!
    usePatchStore.getState().select(osc.id)

    render(<App />)
    const inspector = document.querySelector('.inspector') as HTMLElement
    expect(within(inspector).getByText('OSC')).toBeDefined()
    expect(within(inspector).getByText('Steps')).toBeDefined()
    expect(within(inspector).getByText('Division')).toBeDefined()
    expect(within(inspector).getByText('Propagation')).toBeDefined()
  })
})
