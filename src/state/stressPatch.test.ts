import { describe, expect, it } from 'vitest'
// Imported through Vite rather than read off disk, so the test needs neither Node types nor a
// guess about the working directory.
import stressPatchFile from '../../docs/stress-patch.txt?raw'
import { FILTER_TYPES } from '../audio/filter'
import { WAVEFORMS } from '../audio/waveforms'
import type { OscParams, WarpParams } from '../types/patch'
import { LAYER_THRESHOLD, MAX_LOAD } from '../audio/load'
import { stressLoad, stressPatch } from '../tools/stressPatch'
import { permits } from './connections'
import { decodePatch, encodePatch } from './patchCode'

/**
 * The load-test patch lives as a code in a text file, which means a change to the patch-code
 * format can quietly rot it — it did once, when the tempo field grew a bit. This decodes the
 * real file so that failure surfaces here instead of the next time someone pastes it in.
 *
 * To regenerate: `npm run stress`. It was a hand operation — build it in the app, copy the field — and
 * that is why this file also checks the code against the generator: a wrong paste produces a code that
 * decodes to a slightly different patch, and nothing about the file would look wrong.
 */
const code = stressPatchFile
  .trim()
  .split('\n')
  .map((line: string) => line.trim())
  .filter((line: string) => /^[A-Za-z0-9_-]{200,}$/.test(line))
  .at(-1)

describe('the load-test patch', () => {
  it('is the patch the generator makes, not a paste that drifted from it', () => {
    // The strongest form this check can take: the file and the generator either agree exactly or the
    // file is stale. `npm run stress` is the fix, and the test says so by failing rather than by
    // silently testing whatever was pasted in last.
    expect(code, 'docs/stress-patch.txt is stale — run `npm run stress`').toBe(
      encodePatch(stressPatch()),
    )
  })

  it('still exercises everything a step can carry', () => {
    /*
     * The failure this has already had once in a different form: a load test written against the
     * parameters that existed when it was written stops being a test of the engine and becomes a test
     * of its history. Rolls put four voices where one was and warp speed multiplies every oscillator's
     * note rate, so these are load and not only format.
     */
    const patch = decodePatch(code as string)!
    const oscillators = patch.nodes
      .filter((n) => n.type === 'osc')
      .map((n) => n.params as OscParams)
    const steps = oscillators.flatMap((params) => params.steps)

    expect(oscillators.some((params) => params.useChance)).toBe(true)
    expect(oscillators.some((params) => params.useRatchet)).toBe(true)
    expect(steps.some((step) => (step.ratchet ?? 1) > 1)).toBe(true)
    expect(steps.some((step) => (step.ratchetRamp ?? 0) !== 0)).toBe(true)
    expect(steps.some((step) => step.velocity < 1)).toBe(true)
    expect(steps.some((step) => step.slide === true)).toBe(true)
    expect(oscillators.some((params) => (params.scale ?? 'free') !== 'free')).toBe(true)
    expect(oscillators.some((params) => (params.detune ?? 0) !== 0)).toBe(true)
    expect(oscillators.some((params) => (params.keyTrack ?? 0) > 0)).toBe(true)
    // The one control that multiplies the note rate of everything below it.
    const warps = patch.nodes.filter((node) => node.type === 'warp')
    expect(warps).toHaveLength(1)
    expect((warps[0]!.params as WarpParams).speed).not.toBe(1)
  })

  it('wires only cables the instrument has', () => {
    // It had a warp on the Ignite, which the rules permitted and the canvas could not draw.
    const patch = decodePatch(code as string)!
    for (const edge of patch.edges) {
      const from = patch.nodes.find((n) => n.id === edge.source)?.type
      const to = patch.nodes.find((n) => n.id === edge.target)?.type
      expect(permits(from, to, edge.kind), `no ${edge.kind} cable runs from ${from} to ${to}`).toBe(
        true,
      )
    }
  })

  it('sits between degrading and breaking, which is the only useful place', () => {
    /*
     * Past the layering threshold, so the designed degradation is what you are listening to, and short
     * of the ceiling, so it is not certain to glitch. A test that always breaks says nothing about
     * where breaking begins, and one that never does says less.
     */
    const { voices, effects } = stressLoad(stressPatch())
    const total = voices + effects
    expect(total, `${total.toFixed(0)} points`).toBeGreaterThan(MAX_LOAD * LAYER_THRESHOLD)
    expect(total, `${total.toFixed(0)} points`).toBeLessThan(MAX_LOAD)
  })

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
