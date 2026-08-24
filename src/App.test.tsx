import { MAX_LOAD } from './audio/load'
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

    // The wordmark is split into two spans so `_ON` can carry the cascade ramp, so what is asserted
    // is the name it spells rather than any one text node. Mixed case on purpose: the capitals are
    // presentation, applied by `text-transform`, and the document should still carry the real name.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Castill_ÓN')
    // Beside the heading and not inside it, so the page's accessible name stays the instrument's name
    // rather than becoming a version of it — but still real text, so a reader says it out loud.
    expect(screen.getByText('BETA')).toBeDefined()
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toContain('BETA')
    expect(screen.getByText('COLMENA / STROMBUS')).toBeDefined()
    // AGPL §13: anyone using the hosted app has to be able to reach its source.
    expect(screen.getByText('source')).toBeDefined()
    expect(screen.getByText('▶ PLAY')).toBeDefined()
    expect(screen.getByLabelText('Random patch')).toBeDefined()
    // The load meter, which lives in the canvas opposite the palette. Asserted because it once went
    // missing from the whole app during a move and every test still passed.
    expect(screen.getByTitle(new RegExp(`of ${MAX_LOAD}\\.`))).toBeDefined()

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
    const osc = usePatchStore.getState().nodes.find((n) => n.type === 'osc')!
    usePatchStore.getState().select(osc.id)

    render(<App />)
    const inspector = document.querySelector('.inspector') as HTMLElement
    expect(within(inspector).getByText('OSC')).toBeDefined()
    expect(within(inspector).getByText('Steps')).toBeDefined()
    expect(within(inspector).getByText('Division')).toBeDefined()
    expect(within(inspector).getByText('Propagation')).toBeDefined()
  })
})
