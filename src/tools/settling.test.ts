import { describe, expect, it } from 'vitest'
import { formatSweep, type Found, type Sweep } from './sweep'
import type { Trial } from './probe'

/**
 * What a sweep says when a subject could not be read.
 *
 * It said "no reading — the audio thread never went quiet, so nothing here could be trusted", and that
 * was not enough to act on. A run reported it for the filter subject, which is the one subject measured
 * twice — so the sweep's own self-check could not run and the whole table invalidated itself, correctly,
 * on the strength of a message that named no cause.
 *
 * The retry on a fresh context is already automatic, so such a failure has happened *twice*, the second
 * time on a context carrying nothing at all. That rules out the obvious story and leaves three quite
 * different faults that all printed identically. Now they do not.
 */

const trial = (over: Partial<Trial> = {}): Trial => ({
  units: 256,
  points: 0,
  underruns: 0,
  saturated: false,
  schedulerShare: 0,
  settled: false,
  buildSeconds: 0,
  ...over,
})

const found = (over: Partial<Found> = {}): Found => ({
  subject: { label: 'Filter', effect: 'filter' },
  clean: null,
  broke: null,
  saturated: null,
  unsettled: false,
  stalled: null,
  ...over,
})

const reference = found({
  subject: { label: 'voices', filtered: true },
  clean: trial({ units: 352, points: 2655, settled: true }),
  broke: trial({ units: 384, points: 2900, settled: true, underruns: 20 }),
})

function reportOf(subject: Found): string {
  const sweep: Sweep = {
    supported: true,
    reference,
    effects: [subject],
    surcharges: [],
    again: reference,
  }
  return formatSweep(sweep)
}

const stalled = (waited: number, events: number) =>
  reportOf(
    found({ unsettled: true, stalled: trial({ settling: { settled: false, waited, events } }) }),
  )

describe('a subject that would not settle', () => {
  it('says how long it waited and what kept arriving', () => {
    const report = stalled(4, 37)
    expect(report).toContain('4.0s')
    expect(report).toContain('37 underruns')
  })

  it('reads a flood as the device being busy, without guessing with what', () => {
    /*
     * Better than nine a second on a context carrying nothing. Every `AudioContext` on the machine shares
     * one audio device, so it can be a context this run closed still tearing down — `close()` resolving is
     * not the thread going idle — or another tab holding one, the app itself included. From inside the page
     * those are indistinguishable, and naming one would send somebody looking in the wrong place half the
     * time.
     */
    const report = stalled(4, 37)
    expect(report).toMatch(/audio device is busy with something else/)
    expect(report).toMatch(/another tab/)
  })

  it('reads a trickle as the patience being too short', () => {
    // Two underruns in four seconds is a thread that had nearly finished. That is a constant to raise,
    // not a bug to find, and it must not be reported as the same thing as a flood.
    expect(stalled(4, 2)).toMatch(/patience is too short/)
  })

  it('reads none at all as this very check being the fault', () => {
    /*
     * The case worth separating most. No underruns arrived and it still reports unsettled, which cannot be
     * a property of the load: it means the counter is not moving, and every "never went quiet" in the run
     * is the instrument rather than the subject.
     */
    expect(stalled(4, 0)).toMatch(/counter is not moving/)
  })

  it('admits when it recorded nothing, rather than implying a cause', () => {
    // A stalled trial from before this existed, or one lost on a path that does not keep it.
    expect(reportOf(found({ unsettled: true }))).toContain('nothing recorded about the wait')
  })

  it('still says which subject it was', () => {
    expect(stalled(4, 37)).toContain('Filter')
  })
})
