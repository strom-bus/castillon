import { describe, expect, it } from 'vitest'
import { NODE_DEFINITIONS } from '../nodes/registry'
import {
  canConnect,
  connectionFor,
  permits,
  EVENT_IN,
  EVENT_OUT,
  SIGNAL_LEFT,
  SIGNAL_RIGHT,
} from './connections'

const nodes = [
  { id: 'ig', type: 'start' },
  { id: 'w', type: 'warp' },
  { id: 'm', type: 'mod' },
  { id: 'a', type: 'osc' },
  { id: 'b', type: 'osc' },
  { id: 'f', type: 'fx' },
  { id: 'g', type: 'fx' },
  { id: 'd', type: 'delay' },
]

const rules = (edges: { source: string; target: string }[] = []) => ({ nodes, edges })

const audio = (
  source: string,
  target: string,
  sourceHandle = SIGNAL_RIGHT,
  targetHandle = SIGNAL_LEFT,
) => ({
  source,
  target,
  sourceHandle,
  targetHandle,
})

const event = (source: string, target: string) => ({
  source,
  target,
  sourceHandle: EVENT_OUT,
  targetHandle: EVENT_IN,
})

describe('what a cable turns out to be', () => {
  it('reads the kind off the nodes, not off the ports', () => {
    // The reason one port per side works: an oscillator reaching an effect can only be audio, and a
    // modulator reaching either can only be modulation.
    expect(connectionFor(rules(), audio('a', 'f'))?.kind).toBe('audio')
    expect(connectionFor(rules(), audio('m', 'a'))?.kind).toBe('mod')
    expect(connectionFor(rules(), audio('m', 'f'))?.kind).toBe('mod')
    expect(connectionFor(rules(), event('a', 'b'))?.kind).toBe('event')
  })

  it('turns a cable drawn backwards round rather than refusing it', () => {
    // Dragging from an oscillator onto a modulator means the same thing as the reverse, and React
    // Flow can no longer tell us which way the user meant.
    const decided = connectionFor(rules(), audio('a', 'm'))
    expect(decided?.kind).toBe('mod')
    expect(decided?.source).toBe('m')
    expect(decided?.target).toBe('a')
  })

  it('turns a trigger cable drawn upwards round too', () => {
    const decided = connectionFor(rules(), {
      source: 'b',
      target: 'a',
      sourceHandle: EVENT_IN,
      targetHandle: EVENT_OUT,
    })
    expect(decided?.source).toBe('a')
    expect(decided?.target).toBe('b')
  })

  it('swaps the ports with the ends, so the cable still leaves the side it was drawn from', () => {
    const decided = connectionFor(rules(), audio('a', 'm', SIGNAL_LEFT, SIGNAL_RIGHT))
    expect(decided?.sourceHandle).toBe(SIGNAL_RIGHT)
    expect(decided?.targetHandle).toBe(SIGNAL_LEFT)
  })

  it('refuses to mix a side port with a top or bottom one', () => {
    expect(
      connectionFor(rules(), {
        source: 'a',
        target: 'f',
        sourceHandle: EVENT_OUT,
        targetHandle: SIGNAL_LEFT,
      }),
    ).toBeNull()
    expect(
      connectionFor(rules(), {
        source: 'a',
        target: 'b',
        sourceHandle: SIGNAL_RIGHT,
        targetHandle: EVENT_IN,
      }),
    ).toBeNull()
  })

  it('refuses a signal cable between two things that have nothing to say to each other', () => {
    expect(connectionFor(rules(), audio('a', 'b'))).toBeNull()
    expect(connectionFor(rules(), audio('f', 'g'))).toBeNull()
    expect(connectionFor(rules(), audio('a', 'ig'))).toBeNull()
    expect(connectionFor(rules(), audio('m', 'd'))).toBeNull()
  })

  it('refuses a second cable between the same two nodes, whichever way it is drawn', () => {
    const wired = rules([{ source: 'm', target: 'a' }])
    expect(canConnect(wired, audio('m', 'a'))).toBe(false)
    expect(canConnect(wired, audio('a', 'm'))).toBe(false)
  })
})

