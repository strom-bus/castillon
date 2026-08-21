import { describe, expect, it } from 'vitest'
import { decimate, decimateState, MAX_REDUCTION, MIN_REDUCTION } from './dsp'
import { EFFECTS, effectOr } from './effects'
import { fakeAudio } from './fakeAudio'
import { targetsFor } from './modulation'
import type { FxParams } from '../types/patch'

/**
 * Sample-rate decimation: the half of the bitcrusher a `WaveShaperNode` cannot do.
 *
 * A curve maps a sample to a sample with no memory, and holding a value *is* memory — which is why
 * this waited for an `AudioWorklet`. The arithmetic is an ordinary function in `dsp.ts` precisely so
 * that it can be tested like this, with no audio thread and no worklet: the processor around it is
 * plumbing, and the bundler inlining this import into the worklet build is what makes that possible.
 */

const ramp = (length: number) => Float32Array.from({ length }, (_, i) => i / length)

function run(input: Float32Array, hold: number): Float32Array {
  const output = new Float32Array(input.length)
  decimate(input, output, hold, decimateState())
  return output
}

describe('decimate', () => {
  it('leaves the signal alone at a hold of one', () => {
    // The default, and it has to be exact: a bitcrusher with decimation at rest must sound like a
    // bitcrusher without any.
    const input = ramp(16)
    expect(Array.from(run(input, 1))).toEqual(Array.from(input))
  })

  it('holds each sample for as many outputs as asked', () => {
    const input = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8])
    expect(Array.from(run(input, 4))).toEqual([1, 1, 1, 1, 5, 5, 5, 5])
  })

  it('holds at every factor without drifting', () => {
    // The counter is the thing most likely to be off by one, and off by one at a hold of two is a
    // different sound from off by one at a hold of seventeen.
    for (let hold = MIN_REDUCTION; hold <= MAX_REDUCTION; hold++) {
      const input = ramp(256)
      const output = run(input, hold)
      for (let i = 0; i < input.length; i++) {
        expect(output[i]).toBe(input[Math.floor(i / hold) * hold])
      }
    }
  })

  it('carries the hold across a block boundary', () => {
    // Where a naive implementation breaks: a block is 128 samples and a hold does not divide it.
    const state = decimateState()
    const first = Float32Array.from([10, 11, 12])
    const second = Float32Array.from([20, 21, 22])
    const outA = new Float32Array(3)
    const outB = new Float32Array(3)

    decimate(first, outA, 5, state)
    decimate(second, outB, 5, state)

    expect(Array.from(outA)).toEqual([10, 10, 10])
    // Two more of the held sample, since the hold of five had two left, and then a new one — taken at
    // the position where the hold expired, which is 22 and not 20. A sample-and-hold samples *now*
    // rather than resuming where the previous block stopped reading.
    expect(Array.from(outB)).toEqual([10, 10, 22])
  })

  it('rounds a fractional hold rather than stalling on it', () => {
    // A modulation cable can land any value here. A hold of 0 would output nothing for ever.
    expect(Array.from(run(Float32Array.from([1, 2, 3, 4]), 0))).toEqual([1, 2, 3, 4])
    expect(Array.from(run(Float32Array.from([1, 2, 3, 4]), 2.4))).toEqual([1, 1, 3, 3])
  })

  it('never invents a value the input did not contain', () => {
    // It is a sample-and-hold, not a filter: no interpolation, no smoothing. The aliasing is the sound.
    const input = ramp(64)
    const seen = new Set(Array.from(input))
    for (const sample of run(input, 6)) expect(seen.has(sample)).toBe(true)
  })
})

describe('the bitcrusher with a worklet', () => {
  const params = { effect: 'crush', mix: 0.8, ...effectOr('crush').defaults } as FxParams

  it('offers decimation as a parameter of its own', () => {
    expect(effectOr('crush').params).toContain('reduction')
  })

  it('hands the hold over to a modulation cable', () => {
    // Read once a block rather than once a sample, which is all a hold count needs — but reachable,
    // which is the contract every offered target has.
    const chain = EFFECTS.find((e) => e.kind === 'crush')!.create(fakeAudio().ctx)
    expect(chain.paramFor?.('reduction')).not.toBeNull()
  })

  it('writes the asked-for hold onto it', () => {
    const chain = EFFECTS.find((e) => e.kind === 'crush')!.create(fakeAudio().ctx)
    chain.update({ ...params, reduction: 12 }, { at: 0, bpm: 120 })

    const hold = chain.paramFor?.('reduction') as { value: number }
    expect(hold.value).toBe(12)
  })

  it('clamps a hold that came from somewhere careless', () => {
    const chain = EFFECTS.find((e) => e.kind === 'crush')!.create(fakeAudio().ctx)
    chain.update({ ...params, reduction: 9999 }, { at: 0, bpm: 120 })
    const hold = chain.paramFor?.('reduction') as { value: number }
    expect(hold.value).toBe(MAX_REDUCTION)
  })

  it('leaves it at rest by default, so an old patch sounds unchanged', () => {
    // Every patch that existed before this had no reduction field, and a bitcrusher that started
    // decimating on its own would change what those patches sound like.
    expect(effectOr('crush').defaults?.reduction).toBe(MIN_REDUCTION)
  })

  it('offers it to a MOD alongside the rest', () => {
    expect(targetsFor('fx', 'crush').map((t) => t.key)).toContain('reduction')
  })
})
