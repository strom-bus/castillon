/**
 * How the palette is ordered and where it is divided.
 *
 * The division is the one thing a person has to hold to use any of this: a node either stands in the
 * cascade, wired top to bottom and part of what fires what, or it hangs off one and changes it without
 * being in the order at all. That is also the difference between the two directions cables run in, so
 * the palette can say it once instead of leaving it to be worked out six times.
 */

import { describe, expect, it } from 'vitest'
import { NODE_DEFINITIONS, NODE_FAMILIES } from '../nodes/registry'

describe('the palette', () => {
  it('says where every node stands', () => {
    for (const definition of NODE_DEFINITIONS) {
      expect(['cascade', 'side'], definition.type).toContain(definition.place)
    }
  })

  it('keeps the two kinds together rather than interleaved', () => {
    /*
     * The line between them came and went — drawn through a row of buttons it read as a break in the
     * row rather than as a division of it — and the grouping it was drawn for is the part worth
     * keeping. An order that alternated would put a side node between two cascade ones, which is the
     * arrangement this is here to prevent whether or not anything is drawn at the seam.
     */
    const changes = NODE_DEFINITIONS.filter(
      (definition, i) => i > 0 && definition.place !== NODE_DEFINITIONS[i - 1]!.place,
    )
    expect(changes).toHaveLength(1)
  })

  it('groups every node into a family that has members', () => {
    /*
     * The palette renders a run per family and fills it by filtering, so a family nobody belongs to is a
     * gap in the row with nothing on either side of it — a division of nothing from nothing. The other
     * direction, a node whose family is not on the list, the type checker refuses.
     */
    for (const family of NODE_FAMILIES) {
      const mine = NODE_DEFINITIONS.filter((definition) => definition.family === family)
      expect(mine.length, `nothing is in the ${family} family`).toBeGreaterThan(0)
    }
  })

  it('never lets a family straddle the seam between the two places', () => {
    /*
     * The finer division may refine the coarser one and may not contradict it. A family holding one node
     * that is fired and another that is attached would put a wider gap somewhere *inside* the one
     * distinction a person actually has to hold, and a narrower one across it — the palette arguing
     * against itself in whitespace.
     */
    for (const family of NODE_FAMILIES) {
      const places = new Set(
        NODE_DEFINITIONS.filter((one) => one.family === family).map((one) => one.place),
      )
      expect([...places], `the ${family} family is on both sides of the seam`).toHaveLength(1)
    }
  })

  it('keeps each family contiguous, so the row is not reordered by being grouped', () => {
    /*
     * The palette filters the registry once per family, which quietly rewrites the order if a family is
     * interleaved: the buttons would come out grouped and no longer in the order the registry argues
     * for. Contiguous, the two orders are the same order.
     */
    const runs = NODE_DEFINITIONS.filter(
      (definition, i) => i === 0 || definition.family !== NODE_DEFINITIONS[i - 1]!.family,
    ).map((definition) => definition.family)
    expect(runs).toEqual([...NODE_FAMILIES])
  })

  it('puts what stands in a cascade first', () => {
    // Because that is the order a patch is built in: something has to fire before anything can shape it.
    expect(NODE_DEFINITIONS[0]!.place).toBe('cascade')
    expect(NODE_DEFINITIONS.at(-1)!.place).toBe('side')
  })

  it('starts a cascade with the thing that starts one', () => {
    expect(NODE_DEFINITIONS[0]!.type).toBe('start')
  })

  it('agrees with itself about which nodes take a trigger', () => {
    /*
     * The claim behind the division, read off the ports rather than asserted as a second list — which is
     * what this was, and a list is exactly wrong here: it needed editing every time a node was added, so
     * it said "these are the side nodes" while claiming to check that they belong on that side.
     *
     * Standing in the cascade means something fires you, so a cascade node must declare a trigger port.
     * Hanging off one means you attach to a node instead of being fired by it, so a side node must
     * declare a side to attach by. An oscillator is both — fired from above and open at the sides —
     * which is why this is two implications and not an equivalence.
     */
    for (const definition of NODE_DEFINITIONS) {
      if (definition.place === 'cascade') {
        expect(
          definition.ports.trigger,
          `${definition.type} stands in the cascade with no trigger port`,
        ).toBeTruthy()
      } else {
        expect(
          definition.ports.side,
          `${definition.type} hangs off a node with no side to hang by`,
        ).toBeTruthy()
      }
    }
  })
})
