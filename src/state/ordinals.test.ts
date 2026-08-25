import { describe, expect, it } from 'vitest'
import { formatOrdinal, nodeOrdinal } from './ordinals'

const nodes = [
  { id: 's1', type: 'start' },
  { id: 'a', type: 'osc' },
  { id: 'f1', type: 'fx' },
  { id: 'b', type: 'osc' },
  { id: 's2', type: 'start' },
  { id: 'c', type: 'osc' },
  { id: 'f2', type: 'fx' },
]

describe('nodeOrdinal', () => {
  it('counts within a kind, not across the patch', () => {
    expect(nodeOrdinal(nodes, 'a')).toBe(1)
    expect(nodeOrdinal(nodes, 'b')).toBe(2)
    expect(nodeOrdinal(nodes, 'c')).toBe(3)
    // Effects and ignites each start again at one.
    expect(nodeOrdinal(nodes, 'f1')).toBe(1)
    expect(nodeOrdinal(nodes, 'f2')).toBe(2)
    expect(nodeOrdinal(nodes, 's1')).toBe(1)
    expect(nodeOrdinal(nodes, 's2')).toBe(2)
  })

  it('is unmoved by nodes of other kinds sitting in between', () => {
    const padded = [{ id: 'x', type: 'hold' }, ...nodes, { id: 'y', type: 'hold' }]
    expect(nodeOrdinal(padded, 'b')).toBe(2)
  })

  it('closes the gap when an earlier node of the same kind goes', () => {
    // The cost of deriving instead of storing, and the reason the numbers stay dense.
    const without = nodes.filter((n) => n.id !== 'a')
    expect(nodeOrdinal(without, 'b')).toBe(1)
    expect(nodeOrdinal(without, 'c')).toBe(2)
  })

  it('returns zero for a node that is not there', () => {
    expect(nodeOrdinal(nodes, 'ghost')).toBe(0)
  })
})

describe('formatOrdinal', () => {
  it('pads to two digits so a column lines up', () => {
    expect(formatOrdinal(1)).toBe('01')
    expect(formatOrdinal(9)).toBe('09')
    expect(formatOrdinal(10)).toBe('10')
  })

  it('grows rather than truncating past ninety-nine', () => {
    expect(formatOrdinal(120)).toBe('120')
  })
})
