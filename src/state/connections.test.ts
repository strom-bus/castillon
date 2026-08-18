import { describe, expect, it } from 'vitest'
import {
  AUDIO_LEFT,
  AUDIO_RIGHT,
  canConnect,
  connectionKind,
  EVENT_IN,
  EVENT_OUT,
} from './connections'

const nodes = [
  { id: 'ig', type: 'start' },
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
  sourceHandle = AUDIO_RIGHT,
  targetHandle = AUDIO_LEFT,
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

describe('connectionKind', () => {
  it('reads the kind off the handles', () => {
    expect(connectionKind(audio('a', 'f'))).toBe('audio')
    expect(connectionKind(event('a', 'b'))).toBe('event')
  })

  it('refuses to mix the two graphs', () => {
    expect(
      connectionKind({
        source: 'a',
        target: 'f',
        sourceHandle: EVENT_OUT,
        targetHandle: AUDIO_LEFT,
      }),
    ).toBeNull()
    expect(
      connectionKind({
        source: 'a',
        target: 'b',
        sourceHandle: AUDIO_RIGHT,
        targetHandle: EVENT_IN,
      }),
    ).toBeNull()
  })
})

describe('canConnect', () => {
  it('allows an oscillator into an effect', () => {
    expect(canConnect(rules(), audio('a', 'f'))).toBe(true)
  })

  it('allows either side of the oscillator to reach either side of the effect', () => {
    expect(canConnect(rules(), audio('a', 'f', AUDIO_LEFT, AUDIO_RIGHT))).toBe(true)
    expect(canConnect(rules(), audio('a', 'f', AUDIO_RIGHT, AUDIO_RIGHT))).toBe(true)
  })

  it('refuses a second cable between the same pair, whichever sides are used', () => {
    // Two audio handles per node would otherwise let one oscillator send to one effect twice.
    const existing = rules([{ source: 'a', target: 'f' }])
    expect(canConnect(existing, audio('a', 'f', AUDIO_LEFT, AUDIO_RIGHT))).toBe(false)
  })

  it('refuses effect to effect, which is what keeps the audio graph one hop deep', () => {
    expect(canConnect(rules(), audio('f', 'g'))).toBe(false)
  })

  it('refuses effect back into an oscillator', () => {
    expect(canConnect(rules(), audio('f', 'a'))).toBe(false)
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
