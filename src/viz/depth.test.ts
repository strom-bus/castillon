import { describe, expect, it } from 'vitest'
import { computeDepths, depthColor } from './depth'

const start = { id: 's', type: 'start' }
const osc = (id: string) => ({ id, type: 'osc4' })

describe('computeDepths', () => {
  it('mide la distancia al Start', () => {
    const { depths, max } = computeDepths(
      [start, osc('a'), osc('b')],
      [
        { source: 's', target: 'a' },
        { source: 'a', target: 'b' },
      ],
    )
    expect(depths.get('s')).toBe(0)
    expect(depths.get('a')).toBe(1)
    expect(depths.get('b')).toBe(2)
    expect(max).toBe(2)
  })

  it('las ramas hermanas comparten profundidad', () => {
    const { depths } = computeDepths(
      [start, osc('a'), osc('b'), osc('c')],
      [
        { source: 's', target: 'a' },
        { source: 'a', target: 'b' },
        { source: 'a', target: 'c' },
      ],
    )
    expect(depths.get('b')).toBe(1 + 1)
    expect(depths.get('c')).toBe(depths.get('b'))
  })

  it('cuando dos caminos llegan al mismo nodo manda el más corto', () => {
    const { depths } = computeDepths(
      [start, osc('a'), osc('b'), osc('c')],
      [
        { source: 's', target: 'a' },
        { source: 's', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'a', target: 'c' },
      ],
    )
    expect(depths.get('c')).toBe(2)
  })

  it('deja fuera los nodos que ningún Start alcanza', () => {
    const { depths } = computeDepths(
      [start, osc('a'), osc('huerfano')],
      [{ source: 's', target: 'a' }],
    )
    expect(depths.has('huerfano')).toBe(false)
  })

  it('no se cuelga con un ciclo', () => {
    const { depths, max } = computeDepths(
      [start, osc('a'), osc('b')],
      [
        { source: 's', target: 'a' },
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
    )
    expect(max).toBe(2)
    expect(depths.size).toBe(3)
  })
})

describe('depthColor', () => {
  it('arranca en verde y termina en rojo', () => {
    expect(depthColor(0, 4)).toBe('hsl(145 70% 55%)')
    expect(depthColor(4, 4)).toBe('hsl(0 70% 55%)')
  })

  it('pasa por el naranja a mitad de camino', () => {
    expect(depthColor(2, 4)).toBe('hsl(73 70% 55%)')
  })

  it('un grafo de un solo nivel se queda en verde', () => {
    expect(depthColor(0, 0)).toBe('hsl(145 70% 55%)')
  })
})
