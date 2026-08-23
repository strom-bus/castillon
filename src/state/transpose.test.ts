/**
 * What the canvas has to say before it is asked (PLAN §18.18).
 *
 * A transform reaches its whole branch, which is the point of it and also the danger: an oscillator
 * three levels down sounds moved with nothing on it saying why. A delay has the same reach and gets away
 * with it, because a shift in time is heard from where it came — a shift in pitch is silent about its
 * cause. So each affected node is told what is happening to it, and this is the arithmetic behind that.
 */

import { describe, expect, it } from 'vitest'
import { transposeByNode } from './transpose'
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

describe('what each node is being moved by', () => {
  it('is nothing at all in a patch with no transform in it', () => {
    const table = transposeByNode([node('s', 'start'), node('a', 'osc')], [edge('s', 'a')])
    expect(table.get('a') ?? 0).toBe(0)
  })

  it('reaches everything below the transform', () => {
    // Below, and all the way down: a branch is what hangs off it rather than the next node.
    const table = transposeByNode(
      [node('s', 'start'), node('t', 'transform', 3), node('a', 'osc'), node('b', 'osc')],
      [edge('s', 't'), edge('t', 'a'), edge('a', 'b')],
    )
    expect(table.get('a')).toBe(3)
    expect(table.get('b')).toBe(3)
  })

  it('leaves what is beside it alone', () => {
    const table = transposeByNode(
      [node('s', 'start'), node('t', 'transform', 3), node('a', 'osc'), node('b', 'osc')],
      [edge('s', 't'), edge('t', 'a'), edge('s', 'b')],
    )
    expect(table.get('a')).toBe(3)
    expect(table.get('b') ?? 0).toBe(0)
  })

  it('adds two together rather than letting one win', () => {
    const table = transposeByNode(
      [node('s', 'start'), node('t', 'transform', 2), node('u', 'transform', 5), node('a', 'osc')],
      [edge('s', 't'), edge('t', 'u'), edge('u', 'a')],
    )
    expect(table.get('a')).toBe(7)
  })

  it('shows the larger where two branches meet at different offsets', () => {
    /*
     * Which is the honest thing to say: it means the note may be moved that far, without claiming to
     * know which pass you are listening to. Showing the smaller would understate what can happen.
     */
    const table = transposeByNode(
      [node('s', 'start'), node('t', 'transform', 2), node('u', 'transform', 9), node('a', 'osc')],
      [edge('s', 't'), edge('s', 'u'), edge('t', 'a'), edge('u', 'a')],
    )
    expect(table.get('a')).toBe(9)
  })

  it('follows only trigger cables, since that is what carries a transform', () => {
    // An audio cable to an effect is not a branch of the cascade, and a modulator points backwards.
    const table = transposeByNode(
      [node('s', 'start'), node('t', 'transform', 4), node('f', 'fx')],
      [edge('s', 't'), edge('t', 'f', 'audio')],
    )
    expect(table.get('f') ?? 0).toBe(0)
  })

  it('returns rather than hanging on a patch that loops back on itself', () => {
    // A reader of a cycle should get a drawing, not a frozen tab.
    const table = transposeByNode(
      [node('s', 'start'), node('t', 'transform', 1), node('a', 'osc')],
      [edge('s', 't'), edge('t', 'a'), edge('a', 't')],
    )
    expect(table.get('a')).toBeGreaterThan(0)
  })
})
