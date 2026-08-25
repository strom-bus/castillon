import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { nodeTypes } from './flowTypes'
import {
  EVENT_IN,
  EVENT_OUT,
  EVENT_UP,
  SIGNAL_LEFT,
  SIGNAL_RIGHT,
  WARPABLE,
} from '../state/connections'
import { NODE_DEFINITIONS } from '../nodes/registry'

/**
 * That every node has the ports the connection rules say it has.
 *
 * These are two lists that must agree and cannot be derived from each other: the rules decide what a
 * cable may join, and each component decides what a cable can land on. When they disagree the failure
 * is silent in the worst way. A cable the rules permit but the canvas cannot draw is refused by hand
 * for no stated reason — and *invisible* when it arrives in a patch from a preset, the dice or a patch
 * code, because the edge is in the data whether or not there is a handle to hang it on. The patch then
 * plays as though the cable is there, which it is, while nothing on screen accounts for it.
 *
 * That is exactly what happened: a WARP was warpable onto an Ignite from the day it was redesigned as
 * a side-attached modifier, and an Ignite had no side port. It surfaced only because a warp rolled by
 * the dice came out looking unwired. This test is the one that would have caught it that day.
 */

/** One node of a type, rendered alone with the parameters it is born with, so its ports can be counted. */
function portsOn(type: string): Set<string> {
  const Component = nodeTypes[type as keyof typeof nodeTypes]
  expect(Component, `no component for ${type}`).toBeTruthy()

  // Its own defaults rather than an empty object: several of these read their parameters while
  // rendering, and a node given none crashes before it declares a single port.
  const definition = NODE_DEFINITIONS.find((one) => one.type === type)
  const props = {
    id: 'n1',
    data: { params: definition?.defaults() ?? {} },
    selected: false,
  } as Record<string, unknown>

  const { container } = render(
    <ReactFlowProvider>
      {/* Rendered bare rather than inside a canvas: what is counted is what the component asks for,
          and a canvas would only add the machinery that draws it. */}
      <Component {...(props as never as Parameters<typeof Component>[0])} />
    </ReactFlowProvider>,
  )

  return new Set(
    [...container.querySelectorAll('[data-handleid]')].map(
      (handle) => handle.getAttribute('data-handleid') ?? '',
    ),
  )
}

/**
 * Which way each side port faces, by the class React Flow puts on it.
 *
 * `null` where there is no port on that side. A handle is a target or a source and the canvas will only
 * offer a cable between one of each, so this is the difference between a side that means something and a
 * side that takes whatever it is given.
 */
function sidesOn(type: string): { left: string | null; right: string | null } {
  const facing = (handle: Element | null) =>
    handle === null ? null : handle.classList.contains('target') ? 'target' : 'source'

  const Component = nodeTypes[type as keyof typeof nodeTypes]
  const definition = NODE_DEFINITIONS.find((one) => one.type === type)
  const props = {
    id: 'n1',
    data: { params: definition?.defaults() ?? {} },
    selected: false,
  } as Record<string, unknown>

  const { container } = render(
    <ReactFlowProvider>
      <Component {...(props as never as Parameters<typeof Component>[0])} />
    </ReactFlowProvider>,
  )
  return {
    left: facing(container.querySelector(`[data-handleid="${SIGNAL_LEFT}"]`)),
    right: facing(container.querySelector(`[data-handleid="${SIGNAL_RIGHT}"]`)),
  }
}

