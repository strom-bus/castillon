/**
 * The shape of a voice between its attack and its release (PLAN §18.9).
 *
 * A decay time and a note length are set independently, so either can be the shorter, and the two
 * orderings are genuinely different sounds rather than two spellings of one. What must not happen is the
 * third thing: a release that starts from the attack peak and undoes the decay on its way out.
 *
 * There is deliberately no sustain level. On a keyboard, sustain exists because the instrument cannot
 * know how long the key will be held; here a note is scheduled with a duration decided in advance, and
 * then a decay time already spans percussive to sustained on its own.
 */

import { describe, expect, it } from 'vitest'
import { AudioEngine } from './engine'
import { fakeAudio } from './fakeAudio'
import type { NoteRequest } from './engine'

const PEAK = 0.5

function note(over: Partial<NoteRequest> = {}): NoteRequest {
  return {
    nodeId: 'o',
    time: 1,
    freq: 440,
    waveform: 'square',
    pulseWidth: 0.5,
    // A second long, so a decay can be set either side of it in round numbers.
    duration: 1,
    gain: PEAK,
    attack: 10,
    decay: 0,
    glide: 0,
    velocity: 1,
    release: 100,
    filterType: 'off',
    cutoff: 2000,
    resonance: 1,
    ...over,
  }
}

/** The values written to the voice's own gain, in order. The master's is set separately. */
function envelope(over: Partial<NoteRequest> = {}): number[] {
  const fake = fakeAudio()
  const engine = new AudioEngine()
  engine.adopt(fake.ctx)
  const before = fake.journal.length
  engine.playNote(note(over))
  return fake.journal
    .slice(before)
    .filter((write) => write.what === 'gain')
    .map((write) => write.value as number)
}

describe('a voice envelope', () => {
  it('holds the peak until the note ends when there is no decay', () => {
    // The default, and what every patch made before decay existed still does.
    expect(envelope()).toEqual([0, PEAK, PEAK, 0])
  })

  it('falls silent inside the note when the decay is shorter than it', () => {
    // A pluck: the point of a decay is the silence it leaves to sit in.
    const shape = envelope({ decay: 300 })
    expect(shape[0]).toBe(0)
    expect(shape[1]).toBe(PEAK)
    expect(shape.slice(2)).toEqual([0, 0, 0])
  })

  it('hands the release what is left when the note ends first', () => {
    /*
     * The case that would break silently. A ramp scheduled to a time already past is ignored, so the
     * release would start from the peak — a note that decays for a while and then jumps back up to full
     * before fading. The remainder has to be worked out rather than left to the automation.
     */
    const shape = envelope({ decay: 2000 })
    expect(shape[0]).toBe(0)
    expect(shape[1]).toBe(PEAK)
    expect(shape[2]).toBeGreaterThan(0)
    expect(shape[2]).toBeLessThan(PEAK)
    expect(shape[3]).toBe(0)
  })

  it('leaves half the peak when the note ends halfway through the decay', () => {
    // Pinned as arithmetic rather than as an inequality: a note lasting a second, its peak reached ten
    // milliseconds in, against a two-second decay, is a hair past halfway down.
    const shape = envelope({ decay: 2000 })
    expect(shape[2]).toBeCloseTo(PEAK * (1 - 0.99 / 2), 3)
  })

  it('meets itself where the decay and the note are the same length', () => {
    /*
     * The seam between the two branches, which is the only place they can disagree.
     *
     * A decay ending exactly with the note has nothing left to hand over, so both sides read zero there
     * and the sound crossing that boundary does not jump. This replaced a test that claimed to check the
     * remainder never goes negative — it cannot, since the branch computing it only runs when the decay
     * outlasts the note, and the test exercised the other branch entirely.
     */
    const together = envelope({ decay: 990, duration: 1 })
    expect(together[2]).toBeCloseTo(0, 6)
    // A hair either side of the seam agrees with it.
    expect(envelope({ decay: 985, duration: 1 })[2]).toBeCloseTo(0, 2)
    expect(envelope({ decay: 995, duration: 1 })[2]).toBeCloseTo(0, 2)
  })
})
