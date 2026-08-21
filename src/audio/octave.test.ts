import { describe, expect, it } from 'vitest'
import { octaveDown, octaveState } from './dsp'
import { effectOr } from './effects'
import { fakeAudio } from './fakeAudio'

/**
 * The octave divider (see `octaveDown`), which is the second thing an `AudioWorklet` unlocked.
 *
 * A flip-flop clocked by the signal's own zero crossings: one flip per cycle of the input gives a
 * square at half its frequency, and multiplying the input by that square puts the fundamental an octave
 * down. So the thing to check is the **flip rate** — one per input cycle, no more and no fewer. Too
 * many is the detector triggering on noise; too few is the smoothing eating the signal.
 */

const RATE = 48000

/** How many times the divider flipped over a run of a sine at one frequency. */
function flips(freq: number, cycles = 20, amplitude = 1): number {
  const length = Math.round((RATE / freq) * cycles)
  const state = octaveState()
  const output = new Float32Array(1)
  let count = 0
  let sign = state.sign

  for (let i = 0; i < length; i++) {
    const sample = Float32Array.of(amplitude * Math.sin((2 * Math.PI * freq * i) / RATE))
    octaveDown(sample, output, state)
    if (state.sign !== sign) {
      count++
      sign = state.sign
    }
  }
  return count
}

describe('octaveDown', () => {
  it('flips once per cycle of the input, which is what halves the frequency', () => {
    // Within one, since the first cycle spends part of itself charging the detector.
    for (const freq of [110, 220, 440]) {
      expect(Math.abs(flips(freq, 20) - 20)).toBeLessThanOrEqual(1)
    }
  })

  it('keeps tracking up the register, where the smoothing could have eaten it', () => {
    // The smoothing is a one-pole around 150 Hz, so everything above it arrives attenuated. It has to
    // stay above the threshold anyway, or the divider would simply stop at the top of the range.
    for (const freq of [880, 1760, 3520]) {
      expect(Math.abs(flips(freq, 20) - 20)).toBeLessThanOrEqual(2)
    }
  })

  it('still tracks a quiet signal', () => {
    // An effect that only works loud is an effect nobody can place in a chain.
    expect(Math.abs(flips(220, 20, 0.1) - 20)).toBeLessThanOrEqual(2)
  })

  it('does nothing to silence', () => {
    const state = octaveState()
    const output = new Float32Array(256)
    octaveDown(new Float32Array(256), output, state)
    expect(Array.from(output).every((s) => s === 0)).toBe(true)
    expect(state.sign).toBe(1)
  })

  it('is not flipped about by noise around zero', () => {
    // The hysteresis earning its keep: without it every wobble near zero counts as a crossing and the
    // output is a hiss rather than an octave.
    //
    // Counted rather than compared at the end: checking only the final sign passes on any *even*
    // number of flips, which is how this test first went green with the threshold taken out.
    const state = octaveState()
    const output = new Float32Array(1)
    let flipped = 0
    let sign = state.sign

    for (let i = 0; i < 4096; i++) {
      octaveDown(Float32Array.of(Math.sin(i * 1.7) * 0.005), output, state)
      if (state.sign !== sign) {
        flipped++
        sign = state.sign
      }
    }
    expect(flipped).toBe(0)
  })

  it('carries its state across a block boundary', () => {
    // Where a naive implementation loses the octave: a block is 128 samples and a cycle is not.
    const whole = octaveState()
    const split = octaveState()
    const length = 1024
    const input = Float32Array.from({ length }, (_, i) => Math.sin((2 * Math.PI * 220 * i) / RATE))

    const a = new Float32Array(length)
    octaveDown(input, a, whole)

    const b = new Float32Array(length)
    for (let at = 0; at < length; at += 128) {
      octaveDown(input.subarray(at, at + 128), b.subarray(at, at + 128), split)
    }
    expect(Array.from(b)).toEqual(Array.from(a))
  })

  it('multiplies rather than replaces, so the timbre survives', () => {
    // It is a divider, not an oscillator: every output sample is an input sample with a sign.
    const state = octaveState()
    const length = 512
    const input = Float32Array.from({ length }, (_, i) => Math.sin((2 * Math.PI * 220 * i) / RATE))
    const output = new Float32Array(length)
    octaveDown(input, output, state)

    for (let i = 0; i < length; i++) {
      expect(Math.abs(output[i])).toBeCloseTo(Math.abs(input[i]), 6)
    }
  })
})

describe('the Octave effect', () => {
  it('is its own effect rather than a distortion shape', () => {
    // Octave up is a curve and lives behind Shape. Down needs memory, so it cannot.
    expect(effectOr('octave').kind).toBe('octave')
    expect(effectOr('octave').params).not.toContain('shape')
  })

  it('offers a tone control and nothing else, since there is nothing else worth offering', () => {
    expect(effectOr('octave').params).toEqual(['cutoff'])
    expect(effectOr('octave').labels?.cutoff).toBe('Tone')
  })

  it('passes signal through where there is no worklet, rather than going silent', () => {
    // A patch that plays on one browser must not fall silent on another. Built with a context whose
    // node construction fails, which is what a browser without `AudioWorklet` looks like.
    const chain = effectOr('octave').create(fakeAudio().ctx)
    expect(chain.input).toBeDefined()
    expect(chain.output).toBeDefined()
  })
})
