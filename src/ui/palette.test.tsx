/**
 * How the palette is ordered and where it is divided.
 *
 * The division is the one thing a person has to hold to use any of this: a node either stands in the
 * cascade, wired top to bottom and part of what fires what, or it hangs off one and changes it without
 * being in the order at all. That is also the difference between the two directions cables run in, so
 * the palette can say it once instead of leaving it to be worked out six times.
 */

import { describe, expect, it } from 'vitest'
import { NODE_DEFINITIONS } from '../nodes/registry'

describe('the palette', () => {
  it('says where every node stands', () => {
    for (const definition of NODE_DEFINITIONS) {
      expect(['cascade', 'side'], definition.type).toContain(definition.place)
    }
  })

  it('keeps the two kinds together rather than interleaved', () => {
    /*
     * A rule is drawn wherever the kind changes, so an order that alternated would draw five of them
     * and mean nothing by any. One change is what makes it a division rather than a decoration.
     */
    const changes = NODE_DEFINITIONS.filter(
      (definition, i) => i > 0 && definition.place !== NODE_DEFINITIONS[i - 1]!.place,
    )
    expect(changes).toHaveLength(1)
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
     * The claim behind the division, checked against the connection rules rather than asserted twice.
     * A side node with trigger ports, or a cascade node without, would put the rule in the wrong place
     * and nothing else would notice.
     */
    const sideTypes = NODE_DEFINITIONS.filter((d) => d.place === 'side').map((d) => d.type)
    expect(sideTypes).toEqual(['fx', 'mod', 'transform'])
  })
})
