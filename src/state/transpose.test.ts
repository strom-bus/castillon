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

/**
 * The two ways a transform fails without saying so.
 *
 * One is merely quiet: with nothing below it, it does not apply. The other is worse than useless —
 * wired beside the cable it was meant to replace, the node under it fires twice, once through it and
 * once around it, and the untransposed pass masks the moved one. The patch sounds exactly as it did
 * while everything on screen says the transform is working, which is how this came to be reported as
 * "it only works at the start of a chain".
 */
describe('why a transform may be doing nothing', () => {
  it('says so when nothing hangs below it', () => {
    const why = transformDoingNothing(
      [node('s', 'start'), node('a', 'osc'), node('t', 'transform', 5)],
      [edge('s', 'a'), edge('a', 't')],
      't',
    )
    expect(why).toMatch(/nothing is wired below/)
  })

  it('says so when what is below it is also reached around it', () => {
    const why = transformDoingNothing(
      [node('s', 'start'), node('a', 'osc'), node('t', 'transform', 5), node('b', 'osc')],
      [edge('s', 'a'), edge('a', 'b'), edge('a', 't'), edge('t', 'b')],
      't',
    )
    expect(why).toMatch(/plays twice/)
  })

  it('is quiet when it is wired in properly', () => {
    const why = transformDoingNothing(
      [node('s', 'start'), node('a', 'osc'), node('t', 'transform', 5), node('b', 'osc')],
      [edge('s', 'a'), edge('a', 't'), edge('t', 'b')],
      't',
    )
    expect(why).toBeNull()
  })

  it('is quiet at the head of a chain, which is where it was first tried', () => {
    const why = transformDoingNothing(
      [node('s', 'start'), node('t', 'transform', 5), node('a', 'osc')],
      [edge('s', 't'), edge('t', 'a')],
      't',
    )
    expect(why).toBeNull()
  })

  it('does not complain about a second branch that has no oscillator in it', () => {
    // An effect reached around it is not a note played twice, and warning about it would train people
    // to ignore the warning that matters.
    const why = transformDoingNothing(
      [node('s', 'start'), node('t', 'transform', 5), node('a', 'osc'), node('f', 'fx')],
      [edge('s', 't'), edge('t', 'a'), edge('a', 'f', 'audio')],
      't',
    )
    expect(why).toBeNull()
  })
})
