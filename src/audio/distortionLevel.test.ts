import { describe, expect, it } from 'vitest'
import { distortionCurve } from './dsp'
import type { DistortionShape } from '../types/patch'

/**
 * That no distortion shape goes quiet.
 *
 * The guard that was missing, and the fault it would have caught was a bad one: octave-up at full Drive
 * put out a **tenth** of the level of every other shape on the same note. Nothing was broken in a way a
 * test of *shape* could see — the curve was a perfectly good curve — and every existing test of this file
 * asked what the curve looked like rather than how loud what came out of it was.
 *
 * The measurement includes the 20 Hz high-pass the distortion effect puts after the shaper, because
 * rectification leaves a direct current and the fault was invisible without it: the collapsed waveform was
 * a near-constant, which is loud until the offset is taken away and then is nothing.
 */

const RATE = 48000
const SHAPES: DistortionShape[] = ['overdrive', 'distortion', 'fuzz', 'octave']

/** The curve read as a `WaveShaperNode` reads it, with linear interpolation between points. */
function read(curve: Float32Array, x: number): number {
  const at = ((Math.min(1, Math.max(-1, x)) + 1) / 2) * (curve.length - 1)
  const low = Math.floor(at)
  const high = Math.min(curve.length - 1, low + 1)
  return curve[low] + (curve[high] - curve[low]) * (at - low)
}

/** RMS of a sine through the shape and then through the effect's own DC blocker. */
function level(shape: DistortionShape, amount: number, amplitude: number): number {
  const curve = distortionCurve(shape, amount)
  const pole = 1 - (2 * Math.PI * 20) / RATE
  let lastIn = 0
  let lastOut = 0
  let sum = 0
  const samples = RATE / 2
  for (let i = 0; i < samples; i++) {
    const value = read(curve, amplitude * Math.sin((2 * Math.PI * 220 * i) / RATE))
    const out = value - lastIn + pole * lastOut
    lastIn = value
    lastOut = out
    sum += out * out
  }
  return Math.sqrt(sum / samples)
}

/** A sine's own RMS, which is what every shape is measured against. */
const sine = (amplitude: number) => amplitude / Math.SQRT2

describe('every distortion shape', () => {
  it('passes a signal through untouched at no drive at all', () => {
    // Three of them are the identity at rest. The octave is not and cannot be — it doubles the frequency,
    // which is what it *is* — so it is only asked to stay in the same range.
    for (const shape of ['overdrive', 'distortion', 'fuzz'] as const) {
      expect(level(shape, 0, 1), shape).toBeCloseTo(sine(1), 2)
    }
    expect(level('octave', 0, 1)).toBeGreaterThan(sine(1) * 0.8)
  })

  it('never collapses a quiet note at full drive', () => {
    /*
     * **The bug, as a number.** Every shape at full Drive should make a quiet note *louder* — that is
     * what drive is — and octave-up made it ten times quieter. Asserted against the input rather than
     * against the other shapes, so the claim is "drive drives" and not "they all agree".
     */
    for (const shape of SHAPES) {
      const quiet = level(shape, 1, 0.1)
      expect(quiet, `${shape} at full drive on a quiet note`).toBeGreaterThan(sine(0.1))
    }
  })

  it('keeps the three symmetrical shapes level with each other', () => {
    /*
     * Switching between overdrive, distortion and fuzz at the same Drive should be a change of colour and
     * not of volume. Within two decibels, measured — they were fifteen apart before the fuzz bias was
     * retuned, because a bias larger than the signal pins the waveform on one side of zero.
     */
    for (const amplitude of [1, 0.3, 0.1]) {
      const levels = (['overdrive', 'distortion', 'fuzz'] as const).map((shape) =>
        level(shape, 1, amplitude),
      )
      const spread = 20 * Math.log10(Math.max(...levels) / Math.min(...levels))
      expect(spread, `${spread.toFixed(1)} dB apart at input ${amplitude}`).toBeLessThan(4)
    }
  })

  it('keeps the octave within reach of them, which is as close as it can get', () => {
    /*
     * The octave sits under the other three and **cannot** be brought level with them by any curve. A
     * shaper is memoryless, and `2|x| - 1` uses less of its range the quieter the input is: a note at a
     * tenth of full scale only ever swings a fifth of the way across the curve, so there is less
     * alternating content to be had whatever is done to it afterwards. Making it level would need to know
     * how loud the input was, which is the one thing a curve cannot know.
     *
     * So this bounds it where it measured — six decibels under at full scale, thirteen at a tenth — and
     * the number is the ceiling on a fault rather than a target. It was **twenty-two** before the fix.
     */
    for (const [amplitude, limit] of [
      [1, 8],
      [0.3, 11],
      [0.1, 14],
    ] as const) {
      const loudest = Math.max(
        ...(['overdrive', 'distortion', 'fuzz'] as const).map((shape) =>
          level(shape, 1, amplitude),
        ),
      )
      const under = 20 * Math.log10(loudest / level('octave', 1, amplitude))
      expect(under, `octave is ${under.toFixed(1)} dB under at input ${amplitude}`).toBeLessThan(
        limit,
      )
    }
  })

  it('makes the octave louder as its drive goes up, not quieter', () => {
    // The direction of the control, which the old curve got backwards for anything but a peak-level input:
    // more grit meant less sound.
    for (const amplitude of [0.3, 0.1]) {
      expect(level('octave', 1, amplitude)).toBeGreaterThan(level('octave', 0, amplitude))
    }
  })

  it('still doubles the frequency, which is the whole of what octave-up is', () => {
    /*
     * The level fix must not have cost the effect its point. Measured as the strength of the second
     * harmonic against the first: a rectified sine has almost nothing left at the original pitch.
     */
    const curve = distortionCurve('octave', 0.5)
    const at = (multiple: number) => {
      const samples = 4096
      let re = 0
      let im = 0
      for (let i = 0; i < samples; i++) {
        const turn = (2 * Math.PI * i) / samples
        const value = read(curve, Math.sin(turn))
        re += value * Math.cos(multiple * turn)
        im -= value * Math.sin(multiple * turn)
      }
      return Math.hypot(re, im) / samples
    }
    expect(at(2)).toBeGreaterThan(at(1) * 20)
  })
})
