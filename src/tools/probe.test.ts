/**
 * The scheduler's one invariant: a tick's work does not grow when a tick runs late.
 *
 * This is where the sweep hung. The measurement it guards cannot be unit tested — it wants a real audio
 * thread and a real dropout — but the reason it hung is arithmetic, and arithmetic can be pinned down.
 */

import { describe, expect, it } from 'vitest'
import { fires } from './probe'

/** HORIZON / (1 / NOTE_RATE), from probe.ts: how many notes one tick may ever owe. */
const MOST = 2

describe('the note scheduler', () => {
  it('fires a note now when a slot has never run', () => {
    const due = fires(10, 10)
    expect(due.times[0]).toBe(10)
    expect(due.next).toBeGreaterThan(10)
  })

  it('schedules only up to the horizon, not beyond it', () => {
    const due = fires(10, 10)
    for (const at of due.times) expect(at).toBeLessThan(10 + 0.25)
  })

  it('does not fire a slot that is already scheduled past the horizon', () => {
    expect(fires(10.5, 10).times).toEqual([])
  })

  it('never schedules a note in the past', () => {
    // A slot two seconds behind: the note it fires is now, not two seconds ago.
    for (const at of fires(8, 10).times) expect(at).toBeGreaterThanOrEqual(10)
  })

  /*
   * The regression itself. Lateness used to multiply the work: a slot two seconds behind owed twelve
   * notes, twenty seconds behind owed a hundred and twenty, and paying that debt is what made the next
   * tick later. The count must not depend on how far behind it is.
   */
  it.each([0, 0.5, 2, 20, 600])('owes no more notes when %s seconds behind', (behind) => {
    expect(fires(10 - behind, 10).times.length).toBeLessThanOrEqual(MOST)
  })

  it('leaves a late slot caught up rather than still behind', () => {
    // Otherwise the debt survives the tick and rebuilds on the next one.
    expect(fires(10 - 20, 10).next).toBeGreaterThanOrEqual(10)
  })

  it('keeps the rate steady across ticks that are on time', () => {
    let at = 10
    let fired = 0
    for (let tick = 0; tick < 20; tick++) {
      const due = fires(at, 10 + tick * 0.05)
      fired += due.times.length
      at = due.next
    }
    // Twenty ticks of fifty milliseconds is one second, which at six notes a second is six notes — plus
    // whatever the horizon has already reached into the second after.
    expect(fired).toBeGreaterThanOrEqual(6)
    expect(fired).toBeLessThanOrEqual(8)
  })
})
