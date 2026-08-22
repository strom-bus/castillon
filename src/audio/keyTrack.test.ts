/**
 * The filter following the note (PLAN §18.10).
 *
 * Absolute Hz is the wrong unit here, and not as a matter of taste: the die spreads notes across three
 * octaves, so one cutoff is bright at the top of an oscillator's range and dead at the bottom. On a
 * keyboard a player stays in a register and trims by ear; here the machine picks the register, so without
 * tracking there is no setting that suits what a roll produces.
 */

import { describe, expect, it } from 'vitest'
import { KEY_ANCHOR, MAX_CUTOFF, trackedCutoff } from './filter'
import { getDefinition, defaultOscParams } from '../nodes/registry'
import { ActivityBus } from '../viz/activity'
import type { NoteRequest } from './engine'
import type { OscParams, PatchNode } from '../types/patch'

const C4 = 60
/**
 * The range a step can hold, from the note field's own documentation: C1 to C6.
 *
 * Written out rather than taken from KEY_ANCHOR, which is the whole point. Tests that measured the range
 * from the anchor moved with it, so anchoring at middle C — the thing the anchor exists to avoid — passed
 * every one of them: every note it looked at was above the anchor by construction.
 */
const LOWEST = 24
const HIGHEST = 84

describe('key tracking', () => {
  it('sits at or below the lowest note a step can hold', () => {
    // Which is what makes the control one-directional. Anywhere above this and the notes beneath it get
    // darker as tracking goes up, from a knob that says it follows the key.
    expect(KEY_ANCHOR).toBeLessThanOrEqual(LOWEST)
  })

  it('leaves the cutoff alone when it is off', () => {
    // The default, and what every patch made before tracking existed still does.
    expect(defaultOscParams().keyTrack).toBe(0)
    for (const note of [LOWEST, C4, HIGHEST]) {
      expect(trackedCutoff(2000, note, 0)).toBe(2000)
    }
  })

  it('doubles every octave at full tracking', () => {
    // Which is the filter following pitch exactly, the thing the control is named for.
    expect(trackedCutoff(500, KEY_ANCHOR, 1)).toBeCloseTo(500, 6)
    expect(trackedCutoff(500, KEY_ANCHOR + 12, 1)).toBeCloseTo(1000, 6)
    expect(trackedCutoff(500, KEY_ANCHOR + 24, 1)).toBeCloseTo(2000, 6)
  })

  it('opens by half as much at half tracking', () => {
    // An octave up at 0.5 is half an octave of cutoff, so a factor of root two rather than of two.
    expect(trackedCutoff(500, KEY_ANCHOR + 12, 0.5)).toBeCloseTo(500 * Math.SQRT2, 6)
  })

  /*
   * The property the anchor exists for. A reference in the middle of the range would darken any patch
   * whose notes sat below it, and a knob called "key follow" that closes the filter when you turn it up
   * reads as broken. Anchored at the bottom of what a step can hold, there is no note below it to darken.
   */
  it('never darkens a note, wherever it sits in the range', () => {
    for (let note = LOWEST; note <= HIGHEST; note++) {
      for (const amount of [0.1, 0.5, 1]) {
        expect(trackedCutoff(2000, note, amount)).toBeGreaterThanOrEqual(2000)
      }
    }
  })

  it('is monotonic in the note, so a higher note is never darker than a lower one', () => {
    let last = 0
    for (let note = LOWEST; note <= HIGHEST; note++) {
      const now = trackedCutoff(300, note, 0.7)
      expect(now).toBeGreaterThanOrEqual(last)
      last = now
    }
  })

  it('is allowed to overshoot what a biquad accepts, since the voice clamps it', () => {
    // Five octaves of tracking on a cutoff already high is past audible, and the engine clamps at the
    // point it reaches the filter. Clamping here as well would put the same rule in two places.
    expect(trackedCutoff(MAX_CUTOFF, HIGHEST, 1)).toBeGreaterThan(MAX_CUTOFF)
  })
})

/**
 * A pure function priced right is no use if nothing calls it.
 *
 * So this drives the oscillator's own scheduling and reads the cutoffs it asked the engine for. Two steps
 * an octave apart, which at full tracking must come back an octave apart in Hz as well.
 */
function cutoffsFor(over: Partial<OscParams>): number[] {
  const notes: NoteRequest[] = []
  const engine = {
    playNote: (req: NoteRequest) => notes.push(req),
    nodeBusyUntil: () => 0,
    voiceLoadAt: () => 0,
    effectLoad: () => 0,
  } as never

  const params: OscParams = {
    ...defaultOscParams(),
    filterType: 'lowpass',
    cutoff: 500,
    steps: [
      { note: KEY_ANCHOR, active: true, velocity: 1 },
      { note: KEY_ANCHOR + 12, active: true, velocity: 1 },
    ],
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
  return notes.map((req) => req.cutoff)
}

describe('key tracking, as the oscillator applies it', () => {
  it('asks for the same cutoff on every note when it is off', () => {
    expect(cutoffsFor({ keyTrack: 0 })).toEqual([500, 500])
  })

  it('asks for an octave more on the note an octave up', () => {
    // The integration, which the arithmetic above cannot vouch for: a correct function nothing calls
    // leaves the filter exactly as deaf to pitch as it was.
    const [low, high] = cutoffsFor({ keyTrack: 1 })
    expect(low).toBeCloseTo(500, 6)
    expect(high).toBeCloseTo(1000, 6)
  })
})
