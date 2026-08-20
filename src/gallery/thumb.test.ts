import { describe, expect, it } from 'vitest'
import { defaultOscParams } from '../nodes/registry'
import type { Patch, PatchEdge, PatchNode } from '../types/patch'
import { colorAt } from '../viz/depth'
import { layoutThumb, THUMB_NODE_SIZE } from './thumb'

function node(id: string, type: string, x: number, y: number): PatchNode {
  return {
    id,
    type,
    position: { x, y },
    params: type === 'osc' ? defaultOscParams() : {},
  } as PatchNode
}

function edge(source: string, target: string, kind: 'event' | 'audio' = 'event'): PatchEdge {
  return { id: `${source}->${target}`, kind, source, target }
}

function patchOf(nodes: PatchNode[], edges: PatchEdge[]): Patch {
  return { version: 1, bpm: 120, loop: true, nodes, edges }
}

const SIZE = 100

describe('layoutThumb', () => {
  it('has nothing to draw for an empty patch', () => {
    const thumb = layoutThumb(patchOf([], []), SIZE)
    expect(thumb.nodes).toHaveLength(0)
    expect(thumb.cables).toHaveLength(0)
  })

  it('keeps every node inside the box, whatever the patch coordinates were', () => {
    // Canvas positions are arbitrary and can be far from the origin or negative.
    const thumb = layoutThumb(
      patchOf([node('s', 'start', -4000, -900), node('a', 'osc', 12000, 5000)], [edge('s', 'a')]),
      SIZE,
    )
    for (const placed of thumb.nodes) {
      expect(placed.x).toBeGreaterThanOrEqual(THUMB_NODE_SIZE / 2)
      expect(placed.x).toBeLessThanOrEqual(SIZE - THUMB_NODE_SIZE / 2)
      expect(placed.y).toBeGreaterThanOrEqual(THUMB_NODE_SIZE / 2)
      expect(placed.y).toBeLessThanOrEqual(SIZE - THUMB_NODE_SIZE / 2)
    }
  })

  it('scales both axes by the same amount, so the shape is not stretched', () => {
    // A cascade twice as tall as it is wide has to still look twice as tall.
    const thumb = layoutThumb(
      patchOf(
        [node('s', 'start', 0, 0), node('a', 'osc', 100, 0), node('b', 'osc', 0, 200)],
        [edge('s', 'a'), edge('s', 'b')],
      ),
      SIZE,
    )
    const [origin, right, down] = thumb.nodes
    const across = right.x - origin.x
    const downwards = down.y - origin.y
    expect(downwards / across).toBeCloseTo(2, 1)
  })

  it('centres a patch rather than pinning it to a corner', () => {
    // A wide, short patch leaves vertical room; it belongs in the middle of it.
    const thumb = layoutThumb(
      patchOf([node('s', 'start', 0, 0), node('a', 'osc', 400, 0)], [edge('s', 'a')]),
      SIZE,
    )
    for (const placed of thumb.nodes) expect(placed.y).toBeCloseTo(SIZE / 2, 0)
  })

  it('puts a lone node somewhere sensible instead of dividing by a zero span', () => {
    const thumb = layoutThumb(patchOf([node('s', 'start', 700, 700)], []), SIZE)
    expect(thumb.nodes).toHaveLength(1)
    expect(Number.isFinite(thumb.nodes[0].x)).toBe(true)
    expect(Number.isFinite(thumb.nodes[0].y)).toBe(true)
  })

  it('colours by cascade depth, the same ramp the canvas uses', () => {
    const thumb = layoutThumb(
      patchOf(
        [node('s', 'start', 0, 0), node('a', 'osc', 0, 100), node('b', 'osc', 0, 200)],
        [edge('s', 'a'), edge('a', 'b')],
      ),
      SIZE,
    )
    expect(thumb.nodes[0].color).toBe(colorAt(0))
    expect(thumb.nodes[2].color).toBe(colorAt(1))
  })

  it('marks an audio cable as one, since it is not part of the descent', () => {
    const thumb = layoutThumb(
      patchOf(
        [node('s', 'start', 0, 0), node('a', 'osc', 0, 100), node('f', 'fx', 100, 100)],
        [edge('s', 'a'), edge('a', 'f', 'audio')],
      ),
      SIZE,
    )
    expect(thumb.cables.filter((cable) => cable.audio)).toHaveLength(1)
    expect(thumb.cables.filter((cable) => !cable.audio)).toHaveLength(1)
  })

  it('drops a cable whose ends are not both in the patch', () => {
    // A code that arrives half-decoded should not throw while drawing a card.
    const thumb = layoutThumb(patchOf([node('s', 'start', 0, 0)], [edge('s', 'missing')]), SIZE)
    expect(thumb.cables).toHaveLength(0)
  })
})
