import { describe, expect, it } from 'vitest'
import { colorAt, computeDepths, depthColor } from './depth'

const start = { id: 's', type: 'start' }
const osc = (id: string) => ({ id, type: 'osc4' })

describe('computeDepths', () => {
  it('measures the distance to Start', () => {
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

  it('sibling branches share a depth', () => {
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

  it('when two paths reach the same node the shortest wins', () => {
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

  it('leaves out nodes no Start can reach', () => {
    const { depths } = computeDepths(
      [start, osc('a'), osc('orphan')],
      [{ source: 's', target: 'a' }],
    )
    expect(depths.has('orphan')).toBe(false)
  })

  it('does not hang on a cycle', () => {
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
  it('starts green and ends red', () => {
    expect(depthColor(0, 4)).toBe('hsl(145.0 72% 55%)')
    expect(depthColor(4, 4)).toBe('hsl(0.0 72% 55%)')
  })

  it('passes through yellow-green halfway', () => {
    expect(depthColor(2, 4)).toBe('hsl(72.5 72% 55%)')
  })

  it('a single-level graph stays green', () => {
    expect(depthColor(0, 0)).toBe('hsl(145.0 72% 55%)')
  })

  it('sweeps continuously, not one flat colour per level', () => {
    // A node covers the first part of its level and its cable the rest, so the hue keeps
    // moving between whole depths instead of stepping.
    const quarter = colorAt(0.25)
    const third = colorAt(0.3)
    expect(quarter).not.toBe(third)
    expect(colorAt(-1)).toBe(colorAt(0))
    expect(colorAt(9)).toBe(colorAt(1))
  })
})
