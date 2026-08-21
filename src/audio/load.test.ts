import { describe, expect, it } from 'vitest'
import { defaultFxParams, defaultOscParams } from '../nodes/registry'
import type { FxParams, Patch, PatchNode } from '../types/patch'
import { EFFECTS } from './effects'
import {
  effectCost,
  estimatePeakLoad,
  LAYER_THRESHOLD,
  MAX_LOAD,
  oscVoiceCost,
  voiceCost,
  voiceOverlap,
} from './load'

describe('the unit', () => {
  it('is one plain oscillator voice', () => {
    // Everything else is priced against this, which is what lets the meter read as a percentage and
    // what made the old voice-counting budget carry over without recalibration.
    expect(voiceCost('square', false)).toBe(1)
    expect(voiceCost('sine', false)).toBe(1)
  })

  it('charges a wavetable the same as a native oscillator', () => {
    // These were priced higher on the reasoning that a band-limited table read must cost more. It
    // does not: a native oscillator is a table read too, and the wave is built once and cached.
    for (const wave of ['pulse', 'ramp'] as const) {
      expect(voiceCost(wave, false)).toBe(voiceCost('square', false))
    }
  })

  it('charges noise more than an oscillator, not less', () => {
    // The guess that a buffer read must be cheaper than band-limiting was backwards. It is a looping
    // resample with interpolation, against an oscillator that has had years of optimisation.
    expect(voiceCost('pink', false)).toBeGreaterThan(voiceCost('square', false) * 2)
  })

  it('adds the per-voice filter, at most of an oscillator', () => {
    expect(voiceCost('square', true)).toBeGreaterThan(voiceCost('square', false))
    // 0.8 measured offline and 1.05 in realtime, against a *reasoned* 0.3. The arithmetic in a biquad is
    // trivial; being a second node in the graph is not, and that is what dominates.
    expect(voiceCost('square', true)).toBeCloseTo(2.05, 5)
  })

  it('reads the cost straight off an oscillator’s parameters', () => {
    expect(oscVoiceCost({ ...defaultOscParams(), waveform: 'square', filterType: 'off' })).toBe(1)
    expect(
      oscVoiceCost({ ...defaultOscParams(), waveform: 'pulse', filterType: 'lowpass' }),
    ).toBeCloseTo(2.05, 5)
  })
})

describe('what effects cost', () => {
  it('gives every effect a price', () => {
    for (const effect of EFFECTS) {
      const cost = effectCost({ ...defaultFxParams(), effect: effect.kind })
      expect(cost).toBeGreaterThan(0)
    }
  })

  it('makes the reverb the dearest thing in the list', () => {
    const reverb = effectCost({ ...defaultFxParams(), effect: 'reverb' })
    for (const effect of EFFECTS) {
      if (effect.kind === 'reverb') continue
      expect(reverb).toBeGreaterThan(effectCost({ ...defaultFxParams(), effect: effect.kind }))
    }
  })

  it('prices the reverb by its tail, because a convolver is priced by its tail', () => {
    const at = (decay: number) => effectCost({ ...defaultFxParams(), effect: 'reverb', decay })
    expect(at(5)).toBeCloseTo(at(2.5) * 2, 5)
    // Measured against the voice, which is the unit, rather than against the ceiling: a ten-second tail
    // costs what a hundred oscillators cost, and that comparison stays true whatever the ceiling is.
    expect(at(10)).toBeGreaterThan(100 * voiceCost('square', false))
  })

  it('charges an oversampled waveshaper more than a plain one', () => {
    const drive = effectCost({ ...defaultFxParams(), effect: 'distortion' })
    const crush = effectCost({ ...defaultFxParams(), effect: 'crush' })
    expect(drive).toBeGreaterThan(crush * 3)
  })

  it('falls back rather than throwing on an effect this build lacks', () => {
    expect(effectCost({ ...defaultFxParams(), effect: 'nonesuch' as never })).toBeGreaterThan(0)
  })
})

