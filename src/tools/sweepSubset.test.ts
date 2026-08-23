import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { EFFECTS } from '../audio/effects'
import { selectedSubjects } from './sweep'

/**
 * Sweeping some of the table rather than all of it.
 *
 * A whole sweep is a quarter of an hour, which is the right price for establishing the table and the
 * wrong price for re-reading one figure. Pan is why this exists: its cost was measured the day before the
 * probe was fixed, and the fault that was fixed was specifically *its* — so it is the one entry whose
 * number comes from an instrument known to have been wrong about it, and confirming it should not cost
 * ten readings nobody doubts.
 */

describe('choosing what a sweep covers', () => {
  it('covers everything when nothing is asked for', () => {
    expect(selectedSubjects()).toHaveLength(EFFECTS.length)
    expect(selectedSubjects({})).toHaveLength(EFFECTS.length)
    expect(selectedSubjects({ only: [] })).toHaveLength(EFFECTS.length)
  })

  it('covers one when one is asked for', () => {
    expect(selectedSubjects({ only: ['Pan'] })).toEqual(['Pan'])
  })

  it('does not mind the case or the spaces, since it comes out of a URL', () => {
    expect(selectedSubjects({ only: ['pan'] })).toEqual(['Pan'])
    expect(selectedSubjects({ only: ['  PAN  '] })).toEqual(['Pan'])
  })

  it('covers several, in the table order rather than the order asked', () => {
    // So two runs of the same set produce comparable reports, and so a subset reads as part of the
    // table it came from rather than as a list somebody typed.
    const both = selectedSubjects({ only: ['pan', 'reverb'] })
    expect(both).toEqual(['Reverb', 'Pan'])
  })

  it('covers nothing for a name that is not an effect, rather than everything', () => {
    /*
     * The dangerous failure: falling back to the full list on a typo would run for a quarter of an hour
     * when somebody asked for one effect, and — worse — a fallback to *everything* on an empty match
     * makes a typo indistinguishable from asking for the lot.
     */
    expect(selectedSubjects({ only: ['panner'] })).toEqual([])
    expect(selectedSubjects({ only: ['nonsense'] })).toEqual([])
  })

  it('names every effect the table has, so nothing is unreachable', () => {
    // A subset is only useful if any one row can be asked for by the name printed in the report.
    for (const descriptor of EFFECTS) {
      expect(selectedSubjects({ only: [descriptor.label] }), descriptor.label).toEqual([
        descriptor.label,
      ])
    }
  })
})

describe('what a subset may never skip', () => {
  const source = readFileSync('src/tools/sweep.ts', 'utf8')

  it('takes the reference outside anything a subset can turn off', () => {
    /*
     * Every figure in this table is a ratio against a plain voice measured on the same machine in the
     * same minute. A run without that reference produces points rather than costs — a number that cannot
     * be compared with the table it was run to correct, and that looks exactly like one that can.
     *
     * Read from the source because there is no way to assert it by calling: the reference is measured
     * inside `run`, which needs a real `AudioContext` with underrun statistics and so cannot be reached
     * from a test at all. What can be checked is that no filter stands between the two.
     */
    const body = source.slice(source.indexOf('async function run('))
    const reference = body.indexOf("attempted({ label: 'voices'")
    const filter = body.indexOf('wantedEffects')

    expect(reference).toBeGreaterThan(-1)
    expect(filter).toBeGreaterThan(-1)
    // Measured before the subset is even worked out, which is the only arrangement that cannot go wrong.
    expect(reference).toBeLessThan(filter)
  })

  it('reads the second reference too, which is how a sweep checks itself', () => {
    // Two readings of the same subject, before and after. They are what say whether the machine drifted
    // mid-run, so a subset that dropped the second would report figures with nothing vouching for them.
    expect(source).toContain("label: 'voices again'")
    const body = source.slice(source.indexOf('async function run('))
    expect(body.indexOf("'voices again'")).toBeGreaterThan(body.indexOf('wantedEffects'))
  })
})

describe('whether a subset measures the surcharges', () => {
  /*
   * They are skipped by default, because they are the slowest half of a run and they answer a different
   * question. But they are also where the self-check lives — the filter is measured once as an effect and
   * again as `filter · unswept`, and those two disagreeing is the only thing that catches a spurious
   * break. So a subset has to be able to ask for them, or a short run can never vouch for itself.
   */
  const source = readFileSync('src/tools/sweep.ts', 'utf8')

  it('skips them for a subset and keeps them for a whole run', () => {
    const line = /const wantSurcharges = ([^\n]+)/.exec(source)?.[1] ?? ''
    expect(line).toContain('options.surcharges')
    expect(line).toContain('length === 0')
  })

  it('is asked for from the address, alongside which effects to cover', () => {
    // A link somebody can be handed, which is the whole reason the subset is a URL and not a control.
    const page = readFileSync('src/tools/measurePage.ts', 'utf8')
    expect(page).toContain("query.get('surcharges')")
    expect(page).toMatch(/surcharges:\s*surcharges/)
  })

  it('keeps them on a whole run even when the flag is absent', () => {
    // Otherwise adding the flag would have quietly changed what the plain SWEEP button does.
    const page = readFileSync('src/tools/measurePage.ts', 'utf8')
    expect(page).toMatch(/surcharges \|\| only\.length === 0/)
  })
})
