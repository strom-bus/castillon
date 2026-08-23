import { describe, expect, it } from 'vitest'
// Imported through Vite rather than read off disk, so the test needs neither Node types nor a
// guess about the working directory.
import stressPatchFile from '../../docs/stress-patch.txt?raw'
import { FILTER_TYPES } from '../audio/filter'
import { WAVEFORMS } from '../audio/waveforms'
import type { OscParams } from '../types/patch'
import { decodePatch } from './patchCode'

/**
 * The load-test patch lives as a code in a text file, which means a change to the patch-code
 * format can quietly rot it — it did once, when the tempo field grew a bit. This decodes the
 * real file so that failure surfaces here instead of the next time someone pastes it in.
 *
 * To regenerate: build the patch in the app, copy the PATCH CODE field into the file.
 */
const code = stressPatchFile
  .trim()
  .split('\n')
  .map((line: string) => line.trim())
  .filter((line: string) => /^[A-Za-z0-9_-]{200,}$/.test(line))
  .at(-1)

describe('the load-test patch', () => {
  it('has a code in the file at all', () => {
    expect(code).toBeDefined()
  })

  it('still decodes under the current format', () => {
    expect(decodePatch(code as string)).not.toBeNull()
  })

  it('is big enough to actually load the engine', () => {
    const patch = decodePatch(code as string)!
    const oscillators = patch.nodes.filter((n) => n.type === 'osc')
    expect(oscillators.length).toBeGreaterThanOrEqual(20)
    expect(patch.loop).toBe(true)
  })

  it('exercises every waveform, filter and sequence length', () => {
    // Otherwise it stops being a load test of the whole engine and only covers what it happens
    // to use, which is how a gap gets missed.
    const oscillators = decodePatch(code as string)!
      .nodes.filter((n) => n.type === 'osc')
      .map((n) => n.params as OscParams)

    expect(new Set(oscillators.map((p) => p.waveform)).size).toBe(WAVEFORMS.length)
    expect(new Set(oscillators.map((p) => p.filterType)).size).toBe(FILTER_TYPES.length)
    expect([...new Set(oscillators.map((p) => p.steps.length))].sort((a, b) => a - b)).toEqual([
      2, 4, 8, 16,
    ])
  })

  it('is one connected cascade, not islands that never fire', () => {
    /*
     * Followed both ways along a cable, not only forwards.
     *
     * A modulator is never anything's target — it points at what it sweeps, so nothing points at it, and
     * walking only forwards from an Ignite leaves every one of them looking like an island. The patch
     * this replaces had none, so the rule was never wrong and never tested either. What is actually
     * being asked is that no node is stranded, and a cable connects whichever end you start from.
     */
    const patch = decodePatch(code as string)!
    const joined = new Set(patch.nodes.filter((n) => n.type === 'start').map((n) => n.id))
    for (let pass = 0; pass < patch.nodes.length; pass++) {
      for (const edge of patch.edges) {
        if (joined.has(edge.source)) joined.add(edge.target)
        if (joined.has(edge.target)) joined.add(edge.source)
      }
    }

    const stranded = patch.nodes.filter((n) => !joined.has(n.id)).map((n) => `${n.type} ${n.id}`)
    expect(stranded).toEqual([])
  })
})
