import { describe, expect, it } from 'vitest'
import { distortionCurve, foldCurve } from './dsp'

/**
 * The wavefolder's curve.
 *
 * A folder is not a distortion with a different flavour, and the tests are chosen to say so. A clipper's
 * curve **never decreases**: whatever it does to the sound, the output is a squashed version of the input
 * and louder in always means louder out. A folder's curve turns over, so a louder input can be a quieter
 * output and the harmonics move as the level does — which is the one thing in this instrument that
 * changes timbre with dynamics rather than with a control.
 *
 * So the questions are about **shape** (does it come back down, and how often) and about **harmonics**
 * (which ones, and what the bias does to them). The second is measured out of a folded sine rather than
 * argued from the curve, because "even harmonics" is a claim about a spectrum.
 */

/** The curve read at one input level, with linear interpolation as a `WaveShaperNode` would. */
function at(curve: Float32Array, x: number): number {
  const position = ((Math.min(1, Math.max(-1, x)) + 1) / 2) * (curve.length - 1)
  const low = Math.floor(position)
  const high = Math.min(curve.length - 1, low + 1)
  return curve[low] + (curve[high] - curve[low]) * (position - low)
}

/** How many times the curve changes direction, which is how many folds it has. */
function turns(curve: Float32Array): number {
  let count = 0
  let rising: boolean | null = null
  for (let i = 1; i < curve.length; i++) {
    const step = curve[i] - curve[i - 1]
    // A dead flat step says nothing about direction, and a clipper is full of them.
    if (Math.abs(step) < 1e-9) continue
    const up = step > 0
    if (rising !== null && up !== rising) count++
    rising = up
  }
  return count
}

/** The magnitude of one harmonic of a sine put through the curve. */
function harmonic(curve: Float32Array, multiple: number, level = 1): number {
  const samples = 4096
  let re = 0
  let im = 0
  for (let i = 0; i < samples; i++) {
    const turn = (2 * Math.PI * i) / samples
    const y = at(curve, level * Math.sin(turn))
    re += y * Math.cos(multiple * turn)
    im -= y * Math.sin(multiple * turn)
  }
  return (2 * Math.hypot(re, im)) / samples
}

describe('the wavefolder curve', () => {
  it('is the identity at rest, so adding one is not a change until it is asked to be', () => {
    // The promise every effect here makes. A folder at nought is a wire.
    const flat = foldCurve(0, 0)
    for (const x of [-1, -0.7, -0.25, 0, 0.25, 0.7, 1]) {
      expect(at(flat, x), `at ${x}`).toBeCloseTo(x, 5)
    }
    expect(turns(flat)).toBe(0)
  })

  it('folds rather than clips, which is the whole difference from a distortion', () => {
    /*
     * Stated as the property that separates the two families. Every distortion shape here is monotonic —
     * its curve never turns over — and the folder's does, four times at full drive. Asserted against the
     * real distortion curves rather than against a description of them.
     */
    for (const shape of ['overdrive', 'distortion', 'fuzz'] as const) {
      expect(turns(distortionCurve(shape, 1)), `${shape} turns over`).toBe(0)
    }
    expect(turns(foldCurve(1, 0))).toBeGreaterThan(3)
  })

  it('folds more often the harder it is driven', () => {
    const counts = [0, 0.25, 0.5, 0.75, 1].map((drive) => turns(foldCurve(drive, 0)))
    // Never fewer as it goes up, and more by the end — a folder whose fold count did not follow the
    // control would be a control that changes the sound without meaning anything.
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i], `drive step ${i}`).toBeGreaterThanOrEqual(counts[i - 1])
    }
    expect(counts[counts.length - 1]).toBeGreaterThan(counts[0] + 2)
  })

  it('never leaves the range, however hard it is driven or biased', () => {
    // A fold reflects, so it cannot overshoot — but the arithmetic could, and a curve above one clips at
    // the output stage instead, which would put a clipper back inside the folder.
    for (const drive of [0, 0.5, 1]) {
      for (const bias of [-1, -0.4, 0, 0.4, 1]) {
        const curve = foldCurve(drive, bias)
        for (const value of curve) {
          expect(Math.abs(value), `drive ${drive} bias ${bias}`).toBeLessThanOrEqual(1.0000001)
        }
      }
    }
  })

  it('is continuous, because a fold reflects and does not jump', () => {
    // A modulo-based fold gets the sign wrong on one side of the origin and puts a step in, which is a
    // click on every cycle rather than a harmonic.
    for (const bias of [-0.6, 0, 0.6]) {
      const curve = foldCurve(1, bias)
      let biggest = 0
      for (let i = 1; i < curve.length; i++) {
        biggest = Math.max(biggest, Math.abs(curve[i] - curve[i - 1]))
      }
      // The steepest a fold can be is the drive itself, over one step of the grid.
      expect(biggest, `bias ${bias}`).toBeLessThan(0.05)
    }
  })

  it('makes only odd harmonics when it is centred', () => {
    /*
     * A centred fold reflects the two halves identically, so the result is an odd function and an odd
     * function has no even harmonics. This is what makes a folder sound hollow however hard it is pushed
     * — and it is the thing bias exists to break.
     */
    const curve = foldCurve(1, 0)
    const odd = harmonic(curve, 3) + harmonic(curve, 5)
    const even = harmonic(curve, 2) + harmonic(curve, 4)
    expect(odd).toBeGreaterThan(0.05)
    expect(even).toBeLessThan(odd / 50)
  })

  it('puts even harmonics in as soon as it is biased, which is what bias is for', () => {
    /*
     * The musical claim, measured. Offsetting the signal makes the two halves fold differently, and that
     * asymmetry is even harmonics — a fuller, reedier tone, and swept it is the west-coast timbre nothing
     * else here can make.
     */
    const centred = harmonic(foldCurve(1, 0), 2)
    const biased = harmonic(foldCurve(1, 0.5), 2)
    expect(biased).toBeGreaterThan(centred + 0.05)
  })

  it('moves the harmonics with the input level, not just with the controls', () => {
    /*
     * The property no other effect here has. Through a clipper a quieter note is the same tone quieter;
     * through a folder it is a *different* tone, because how far into the folds it reaches depends on how
     * loud it arrived. A patch with step velocities gets timbre from them for free.
     */
    const curve = foldCurve(0.7, 0)
    const quiet = harmonic(curve, 5, 0.3) / harmonic(curve, 1, 0.3)
    const loud = harmonic(curve, 5, 1) / harmonic(curve, 1, 1)
    expect(loud).toBeGreaterThan(quiet * 2)
  })

  it('answers something sane for settings outside its range', () => {
    // A hand-built patch or an older code can carry anything.
    expect(turns(foldCurve(-3, 0))).toBe(turns(foldCurve(0, 0)))
    expect(turns(foldCurve(7, 0))).toBe(turns(foldCurve(1, 0)))
    for (const value of foldCurve(1, 9)) expect(Math.abs(value)).toBeLessThanOrEqual(1.0000001)
  })
})