describe('canConnect', () => {
  it('allows an oscillator into an effect', () => {
    expect(canConnect(rules(), audio('a', 'f'))).toBe(true)
  })

  it('allows either side of the oscillator to reach either side of the effect', () => {
    expect(canConnect(rules(), audio('a', 'f', SIGNAL_LEFT, SIGNAL_RIGHT))).toBe(true)
    expect(canConnect(rules(), audio('a', 'f', SIGNAL_RIGHT, SIGNAL_RIGHT))).toBe(true)
  })

  it('refuses a second cable between the same pair, whichever sides are used', () => {
    // Two audio handles per node would otherwise let one oscillator send to one effect twice.
    const existing = rules([{ source: 'a', target: 'f' }])
    expect(canConnect(existing, audio('a', 'f', SIGNAL_LEFT, SIGNAL_RIGHT))).toBe(false)
  })

  it('refuses effect to effect, which is what keeps the audio graph one hop deep', () => {
    expect(canConnect(rules(), audio('f', 'g'))).toBe(false)
  })

  it('turns an effect dragged onto an oscillator round, since only one direction exists', () => {
    // It used to be refused. Turning it round is the better answer: there is exactly one legal cable
    // between an oscillator and an effect, so a drag either way can only have meant that one.
    const decided = connectionFor(rules(), audio('f', 'a'))
    expect(decided?.source).toBe('a')
    expect(decided?.target).toBe('f')
    expect(decided?.kind).toBe('audio')
  })

  it('refuses audio from a node that makes none', () => {
    expect(canConnect(rules(), audio('ig', 'f'))).toBe(false)
    expect(canConnect(rules(), audio('d', 'f'))).toBe(false)
  })

  it('still allows the event connections it always did', () => {
    expect(canConnect(rules(), event('ig', 'a'))).toBe(true)
    expect(canConnect(rules(), event('a', 'd'))).toBe(true)
  })

  it('refuses self-connection on either graph', () => {
    expect(canConnect(rules(), audio('a', 'a'))).toBe(false)
    expect(canConnect(rules(), event('a', 'a'))).toBe(false)
  })

  it('refuses a duplicate event cable', () => {
    expect(canConnect(rules([{ source: 'ig', target: 'a' }]), event('ig', 'a'))).toBe(false)
  })

  it('allows several effects on one oscillator and one effect on several', () => {
    const existing = rules([{ source: 'a', target: 'f' }])
    expect(canConnect(existing, audio('a', 'g'))).toBe(true)
    expect(canConnect(existing, audio('b', 'f'))).toBe(true)
  })
})

/**
 * What a WARP may attach to, which is the rule that went wrong.
 *
 * It read `start`, `osc`, `delay` for four commits and two of those were nodes with nothing a warp can
 * bend. Worse, the canvas had no side port on either, so the cable was refused when drawn by hand and
 * invisible when it arrived in a built patch — the fault surfaced only because a warp rolled by the dice
 * came out looking unwired.
 */
describe('what a warp attaches to', () => {
  it('goes onto an oscillator, in either direction of drag', () => {
    expect(canConnect(rules(), audio('w', 'a'))).toBe(true)
    // Drawn the other way it is turned round rather than refused, and stored warp-first.
    const back = connectionFor(rules(), audio('a', 'w'))
    expect(back?.source).toBe('w')
    expect(back?.kind).toBe('warp')
  })

  it('will not go onto an Ignite, which has nothing it could bend', () => {
    // No pitch, no tempo, no notes. A warp attached here was never bending the Ignite — it was standing
    // on it to reach the oscillators below, which is what attaching to the top oscillator already does.
    expect(canConnect(rules(), audio('w', 'ig'))).toBe(false)
    expect(permits('warp', 'start', 'warp')).toBe(false)
  })

  it('will not go onto a DELAY either, whose wait no ratio scales', () => {
    expect(canConnect(rules(), audio('w', 'd'))).toBe(false)
    expect(permits('warp', 'delay', 'warp')).toBe(false)
  })

  it('will not go onto an effect, which plays nothing of its own', () => {
    expect(canConnect(rules(), audio('w', 'f'))).toBe(false)
  })

  it('never stands in the cascade, in either direction', () => {
    /*
     * The shape that did not work, kept unreachable rather than merely discouraged: in the chain, wired
     * beside the cable it was meant to replace, the node below fires twice and the unwarped pass masks
     * the warped one — so the patch sounds untouched while the screen says the warp is working.
     */
    expect(canConnect(rules(), event('ig', 'w'))).toBe(false)
    expect(canConnect(rules(), event('w', 'a'))).toBe(false)
    expect(permits('warp', 'osc', 'event')).toBe(false)
    expect(permits('start', 'warp', 'event')).toBe(false)
  })
})

