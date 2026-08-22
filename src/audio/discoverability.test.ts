/**
 * Controls that only appear once you have already found them.
 *
 * The inspector hides what would not work, which is right — a control that does nothing is worse than no
 * control. The cost is that anything three selections deep is invisible from where a person is standing,
 * and nothing about the two selections before it says there is a third.
 *
 * These pin the pointers, because a hint is prose and prose gets rewritten. Losing one costs nothing that
 * fails: the feature simply stops being findable, which is how it was reported in the first place.
 */

import { describe, expect, it } from 'vitest'
import { MOD_FIRES_HINTS, MOD_KIND_HINTS } from './modulation'

describe('finding what a modulator can do', () => {
  it('mentions velocity from the setting one step before it', () => {
    /*
     * A MOD is an LFO until told otherwise and an envelope fires on a trigger until told otherwise, so
     * scaling by velocity is three choices in. Somebody reading the trigger hint is exactly one choice
     * away, which makes it the only place worth saying so.
     */
    expect(MOD_FIRES_HINTS.trigger.toLowerCase()).toContain('velocity')
  })

  it('says so on the setting that has it, too', () => {
    expect(MOD_FIRES_HINTS.note.toLowerCase()).toContain('velocity')
  })

  it('keeps the hints to a length somebody will read', () => {
    // A pointer nobody finishes is not a pointer. Long enough to say what it does, short enough to scan.
    for (const hint of [...Object.values(MOD_FIRES_HINTS), ...Object.values(MOD_KIND_HINTS)]) {
      expect(hint.length).toBeGreaterThan(20)
      expect(hint.length).toBeLessThan(320)
    }
  })
})
