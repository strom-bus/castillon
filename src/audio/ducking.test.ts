import { describe, expect, it } from 'vitest'
import { AudioEngine, type NoteRequest } from './engine'
import { fakeAudio, type FakeAudio } from './fakeAudio'
import { amountFor, targetsFor } from './modulation'
import type { ModParams } from '../types/patch'

/**
 * Ducking, whose key is a trigger from the cascade rather than a signal.
 *
 * The thing this instrument can do that no other one can, and it turned out to be already built: an
 * envelope fired by a trigger, pointed at an oscillator's level, with the depth taken below zero. What
 * was missing was a name — six choices deep with nothing saying what they add up to.
 *
 * Which makes it worth testing carefully, because nothing about it is a feature that could fail loudly.
 * If the sign is dropped anywhere along the way, ducking silently becomes *boosting*: the pad swells
 * where it should get out of the way, on a patch that still plays and still looks right.
 */

const note: NoteRequest = {
  nodeId: 'pad',
  time: 1,
  freq: 440,
  waveform: 'sawtooth',
  pulseWidth: 0.5,
  duration: 1,
  gain: 0.5,
  attack: 5,
  decay: 0,
  release: 50,
  glide: 0,
  velocity: 1,
  filterType: 'off',
  cutoff: 1000,
  resonance: 2,
}

/** Every gain value standing after a modulator is wired to an oscillator's level at this depth. */
function gainsAfterConnecting(depth: number): number[] {
  const fake: FakeAudio = fakeAudio()
  const engine = new AudioEngine()
  engine.adopt(fake.ctx)
  // A voice first, so the oscillator has a bus for `level` to mean something.
  engine.playNote(note)
  const params: ModParams = {
    kind: 'env',
    fires: 'trigger',
    target: 'level',
    depth,
    attack: 2,
    decay: 320,
  }
  engine.createModulator('d', params)
  engine.connectMod('d', 'pad', 'level', depth)
  return fake.params('gain').map((one) => one.value)
}

describe('a modulation that pulls down', () => {
  const level = targetsFor('osc').find((one) => one.key === 'level')!

  it('sets a negative amount on the way to the level', () => {
    // The whole of ducking, in one number. Positive here and the pad swells where it should get out of
    // the way — a patch that still plays, still looks right, and does the opposite of what was asked.
    expect(gainsAfterConnecting(-0.8).some((value) => value < 0)).toBe(true)
  })

  it('sets a positive one when the depth is positive, so the sign is carried and not assumed', () => {
    expect(gainsAfterConnecting(0.8).every((value) => value >= 0)).toBe(true)
  })

  it('scales the amount by the target’s own span rather than passing the depth through', () => {
    /*
     * Depth is a share, so the same 0.8 means eight tenths of a level and eight tenths of a filter's
     * whole range. Passing it through unscaled would duck by 0.8 of *one*, which happens to be nearly
     * right for a level and wildly wrong for everything else — the kind of mistake that looks fine on
     * the one target you tested it on.
     */
    const wanted = amountFor(level, -0.8)
    expect(gainsAfterConnecting(-0.8)).toContainEqual(wanted)
    expect(Math.abs(wanted)).toBeLessThan(0.8)
  })

  it('reaches zero depth as no change at all', () => {
    expect(gainsAfterConnecting(0).some((value) => value !== 0)).toBe(true)
    expect(amountFor(level, 0)).toBe(0)
  })
})
