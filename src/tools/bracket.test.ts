import { describe, expect, it } from 'vitest'
import { formatSweep, type Found, type Sweep } from './sweep'
import type { Trial } from './probe'

/**
 * A factor is only a ratio if both halves came off the same machine.
 *
 * Four readings of the unit — a plain voice load, identical work, one machine — came out 2456, 2655, 2655
 * and 3403 points. A thirty-nine per cent spread across runs, twenty-eight of it inside a single run of
 * six subjects. Against that, comparing a subject measured in the tenth minute with a reference from the
 * zeroth is not a measurement, and the differences being asked about are ten to fifteen per cent.
 *
 * So each subject is bracketed by a reference either side of it, the factor uses their mean, and their
 * disagreement is printed as that row's own error bar. Whether the drift is thermal, or the previous
 * subject's teardown, or another window holding an AudioContext — indistinguishable from inside the page —
 * bracketing cancels all three, because all three are slower than one subject.
 */

const trial = (over: Partial<Trial> = {}): Trial => ({
  units: 256,
  points: 1000,
  underruns: 0,
  saturated: false,
  schedulerShare: 0,
  settled: true,
  buildSeconds: 1,
  ...over,
})

const found = (points: number, against?: { before: number; after: number }): Found => ({
  subject: { label: 'Pan', effect: 'pan' },
  clean: trial({ points }),
  broke: trial({ points: points * 1.1, underruns: 20 }),
  saturated: null,
  unsettled: false,
  stalled: null,
  against,
})

const reference = (points: number): Found => ({
  subject: { label: 'voices', filtered: true },
  clean: trial({ points }),
  broke: trial({ points: points * 1.1, underruns: 20 }),
  saturated: null,
  unsettled: false,
  stalled: null,
})

function reportOf(subject: Found, first = 3403, last = 2655): string {
  const sweep: Sweep = {
    supported: true,
    reference: reference(first),
    effects: [subject],
    surcharges: [],
    again: reference(last),
    idle: { events: 0, watched: 2, quiet: true },
  }
  return formatSweep(sweep)
}

/** The factor a row printed, read back out of the report. */
function factorIn(report: string, label: string): number {
  const line = report.split('\n').find((one) => one.trim().startsWith(label))!
  return Number(/model out by ([\d.]+)x/.exec(line)![1])
}

describe('a factor against the machine that measured it', () => {
  it('uses the mean of the two references bracketing the subject', () => {
    // 2000 and 3000 either side, so the comparison is against 2500 — not against whatever the run opened
    // with ten minutes earlier.
    const report = reportOf(found(2500, { before: 2000, after: 3000 }))
    expect(factorIn(report, 'Pan')).toBeCloseTo(1, 2)
  })

  it('does not use the reference at the top of the run', () => {
    /*
     * The bug this exists to kill. With the run opening at 3403 and this subject bracketed by readings
     * around 2500, the old arithmetic called it 1.36x light — a conclusion about a machine that had since
     * changed, printed as a fact about a reverb.
     */
    const report = reportOf(found(2500, { before: 2500, after: 2500 }), 3403, 2655)
    expect(factorIn(report, 'Pan')).toBeCloseTo(1, 2)
    expect(factorIn(report, 'Pan')).not.toBeCloseTo(3403 / 2500, 1)
  })

  it('prints how far the two disagree, as that row own error bar', () => {
    expect(reportOf(found(2500, { before: 2400, after: 3000 }))).toMatch(/± 25%/)
  })

  it('says to ignore a row whose error bar is wider than its figure', () => {
    // 0.86x read against references twenty-eight per cent apart is not a reading, and it used to print
    // identically to one read against references three per cent apart.
    expect(reportOf(found(2500, { before: 2400, after: 3100 }))).toMatch(/ignore this row/i)
  })

  it('keeps quiet about an error bar it does not have', () => {
    // An older result, or a path that does not bracket. Better to print no bar than a made-up one.
    const report = reportOf(found(2500))
    expect(report).not.toMatch(/±/)
    expect(factorIn(report, 'Pan')).toBeCloseTo(3403 / 2500, 2)
  })
})

describe('whether the machine was fit to measure on', () => {
  const idle = (events: number): string => {
    const sweep: Sweep = {
      supported: true,
      reference: reference(2655),
      effects: [found(2500, { before: 2600, after: 2700 })],
      surcharges: [],
      again: reference(2655),
      idle: { events, watched: 2, quiet: events === 0 },
    }
    return formatSweep(sweep)
  }

  it('says so plainly when it was', () => {
    expect(idle(0)).toMatch(/machine was idle before this started/)
  })

  it('shouts when it was not, before any figure is read', () => {
    /*
     * The precondition nobody can check by remembering. A tab holding an AudioContext makes no sound and
     * shows no indicator, and every context on the machine renders through one device — so its glitches
     * are in every row and cannot be told from the load failing.
     */
    const report = idle(14)
    expect(report).toMatch(/THE MACHINE WAS NOT IDLE/)
    expect(report).toContain('14 underruns')
    // Above the table, not in a footnote after it.
    expect(report.indexOf('NOT IDLE')).toBeLessThan(report.indexOf('Reference:'))
  })

  it('names both places to look, since it cannot tell which', () => {
    expect(idle(14)).toMatch(/another Chrome window or tab/)
    expect(idle(14)).toMatch(/second dev server/)
  })
})
