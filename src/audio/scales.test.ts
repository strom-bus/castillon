/**
 * Which notes a sequencer may land on (PLAN §18.17).
 *
 * The whole feature is one function called while a bar is dragged, and one button that runs it over a
 * sequence on purpose. Everything worth being sure of is in the arithmetic.
 */

import { describe, expect, it } from 'vitest'
import { pitchesOf, ROOT_NAMES, SCALES, SCALE_NAMES, snapToScale, transposeBy } from './scales'
import { defaultOscParams } from '../nodes/registry'

describe('a scale', () => {
  it('is free by default, which is what everything did before scales existed', () => {
    expect(defaultOscParams().scale).toBe('free')
    for (const note of [60, 61, 62, 63]) expect(snapToScale(note, 'free', 0)).toBe(note)
  })

  it('has a name for every one it offers', () => {
    // A select showing a key rather than a name is a bug nobody notices until they read it.
    for (const scale of SCALES) expect(SCALE_NAMES[scale]).toBeTruthy()
    expect(ROOT_NAMES).toHaveLength(12)
  })

  it('leaves a note that is already in the scale exactly where it is', () => {
    // C major on C: every white key is already home, and a snap that moved them would be a bug you
    // would only hear.
    for (const note of [60, 62, 64, 65, 67, 69, 71, 72]) {
      expect(snapToScale(note, 'major', 0), String(note)).toBe(note)
    }
  })

  it('moves one that is not to the nearest that is', () => {
    // C# in C major is a semitone from both C and D, and the tie goes up: a drag that has just moved
    // up should not land below where it started.
    expect(snapToScale(61, 'major', 0)).toBe(62)
    // F# is a semitone below G and a whole one above F, so there is no tie to break.
    expect(snapToScale(66, 'major', 0)).toBe(67)
  })

  it('follows the root, so the same scale in another key allows other notes', () => {
    // D major has F# where C major has F, which is the only thing a root can mean.
    expect(snapToScale(65, 'major', 2)).toBe(66)
    expect(snapToScale(65, 'major', 0)).toBe(65)
  })

  it('always lands on something the scale allows', () => {
    /*
     * The property that matters, over every scale and every note in the range rather than over the few
     * a test would think to name. A snap that misses is a bar that will not sit still.
     */
    for (const scale of SCALES) {
      const allowed = pitchesOf(scale, 7)
      if (!allowed) continue
      for (let note = 24; note <= 84; note++) {
        const snapped = snapToScale(note, scale, 7)
        expect(allowed.has(((snapped % 12) + 12) % 12), `${scale} ${note}`).toBe(true)
      }
    }
  })

  it('never moves a note more than half an octave to get there', () => {
    // Every scale here has a note within three semitones of anywhere, so a larger jump would mean the
    // search had walked past its answer.
    for (const scale of SCALES) {
      for (let note = 24; note <= 84; note++) {
        expect(
          Math.abs(snapToScale(note, scale, 5) - note),
          `${scale} ${note}`,
        ).toBeLessThanOrEqual(6)
      }
    }
  })
})

describe('transposing by steps', () => {
  it('counts semitones where anything is allowed', () => {
    // With no scale there are no degrees to count, so the number means the only thing left.
    expect(transposeBy(60, 4, 'free', 0)).toBe(64)
    expect(transposeBy(60, -3, 'free', 0)).toBe(57)
  })

  it('counts degrees where there is a scale, which is what a musician means', () => {
    /*
     * "A third up" is two degrees. In C major that is four semitones and in C minor it is three, and
     * neither is a number anybody wants to think about — which is the whole argument for the unit.
     */
    expect(transposeBy(60, 2, 'major', 0)).toBe(64)
    expect(transposeBy(60, 2, 'minor', 0)).toBe(63)
  })

  it('reaches the octave at a scale full of steps', () => {
    expect(transposeBy(60, 7, 'major', 0)).toBe(72)
    expect(transposeBy(60, 5, 'pentatonic', 0)).toBe(72)
  })

  it('counts down the same way it counts up', () => {
    expect(transposeBy(60, -1, 'major', 0)).toBe(59)
    expect(transposeBy(60, -7, 'major', 0)).toBe(48)
  })

  it('leaves a note alone when asked for nothing', () => {
    for (const scale of SCALES) expect(transposeBy(63, 0, scale, 3)).toBe(63)
  })

  it('lands in the scale even from a note that was never in it', () => {
    // Otherwise a transform would quietly do nothing to whatever it did not recognise, which is the
    // most confusing way for a control to fail.
    const allowed = pitchesOf('minorPentatonic', 0)!
    for (let note = 48; note <= 72; note++) {
      const moved = transposeBy(note, 3, 'minorPentatonic', 0)
      expect(allowed.has(((moved % 12) + 12) % 12), String(note)).toBe(true)
    }
  })

  it('always moves upward for a positive number of steps', () => {
    for (const scale of SCALES) {
      for (let note = 36; note <= 72; note++) {
        expect(transposeBy(note, 2, scale, 2), `${scale} ${note}`).toBeGreaterThan(note)
      }
    }
  })
})
