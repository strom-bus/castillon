import { describe, expect, it } from 'vitest'
import { EFFECTS } from '../audio/effects'
import { LFO_SHAPES } from '../audio/modulation'
import { SCALES } from '../audio/scales'
import { WAVEFORMS } from '../audio/waveforms'
import { NODE_DEFINITIONS } from '../nodes/registry'
import { DIRECTIONS, DIVISIONS, EDGE_KINDS, PROPAGATE_MODES } from '../types/patch'
import { indexedTables } from './patchCode'

/**
 * That every enumerated table in the wire format still covers what the app can make, and still fits.
 *
 * Two failures, both completely silent, and the first one is what this file was written for.
 *
 * **A value the table has never heard of.** The format stores an index, `indexOf` answers -1 for anything
 * missing, and the clamp turns that into 0 — so a patch containing the twelfth effect encodes as the
 * *first* one and decodes as a reverb. Adding the comb resonator and forgetting to append it changed
 * nothing any test could see; deleting it from `EFFECT_CODES` left all 1387 of them green. Waveforms
 * happened to be covered, by a hand-written list of ten that was still complete and by the stress patch
 * exercising each one — which is luck rather than a guard, and the hand-written list is now this one.
 *
 * **A table outgrowing its width.** The bit count is frozen wire format and written at each call site, so
 * nothing stops a table reaching a seventeenth entry behind four bits and truncating every index from
 * then on.
 *
 * Asked of the tables rather than of a list of tables: `indexField` records each one as it is declared.
 */

/**
 * Which live table each format table is supposed to cover.
 *
 * The one thing here that cannot be derived — that `effect` means `EFFECTS` is a fact about the
 * instrument, not about either table — so it is written out, and the test below refuses to run unless it
 * accounts for every format table there is. A new enumerated parameter fails here until somebody says
 * what it enumerates, which is the right moment to be asked.
 */
const COVERS: Record<string, readonly unknown[] | null> = {
  effect: EFFECTS.map((descriptor) => descriptor.kind),
  waveform: WAVEFORMS,
  scale: SCALES,
  modWave: LFO_SHAPES,
  nodeType: NODE_DEFINITIONS.map((definition) => definition.type),
  edgeKind: EDGE_KINDS,
  division: DIVISIONS,
  // The echo's time, which borrows the same table: a beat division either way.
  time: DIVISIONS,
  propagateMode: PROPAGATE_MODES,
  direction: DIRECTIONS,
  /*
   * The ones whose values are the format's own vocabulary and live nowhere else. `null` means "there is
   * nothing to compare it with", which is a claim worth making explicitly: it is the difference between a
   * table nobody checked and a table with nothing to check it against.
   */
  filterType: null,
  shape: null,
  swing: null,
}

describe('the wire format tables', () => {
  const tables = indexedTables()

  it('are found by being declared, not by being listed', () => {
    // The guard against this whole file passing by finding nothing.
    expect(tables.length).toBeGreaterThan(8)
  })

  it('are all accounted for, so a new one cannot slip past unexamined', () => {
    const unknown = tables.map((table) => table.key).filter((key) => !(key in COVERS))
    expect(unknown, `no entry saying what these enumerate: ${unknown.join(', ')}`).toEqual([])
  })

  it('each fit inside the width the format gives them', () => {
    const overrun = tables
      .filter((table) => table.size > 2 ** table.bits)
      .map((table) => `${table.key}: ${table.size} entries behind ${table.bits} bits`)
    expect(overrun, `truncating indices: ${overrun.join('; ')}`).toEqual([])
  })

  it('each cover every value the app can actually make', () => {
    const short = tables
      .filter((table) => COVERS[table.key] != null)
      .filter((table) => table.size < COVERS[table.key]!.length)
      .map(
        (table) => `${table.key}: ${table.size} in the format, ${COVERS[table.key]!.length} live`,
      )

    expect(short, `values that cannot be stored: ${short.join('; ')}`).toEqual([])
  })

  it('found something to compare, so the comparison is not empty', () => {
    // Every entry in COVERS being null would make the test above vacuous while reading as thorough.
    const compared = tables.filter((table) => COVERS[table.key] != null)
    expect(compared.length).toBeGreaterThan(4)
  })
})
