/**
 * Dropping a node onto a cable to put it into the cable (PLAN §18.19).
 *
 * Written for the transform, which no longer needs it: a transform attaches to a node from the side now,
 * because standing between two nodes meant breaking the cable that joined them and nothing said so — it
 * got wired beside that cable instead, and then the node under it fired twice with the untransposed pass
 * masking the moved one.
 *
 * The gesture stayed for the delay, which has the same problem and always did. A doubled delay is heard
 * as an echo, so it got away with it for a long time.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { usePatchStore } from './patchStore'

const store = () => usePatchStore.getState()

/** Adds a node and puts it where the cable between two others runs. */
function dropOn(type: string, edgeId: string): string {
  const edge = store().edges.find((e) => e.id === edgeId)!
  const from = store().nodes.find((n) => n.id === edge.source)!
  const to = store().nodes.find((n) => n.id === edge.target)!
  store().addNode(type, {
    x: (from.position.x + to.position.x) / 2,
    y: (from.position.y + to.position.y) / 2,
  })
  const added = store().nodes.at(-1)!
  store().spliceIntoCable(added.id)
  return added.id
}

const eventEdges = () => store().edges.filter((e) => (e.data?.kind ?? 'event') === 'event')

beforeEach(() => {
  store().resetPatch()
})

describe('a node dropped on a cable', () => {
  it('takes the place of it, joined to both ends', () => {
    const cable = eventEdges()[1]!
    const { source, target } = cable
    const id = dropOn('delay', cable.id)

    const now = eventEdges()
    expect(now.some((e) => e.id === cable.id)).toBe(false)
    expect(now.some((e) => e.source === source && e.target === id)).toBe(true)
    expect(now.some((e) => e.source === id && e.target === target)).toBe(true)
  })

  it('joins it to both ends wherever in the cascade the cable is', () => {
    for (const cable of [...eventEdges()]) {
      store().resetPatch()
      const here = store().edges.find((e) => e.source === cable.source && e.target === cable.target)
      if (!here) continue
      const id = dropOn('delay', here.id)
      const now = eventEdges()
      expect(
        now.some((e) => e.target === id),
        `${cable.source}->${cable.target}`,
      ).toBe(true)
      expect(
        now.some((e) => e.source === id),
        `${cable.source}->${cable.target}`,
      ).toBe(true)
    }
  })

  it('works wherever in the cascade the cable is', () => {
    // It was reported as a node that only works at the head of a chain, which was never true of the
    // node and entirely true of how easy it was to wire one anywhere else.
    for (const cable of [...eventEdges()]) {
      store().resetPatch()
      const here = store().edges.find((e) => e.source === cable.source && e.target === cable.target)
      if (!here) continue
      const id = dropOn('delay', here.id)
      expect(
        eventEdges().some((e) => e.source === id),
        `${cable.source}->${cable.target}`,
      ).toBe(true)
    }
  })
})

describe('a node dropped anywhere else', () => {
  it('is left alone when it lands away from every cable', () => {
    store().addNode('warp', { x: 9000, y: 9000 })
    const id = store().nodes.at(-1)!.id
    expect(store().spliceIntoCable(id)).toBe(false)
    expect(store().edges.some((e) => e.source === id || e.target === id)).toBe(false)
  })

  it('never rearranges a node that is already wired', () => {
    /*
     * The rule that makes the whole gesture safe. Without it, dragging any part of a patch across
     * another cable would rewire it under your hand — and moving nodes about is most of what anybody
     * does on this canvas.
     */
    const osc = store().nodes.find((n) => n.type === 'osc')!
    const before = store().edges.length
    expect(store().spliceIntoCable(osc.id)).toBe(false)
    expect(store().edges).toHaveLength(before)
  })

  it('refuses a node that has no way through it', () => {
    // An effect has no trigger ports at all, so it cannot stand in the middle of a cascade.
    const cable = eventEdges()[0]!
    const from = store().nodes.find((n) => n.id === cable.source)!
    store().addNode('fx', { x: from.position.x, y: from.position.y + 40 })
    const id = store().nodes.at(-1)!.id

    expect(store().spliceIntoCable(id)).toBe(false)
  })
})