describe('the ports on a node', () => {
  it.each([...WARPABLE])('%s can take a warp, so it has a side for one to land on', (type) => {
    const ports = portsOn(type)
    expect(ports.has(SIGNAL_LEFT), `${type} has no left side port`).toBe(true)
    expect(ports.has(SIGNAL_RIGHT), `${type} has no right side port`).toBe(true)
  })

  it('gives a side port to exactly the nodes that declare one', () => {
    /*
     * Both directions at once, read off `ports.side` rather than a list of types kept beside it — which
     * is what this was, and the list had to be edited every time a node was added, so it was a copy of
     * the registry that could fall behind it.
     *
     * The direction the first fix got wrong is the second one: a port nothing can use is worse than no
     * port. An Ignite briefly had two, so a WARP could hang off it — signal ports on a node that has
     * nothing to do with signal, to support a warp that was not bending the Ignite at all but using it
     * as a place to stand while it reached the oscillators below.
     */
    for (const definition of NODE_DEFINITIONS) {
      const declared = definition.ports.side !== undefined
      const ports = portsOn(definition.type)
      expect(
        ports.has(SIGNAL_LEFT),
        `${definition.type} ${declared ? 'has no left side port' : 'has a side port nothing can use'}`,
      ).toBe(declared)
      expect(
        ports.has(SIGNAL_RIGHT),
        `${definition.type} ${declared ? 'has no right side port' : 'has a side port nothing can use'}`,
      ).toBe(declared)
    }
  })

  it('faces each side port the way the registry says it does', () => {
    /*
     * The other half of the port declaration, and the half that only one node uses. `side: 'either'`
     * means a side takes whatever it is given and the kind is worked out from the node types — so both
     * are sources, and a drag either way round is turned round if it has to be. `side: 'directed'` means
     * the side *is* the meaning: a follower takes audio in the left and sends modulation out the right, and
     * both of those are legal between the same pair of nodes, so nothing but the side can say which was
     * meant. Drawn as a target and a source, the canvas cannot offer the one that would be wrong.
     *
     * Read off the registry rather than named here, so a second directed node inherits the check.
     */
    for (const definition of NODE_DEFINITIONS) {
      if (definition.ports.side === undefined) continue
      const sides = sidesOn(definition.type)
      if (definition.ports.side === 'directed') {
        expect(sides.left, `${definition.type} does not take a cable on its left`).toBe('target')
        expect(sides.right, `${definition.type} does not send from its right`).toBe('source')
      } else {
        expect(sides, `${definition.type} has a side that means something`).toEqual({
          left: 'source',
          right: 'source',
        })
      }
    }
  })

  it('gives every cascade node a way to fire, and everything but an Ignite a way to be fired', () => {
    for (const definition of NODE_DEFINITIONS.filter((one) => one.place === 'cascade')) {
      const ports = portsOn(definition.type)
      expect(ports.has(EVENT_OUT), `${definition.type} cannot fire anything`).toBe(true)
      // An Ignite starts a cascade, so it is the one node with nothing above it.
      if (definition.type !== 'start') {
        expect(ports.has(EVENT_IN), `${definition.type} cannot be fired`).toBe(true)
      }
    }
  })

  it('keeps a WARP out of the cascade entirely', () => {
    /*
     * A WARP standing in the cascade is the shape that did not work: wired beside the cable it was
     * meant to replace, the node below fires twice and the unwarped pass masks the warped one, so the
     * patch sounds untouched while everything on screen says the warp is working. Having no top or
     * bottom port at all is what makes that unreachable rather than merely discouraged.
     *
     * A MOD is not held to this and should not be: an envelope fires on a trigger, so it takes one in
     * and passes it on, and one in the middle of a chain never breaks the chain.
     */
    const ports = portsOn('warp')
    expect(ports.has(SIGNAL_LEFT)).toBe(true)
    expect(ports.has(SIGNAL_RIGHT)).toBe(true)
    expect(ports.has(EVENT_IN), 'a warp can be fired').toBe(false)
    expect(ports.has(EVENT_OUT), 'a warp can fire the cascade').toBe(false)
  })

  it('gives the upward port to exactly the nodes that declare one', () => {
    /*
     * Both directions of the same claim, which is what this file is for. A node declaring the port and
     * not drawing it means a cable a patch code can carry and the canvas cannot show — the WARP fault
     * again. A node drawing one it has not declared means a cable the rules will refuse the moment it
     * is let go of, which reads as the canvas being broken.
     */
    for (const definition of NODE_DEFINITIONS) {
      const drawn = portsOn(definition.type).has(EVENT_UP)
      expect(drawn, `${definition.type}: declares ${definition.ports.up}, draws ${drawn}`).toBe(
        definition.ports.up === true,
      )
    }
  })

  it('found ports at all, so a broken query cannot pass by finding none', () => {
    // The failure this file would otherwise have: a selector that stops matching, empty sets
    // everywhere, and every assertion above passing while checking nothing.
    expect(portsOn('osc').size).toBeGreaterThan(2)
    expect(portsOn('start').size).toBeGreaterThan(0)
  })
})