/**
 * `permits`, which answers the same rule without a drag.
 *
 * A patch from a preset, the dice or a patch code never goes through a drag, so nothing was checking
 * its edges at all. Asked per kind rather than "what cable goes here", because one pair of types can
 * carry more than one: an oscillator and a MOD take a modulation cable from the MOD and a trigger
 * cable into it, and one answer would have to throw the other away.
 */
describe('the rule asked without a drag', () => {
  it('agrees with a drag on every kind', () => {
    expect(permits('start', 'osc', 'event')).toBe(true)
    expect(permits('osc', 'fx', 'audio')).toBe(true)
    expect(permits('mod', 'osc', 'mod')).toBe(true)
    expect(permits('warp', 'osc', 'warp')).toBe(true)
  })

  it('gives both answers for a pair that carries two cables', () => {
    expect(permits('mod', 'osc', 'mod')).toBe(true)
    expect(permits('osc', 'mod', 'event')).toBe(true)
  })

  it('refuses a cable of the wrong kind between a pair that has one', () => {
    // The check that makes it worth having: an edge stored with the wrong kind draws itself as the
    // wrong cable and behaves as the kind it claims.
    expect(permits('osc', 'fx', 'mod')).toBe(false)
    expect(permits('mod', 'osc', 'audio')).toBe(false)
    expect(permits('warp', 'osc', 'mod')).toBe(false)
  })

  it('refuses a trigger into an Ignite, which nothing fires', () => {
    expect(permits('osc', 'start', 'event')).toBe(false)
  })

  it('refuses a trigger into an effect, which nothing triggers', () => {
    expect(permits('osc', 'fx', 'event')).toBe(false)
  })
})

/**
 * That the rules and the ports agree, over the whole rule set rather than pair by pair.
 *
 * The property both halves of this file exist to protect, stated once: a cable the rules permit must be
 * a cable the canvas can draw. Checked by asking the rules about every ordered pair of node types, so a
 * rule added later is covered on the day it is added — which is the difference between this and the
 * guard it replaced. A guard would have made a wrongly-added rule silently do nothing; this fails.
 */
describe('every rule lands on a port that exists', () => {
  const types = NODE_DEFINITIONS.map((one) => one.type)
  const portsOf = (type: string) => NODE_DEFINITIONS.find((one) => one.type === type)!.ports
  const pairs = types.flatMap((from) => types.map((to) => [from, to] as const))

  it.each(['audio', 'mod', 'warp'] as const)(
    '%s only runs between nodes with side ports',
    (kind) => {
      for (const [from, to] of pairs) {
        if (!permits(from, to, kind)) continue
        expect(portsOf(from).side, `${kind}: ${from} has no side port`).toBe(true)
        expect(portsOf(to).side, `${kind}: ${to} has no side port`).toBe(true)
      }
    },
  )

  it('a trigger only runs out of something that fires and into something that can be fired', () => {
    for (const [from, to] of pairs) {
      if (!permits(from, to, 'event')) continue
      expect(['out', 'both'], `event: ${from} cannot fire`).toContain(portsOf(from).trigger)
      expect(['in', 'both'], `event: ${to} cannot be fired`).toContain(portsOf(to).trigger)
    }
  })

  it('found rules to check, so an empty rule set cannot pass by permitting nothing', () => {
    const allowed = pairs.flatMap(([from, to]) =>
      (['event', 'audio', 'mod', 'warp'] as const).filter((kind) => permits(from, to, kind)),
    )
    expect(allowed.length).toBeGreaterThan(6)
  })
})