describe('voiceOverlap', () => {
  it('counts a long release under a fast division as several voices', () => {
    // The single biggest thing a voice count hides: one oscillator holding five notes at once.
    const params = { ...defaultOscParams(), division: '1/16' as const, release: 800, gate: 0.9 }
    expect(voiceOverlap(params, 120)).toBeGreaterThan(2)
  })

  it('counts a short release as about one', () => {
    const params = { ...defaultOscParams(), division: '1/4' as const, release: 20, gate: 0.5 }
    expect(voiceOverlap(params, 120)).toBeCloseTo(1, 1)
  })

  it('never goes below one or runs away', () => {
    for (const release of [0, 40, 2000]) {
      for (const division of ['1/4', '1/8', '1/16'] as const) {
        const overlap = voiceOverlap({ ...defaultOscParams(), division, release }, 300)
        expect(overlap).toBeGreaterThanOrEqual(1)
        expect(overlap).toBeLessThanOrEqual(4)
      }
    }
  })
})

describe('estimating a patch', () => {
  const osc = (id: string, params = {}): PatchNode => ({
    id,
    type: 'osc',
    position: { x: 0, y: 0 },
    params: { ...defaultOscParams(), ...params },
  })
  const fx = (id: string, params: Partial<FxParams> = {}): PatchNode => ({
    id,
    type: 'fx',
    position: { x: 0, y: 0 },
    params: { ...defaultFxParams(), ...params },
  })
  const ignite: PatchNode = { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }
  const event = (source: string, target: string) => ({
    id: `${source}${target}`,
    kind: 'event' as const,
    source,
    target,
  })
  const patchOf = (nodes: PatchNode[], edges: Patch['edges'] = []): Patch => ({
    version: 1,
    bpm: 120,
    loop: true,
    nodes,
    edges,
  })

  it('costs nothing for a patch with nothing in it', () => {
    expect(estimatePeakLoad(patchOf([ignite]))).toBe(0)
  })

  it('charges a rack of effects whether or not anything plays through it', () => {
    // A convolver processes silence at the same price as sound, and an unwired reverb costing what it
    // costs is both true and a nudge to delete it.
    const loose = estimatePeakLoad(patchOf([ignite, fx('f', { effect: 'reverb' })]))
    expect(loose).toBeGreaterThan(10)
  })

  it('takes the widest level rather than the whole tree', () => {
    // Siblings sound together; depth is sequential. A chain of four is not four times a chain of one.
    const chain = patchOf(
      [ignite, osc('a'), osc('b'), osc('c'), osc('d')],
      [event('s', 'a'), event('a', 'b'), event('b', 'c'), event('c', 'd')],
    )
    const fan = patchOf(
      [ignite, osc('a'), osc('b'), osc('c'), osc('d')],
      [event('s', 'a'), event('s', 'b'), event('s', 'c'), event('s', 'd')],
    )
    expect(estimatePeakLoad(fan)).toBeGreaterThan(estimatePeakLoad(chain) * 2)
  })

  it('adds cascades together, since every Ignite fires at once', () => {
    const one = patchOf([ignite, osc('a')], [event('s', 'a')])
    const two = patchOf(
      [ignite, { ...ignite, id: 't' }, osc('a'), osc('b')],
      [event('s', 'a'), event('t', 'b')],
    )
    expect(estimatePeakLoad(two)).toBeGreaterThan(estimatePeakLoad(one) * 1.5)
  })

  it('does not hang on a cycle', () => {
    const looped = patchOf(
      [ignite, osc('a'), osc('b')],
      [event('s', 'a'), event('a', 'b'), event('b', 'a')],
    )
    expect(estimatePeakLoad(looped)).toBeGreaterThan(0)
  })

  it('over-estimates rather than under, so a patch inside budget plays', () => {
    const one = patchOf([ignite, osc('a')], [event('s', 'a')])
    // One oscillator at rest is one voice; the allowance for tails puts the estimate above it.
    expect(estimatePeakLoad(one)).toBeGreaterThan(1)
  })
})

describe('the budget itself', () => {
  it('is the measured ceiling of the machine it was calibrated on', () => {
    // Measured rather than chosen: Chrome's render capacity reaches a hundred per cent at about 5100
    // points on the machine this was calibrated on. It was 100 for as long as nobody had measured it,
    // which was wrong by a factor of fifty — and not harmlessly, since the layering back-off is a share
    // of it and a single reverb used to hold every oscillator permanently past the threshold.
    expect(MAX_LOAD).toBe(5000)
  })

  it('starts degrading before it runs out', () => {
    expect(LAYER_THRESHOLD).toBeGreaterThan(0.5)
    expect(LAYER_THRESHOLD).toBeLessThan(1)
  })
})
