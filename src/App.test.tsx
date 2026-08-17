import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { usePatchStore } from './state/patchStore'

/**
 * Prueba de arranque: monta la app entera. No comprueba estética, comprueba que el lienzo,
 * los nodos y el transporte se montan sin reventar — que es lo que un build verde no garantiza.
 */
describe('App', () => {
  it('monta el transporte, el lienzo y el patch inicial', () => {
    render(<App />)

    expect(screen.getByText('CASTILLÓN')).toBeDefined()
    expect(screen.getByText('▶ PLAY')).toBeDefined()
    expect(screen.getByText('PÁNICO')).toBeDefined()

    // El patch inicial: un Start y tres osciladores.
    expect(screen.getByText('START')).toBeDefined()
    expect(screen.getAllByText('OSC 4')).toHaveLength(3)
  })

  it('pinta las cuatro barras de cada secuenciador con sus notas', () => {
    const { container } = render(<App />)
    const steps = container.querySelectorAll('.step-track')
    // 3 osciladores x 4 pasos.
    expect(steps).toHaveLength(12)
    expect(screen.getAllByText('C3').length).toBeGreaterThan(0)
  })

  it('el inspector muestra los parámetros del nodo seleccionado', () => {
    const osc = usePatchStore.getState().nodes.find((n) => n.type === 'osc4')!
    usePatchStore.getState().select(osc.id)

    render(<App />)
    const inspector = document.querySelector('.inspector') as HTMLElement
    expect(within(inspector).getByText('OSC 4')).toBeDefined()
    expect(within(inspector).getByText('División')).toBeDefined()
    expect(within(inspector).getByText('Propagación')).toBeDefined()
  })
})
