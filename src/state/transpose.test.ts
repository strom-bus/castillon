/**
 * What the canvas has to say before it is asked (PLAN §18.18).
 *
 * A transform reaches its whole branch, which is the point of it and also the danger: an oscillator
 * three levels down sounds moved with nothing on it saying why. A delay has the same reach and gets away
 * with it, because a shift in time is heard from where it came — a shift in pitch is silent about its
 * cause. So each affected node is told what is happening to it, and this is the arithmetic behind that.
 */

import { describe, expect, it } from 'vitest'
import { transformDoingNothing, transposeByNode } from './transpose'
import type { PatchEdge, PatchNode } from '../types/patch'

const node = (id: string, type: string, transpose?: number): PatchNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  params: transpose === undefined ? {} : { transpose },
})

const edge = (source: string, target: string, kind: PatchEdge['kind'] = 'event'): PatchEdge => ({
  id: `${source}->${target}`,
  kind,
  source,
  target,
})

const shift = (source: string, target: string): PatchEdge => ({
  id: `${source}~${target}`,
  kind: 'shift',
  source,
  target,
})

describe('what each node is being moved by', () => {
  it('is nothing at all in a patch with no transform in it', () => {
    const table = transposeByNode([node('s', 'start'), node('a', 'osc')], [edge('s', 'a')])
    expect(table.get('a') ?? 0).toBe(0)
  })

  it('reaches what it is attached to, and everything below that', () => {
    // From where it is wired, downward — and that includes where it is wired.
    const table = transposeByNode(
      [node('s', 'start'), node('t', 'transform', 3), node('a', 'osc'), node('b', 'osc')],
      [edge('s', 'a'), edge('a', 'b'), shift('t', 'a')],
    )
    expect(table.get('a')).toBe(3)
    expect(table.get('b')).toBe(3)
  })

  it('leaves what is beside it alone', () => {
    const table = transposeByNode(
      [node('s', 'start'), node('t', 'transform', 3), node('a', 'osc'), node('b', 'osc')],
      [edge('s', 'a'), edge('s', 'b'), shift('t', 'a')],
    )
    expect(table.get('a')).toBe(3)
    expect(table.get('b') ?? 0).toBe(0)
  })

  it('takes a whole cascade when it is on the Ignite', () => {
    // The thing that was impossible before without standing directly under one.
    const table = transposeByNode(
      [node('s', 'start'), node('t', 'transform', 5), node('a', 'osc'), node('b', 'osc')],
      [edge('s', 'a'), edge('a', 'b'), shift('t', 's')],
    )
    expect(table.get('a')).toBe(5)
    expect(table.get('b')).toBe(5)
  })

  it('adds two on the same node together rather than letting one win', () => {
    const table = transposeByNode(
      [node('s', 'start'), node('t', 'transform', 2), node('u', 'transform', 5), node('a', 'osc')],
      [edge('s', 'a'), shift('t', 'a'), shift('u', 'a')],
    )
    expect(table.get('a')).toBe(7)
  })

  it('adds one up the branch to one further down it', () => {
    const table = transposeByNode(
      [
        node('s', 'start'),
        node('t', 'transform', 2),
        node('u', 'transform', 5),
        node('a', 'osc'),
        node('b', 'osc'),
      ],
      [edge('s', 'a'), edge('a', 'b'), shift('t', 'a'), shift('u', 'b')],
    )
    expect(table.get('a')).toBe(2)
    expect(table.get('b')).toBe(7)
  })

  it('returns rather than hanging on a patch that loops back on itself', () => {
    // A reader of a cycle should get a drawing, not a frozen tab.
    const table = transposeByNode(
      [node('s', 'start'), node('t', 'transform', 1), node('a', 'osc'), node('b', 'osc')],
      [edge('s', 'a'), edge('a', 'b'), edge('b', 'a'), shift('t', 'a')],
    )
    expect(table.get('a')).toBe(1)
  })
})

/**
 * Why a transform may be doing nothing.
 *
 * A much shorter question than it used to be. Standing in the cascade, one could be wired beside the
 * cable it was meant to replace instead of in place of it, and then the node below fired twice with the
 * untransposed pass masking the moved one. Attached to a node, that failure cannot be built: there is no
 * cable to go around.
 */
describe('why a transform may be doing nothing', () => {
  it('says so when it is attached to nothing', () => {
    const why = transformDoingNothing(
      [node('s', 'start'), node('a', 'osc'), node('t', 'transform', 5)],
      [edge('s', 'a')],
      't',
    )
    expect(why).toMatch(/not attached/)
  })

  it('says so when there is no note below what it is on', () => {
    const why = transformDoingNothing(
      [node('s', 'start'), node('d', 'delay'), node('t', 'transform', 5)],
      [edge('s', 'd'), shift('t', 'd')],
      't',
    )
    expect(why).toMatch(/makes a note/)
  })

  it('is quiet on an oscillator', () => {
    const why = transformDoingNothing(
      [node('s', 'start'), node('a', 'osc'), node('t', 'transform', 5)],
      [edge('s', 'a'), shift('t', 'a')],
      't',
    )
    expect(why).toBeNull()
  })

  it('is quiet on an Ignite with a cascade under it', () => {
    const why = transformDoingNothing(
      [node('s', 'start'), node('a', 'osc'), node('t', 'transform', 5)],
      [edge('s', 'a'), shift('t', 's')],
      't',
    )
    expect(why).toBeNull()
  })
})
