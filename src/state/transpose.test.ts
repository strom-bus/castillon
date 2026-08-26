/**
 * What the canvas has to say before it is asked (PLAN §18.18).
 *
 * A transform reaches its whole branch, which is the point of it and also the danger: an oscillator
 * three levels down sounds moved with nothing on it saying why. A hold has the same reach and gets away
 * with it, because a shift in time is heard from where it came — a shift in pitch is silent about its
 * cause. So each affected node is told what is happening to it, and this is the arithmetic behind that.
 */

import { describe, expect, it } from 'vitest'
import { warpDoingNothing, transposeByNode } from './transpose'
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
  kind: 'warp',
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
      [node('s', 'start'), node('t', 'warp', 3), node('a', 'osc'), node('b', 'osc')],
      [edge('s', 'a'), edge('a', 'b'), shift('t', 'a')],
    )
    expect(table.get('a')).toBe(3)
    expect(table.get('b')).toBe(3)
  })

  it('leaves what is beside it alone', () => {
    const table = transposeByNode(
      [node('s', 'start'), node('t', 'warp', 3), node('a', 'osc'), node('b', 'osc')],
      [edge('s', 'a'), edge('s', 'b'), shift('t', 'a')],
    )
    expect(table.get('a')).toBe(3)
    expect(table.get('b') ?? 0).toBe(0)
  })

  it('takes a whole cascade when it is on the Ignite', () => {
    // The thing that was impossible before without standing directly under one.
    const table = transposeByNode(
      [node('s', 'start'), node('t', 'warp', 5), node('a', 'osc'), node('b', 'osc')],
      [edge('s', 'a'), edge('a', 'b'), shift('t', 's')],
    )
    expect(table.get('a')).toBe(5)
    expect(table.get('b')).toBe(5)
  })

  it('adds two on the same node together rather than letting one win', () => {
    const table = transposeByNode(
      [node('s', 'start'), node('t', 'warp', 2), node('u', 'warp', 5), node('a', 'osc')],
      [edge('s', 'a'), shift('t', 'a'), shift('u', 'a')],
    )
    expect(table.get('a')).toBe(7)
  })

  it('adds one up the branch to one further down it', () => {
    const table = transposeByNode(
      [
        node('s', 'start'),
        node('t', 'warp', 2),
        node('u', 'warp', 5),
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
      [node('s', 'start'), node('t', 'warp', 1), node('a', 'osc'), node('b', 'osc')],
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
    const why = warpDoingNothing(
      [node('s', 'start'), node('a', 'osc'), node('t', 'warp', 5)],
      [edge('s', 'a')],
      't',
    )
    expect(why).toMatch(/not attached/)
  })

  it('says so when there is no note below what it is on', () => {
    const why = warpDoingNothing(
      [node('s', 'start'), node('d', 'hold'), node('t', 'warp', 5)],
      [edge('s', 'd'), shift('t', 'd')],
      't',
    )
    expect(why).toMatch(/makes a note/)
  })

  it('is quiet on an oscillator', () => {
    const why = warpDoingNothing(
      [node('s', 'start'), node('a', 'osc'), node('t', 'warp', 5)],
      [edge('s', 'a'), shift('t', 'a')],
      't',
    )
    expect(why).toBeNull()
  })

  it('is quiet on an Ignite with a cascade under it', () => {
    const why = warpDoingNothing(
      [node('s', 'start'), node('a', 'osc'), node('t', 'warp', 5)],
      [edge('s', 'a'), shift('t', 's')],
      't',
    )
    expect(why).toBeNull()
  })
})

/**
 * A warp on a branch the fire **climbs**, which the reach was never taught about.
 *
 * The engine carries a warp along the trigger — `warpsOn` adds whatever hangs on each node the trigger
 * reaches, and the trigger reaches upward as readily as down since the IGNITE grew a second port. This
 * reach walks event cables from source to target only, so on a climbing branch it walks them backwards
 * and credits the warp to nothing.
 *
 * The failure is the quiet kind: the notes *are* transposed, and the canvas says they are not. Nothing
 * throws, nothing looks wrong, and the panel will tell you a warp that is working is doing nothing.
 */
describe('a warp on a branch that climbs', () => {
  /** An IGNITE lighting `a` from its upward port; the fire then climbs the cable drawn from `b` to `a`. */
  const climbing = (): { nodes: PatchNode[]; edges: PatchEdge[] } => ({
    nodes: [node('i', 'start'), node('a', 'osc'), node('b', 'osc'), node('w', 'warp', 5)],
    edges: [{ ...edge('i', 'a'), up: true }, edge('b', 'a'), shift('w', 'a')],
  })

  it('moves the node it is attached to', () => {
    const { nodes, edges } = climbing()
    expect(transposeByNode(nodes, edges).get('a')).toBe(5)
  })

  it('moves what the fire reaches from there, upward included', () => {
    // The trigger goes i → a and then climbs a → b, so `b` is under the warp exactly as it would be
    // under a warp on a descending branch.
    const { nodes, edges } = climbing()
    expect(transposeByNode(nodes, edges).get('b')).toBe(5)
  })

  it('still stops at a branch the fire never reaches', () => {
    // The other direction, so the fix is not "reach everywhere": a node hanging below `a` is not on the
    // climb and must stay untouched.
    const { nodes, edges } = climbing()
    nodes.push(node('c', 'osc'))
    edges.push(edge('a', 'c'))
    expect(transposeByNode(nodes, edges).get('c') ?? 0).toBe(0)
  })
})
