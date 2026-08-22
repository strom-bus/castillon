/**
 * Detune, which is this instrument's answer to unison (PLAN §18.12).
 *
 * A classic thickens a sound by stacking voices onto one oscillator, and here that would multiply the
 * load budget the sweep spent days establishing. But the cascade already hands you several oscillators —
 * what it does not hand you is a reason for two of them to read as one thick voice rather than as two
 * separate ones. A few cents apart is that reason, and it adds no voices at all.
 */

import { describe, expect, it } from 'vitest'
import { detuneRatio, midiToFreq } from './clock'
import { getDefinition, defaultOscParams } from '../nodes/registry'
import { ActivityBus } from '../viz/activity'
import type { NoteRequest } from './engine'
import type { OscParams, PatchNode } from '../types/patch'

const A4 = 69

describe('a detune in cents', () => {
  it('is dead centre by default', () => {
    // So a node made today is in tune exactly as one made before detune existed was.
    expect(defaultOscParams().detune).toBe(0)
    expect(detuneRatio(0)).toBe(1)
  })

  it('is a semitone at a hundred cents', () => {
    expect(detuneRatio(100)).toBeCloseTo(Math.pow(2, 1 / 12), 9)
    expect(detuneRatio(1200)).toBeCloseTo(2, 9)
  })

  it('goes down as readily as up, and symmetrically', () => {
    // Two siblings set opposite is the whole use of it, so the two directions must be mirror images.
    expect(detuneRatio(-30) * detuneRatio(30)).toBeCloseTo(1, 9)
  })

  it('shifts a pitch by cents rather than by hertz', () => {
    /*
     * The distinction that matters for beating. A fixed number of hertz is a wide interval down low and
     * an inaudible one up top, so two oscillators set that way would beat at one pitch and sound merely
     * out of tune at another. In cents the interval — and so the beat rate relative to the note — is the
     * same wherever it is played.
     */
    const cents = 20
    const low = midiToFreq(A4 - 24) * detuneRatio(cents)
    const high = midiToFreq(A4 + 24) * detuneRatio(cents)
    expect(low / midiToFreq(A4 - 24)).toBeCloseTo(high / midiToFreq(A4 + 24), 9)
  })
})

/** The pitches an oscillator asks the engine for, which is the only thing that makes any of it audible. */
function freqsFor(over: Partial<OscParams>): number[] {
  const notes: NoteRequest[] = []
  const engine = {
    playNote: (req: NoteRequest) => notes.push(req),
    nodeBusyUntil: () => 0,
    voiceLoadAt: () => 0,
    effectLoad: () => 0,
  } as never

  const params: OscParams = {
    ...defaultOscParams(),
    steps: [{ note: A4, active: true, velocity: 1 }],
    ...over,
  }
  const node: PatchNode = { id: 'o', type: 'osc', position: { x: 0, y: 0 }, params }
  getDefinition('osc')!.schedule!({
    node,
    time: 0,
    bpm: 120,
    engine,
    activity: new ActivityBus(() => 0),
  })
  return notes.map((req) => req.freq)
}

describe('detune, as the oscillator applies it', () => {
  it('asks for concert pitch when it is centred', () => {
    expect(freqsFor({ detune: 0 })[0]).toBeCloseTo(440, 6)
  })

  it('asks for a shifted pitch when it is not', () => {
    // The integration the arithmetic cannot vouch for: a correct ratio nothing multiplies by leaves every
    // oscillator in the cascade at exactly the same pitch, which is the thing detune exists to prevent.
    expect(freqsFor({ detune: 20 })[0]).toBeCloseTo(440 * detuneRatio(20), 6)
    expect(freqsFor({ detune: -20 })[0]).toBeCloseTo(440 * detuneRatio(-20), 6)
  })

  it('leaves two siblings a measurable interval apart', () => {
    // Which is the point: not that either is right, but that they are not the same.
    const [up] = freqsFor({ detune: 12 })
    const [down] = freqsFor({ detune: -12 })
    expect(up).toBeGreaterThan(down)
    // Twenty-four cents apart, which is about a fifth of a semitone — a beat rather than a chord.
    expect(up / down).toBeCloseTo(detuneRatio(24), 6)
  })
})
