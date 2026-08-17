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

    expect(screen.getByText('CASTILLÓN')).toBeDefined()
    expect(screen.getByText('▶ PLAY')).toBeDefined()
    expect(screen.getByText('PANIC')).toBeDefined()

    // The starting patch: one Start and three oscillators.
    expect(screen.getByText('START')).toBeDefined()
    expect(screen.getAllByText('OSC 4')).toHaveLength(3)
  })

  it('draws each sequencer four bars with their notes', () => {
    const { container } = render(<App />)
    const steps = container.querySelectorAll('.step-track')
    // 3 oscillators x 4 steps.
    expect(steps).toHaveLength(12)
    expect(screen.getAllByText('C3').length).toBeGreaterThan(0)
  })

  it('the inspector shows the selected node params', () => {
    const osc = usePatchStore.getState().nodes.find((n) => n.type === 'osc4')!
    usePatchStore.getState().select(osc.id)

    render(<App />)
    const inspector = document.querySelector('.inspector') as HTMLElement
    expect(within(inspector).getByText('OSC 4')).toBeDefined()
    expect(within(inspector).getByText('Division')).toBeDefined()
    expect(within(inspector).getByText('Propagation')).toBeDefined()
  })
})
