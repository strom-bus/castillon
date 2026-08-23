/**
 * That every node type has something to draw it.
 *
 * A type with no entry here does not throw and does not warn: the canvas falls back to a plain white
 * rectangle with nothing in it, ports and all. It looks like a styling problem and is not one — the
 * component was never reached. Renaming a node type from `transform` to `warp` did exactly this,
 * because the keys in the map are bare identifiers and the rename was looking for quoted strings.
 *
 * The two lists have to be checked against each other because nothing else compares them. TypeScript
 * cannot: the map is an object literal with no index signature tying it to the registry.
 */

import { describe, expect, it } from 'vitest'
import { NODE_DEFINITIONS } from '../nodes/registry'
import { edgeTypes, nodeTypes } from './flowTypes'
import { EDGE_COMPONENT } from '../state/patchStore'

describe('what draws each node', () => {
  it('covers every type the palette can add', () => {
    for (const definition of NODE_DEFINITIONS) {
      expect(nodeTypes, definition.type).toHaveProperty(definition.type)
    }
  })

  it('draws nothing that cannot be added', () => {
    // A leftover entry is the same rename half-done from the other side, and just as quiet.
    for (const key of Object.keys(nodeTypes)) {
      expect(
        NODE_DEFINITIONS.some((definition) => definition.type === key),
        key,
      ).toBe(true)
    }
  })

  it('has a component for every kind of cable', () => {
    /*
     * The same failure one level down, and half-guarded already: the map from a cable's kind to a
     * component name is typed against every kind, so a missing kind is a compile error — which is how
     * the rename was caught there and not here. What is not checked is the other end, that the name it
     * gives actually names a component. A kind pointing at nothing draws the default line and loses
     * whatever it was meant to say about itself.
     */
    for (const [kind, component] of Object.entries(EDGE_COMPONENT)) {
      expect(edgeTypes, `${kind} → ${component}`).toHaveProperty(component)
    }
  })
})
