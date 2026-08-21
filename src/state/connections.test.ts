import { describe, expect, it } from 'vitest'
import {
  canConnect,
  connectionFor,
  EVENT_IN,
  EVENT_OUT,
  SIGNAL_LEFT,
  SIGNAL_RIGHT,
} from './connections'

const nodes = [
  { id: 'ig', type: 'start' },
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
