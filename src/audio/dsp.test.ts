import { describe, expect, it } from 'vitest'
import { crushCurve, distortionCurve, impulseResponse, MAX_BITS, MIN_BITS } from './dsp'

function distinctValues(curve: Float32Array): number {
  return new Set([...curve].map((v) => v.toFixed(5))).size
}

/** The clipping shapes. `octave` is a transform rather than a gain stage, so it is tested apart. */
const SHAPES = ['overdrive', 'distortion', 'fuzz'] as const

describe('distortionCurve', () => {
  it('is exactly transparent at zero for every shape, so the lowest setting really is off', () => {
    for (const shape of SHAPES) {
      expect([...distortionCurve(shape, 0, 5)]).toEqual([-1, -0.5, 0, 0.5, 1])
    }
  })

  it('keeps the ends pinned and stays in range', () => {
    for (const shape of SHAPES) {
      for (const amount of [0, 0.3, 1]) {
        const curve = distortionCurve(shape, amount, 9)
        expect(curve[0]).toBeCloseTo(-1, 5)
        expect(curve[8]).toBeCloseTo(1, 5)
        for (const v of curve) expect(Math.abs(v)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('lifts quiet signal more as it is driven harder, which is what clipping is', () => {
    const quiet = 600 // a point a quarter of the way up
    for (const shape of SHAPES) {
      expect(distortionCurve(shape, 1)[quiet]).toBeGreaterThan(distortionCurve(shape, 0.2)[quiet])
      expect(distortionCurve(shape, 0.2)[quiet]).toBeGreaterThan(distortionCurve(shape, 0)[quiet])
    }
  })

  it('tells the three apart by what they actually are', () => {
    /*
     * This used to assert an ordering — that each of the three squashed a quiet signal harder than the
     * last — and it was an accident of the constants rather than the design. Retuning fuzz's bias, which
     * had to be done because the old one silenced any quiet note, put fuzz and distortion within a
     * thousandth of each other at the sampled point and the claim fell over.
     *
     * What actually distinguishes them: the first two are **odd** functions, so they add only odd
     * harmonics however hard they are driven, and fuzz is **asymmetric**, which is where its even
     * harmonics and its whole character come from. That is a property of the design and not of a number.
     */
    const symmetry = (shape: (typeof SHAPES)[number]) => {
      const curve = distortionCurve(shape, 0.5)
      let worst = 0
      for (let i = 0; i < curve.length; i++) {
        worst = Math.max(worst, Math.abs(curve[i] + curve[curve.length - 1 - i]))
      }
      return worst
    }
    expect(symmetry('overdrive')).toBeLessThan(0.01)
    expect(symmetry('distortion')).toBeLessThan(0.01)
    expect(symmetry('fuzz')).toBeGreaterThan(0.05)

    // And the two odd ones are not each other: at the same setting tanh turns over harder than the
    // rational soft clip, which is the reason for having both.
    const at = (shape: (typeof SHAPES)[number]) => distortionCurve(shape, 0.5)[600]
    expect(at('distortion')).toBeGreaterThan(at('overdrive'))
  })

  it('rises without turning back, so no shape folds the wave over', () => {
    for (const shape of SHAPES) {
      const curve = distortionCurve(shape, 0.7)
      for (let i = 1; i < curve.length; i++) {
        expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1] - 1e-6)
      }
    }
  })

  it('is asymmetric only for fuzz, which is where its even harmonics come from', () => {
    const atZero = (shape: (typeof SHAPES)[number]) => distortionCurve(shape, 0.8, 1025)[512]
    expect(Math.abs(atZero('overdrive'))).toBeLessThan(1e-6)
    expect(Math.abs(atZero('distortion'))).toBeLessThan(1e-6)
    expect(Math.abs(atZero('fuzz'))).toBeGreaterThan(1e-3)
  })

  it('octaves at any amount, because that is what an octaver is', () => {
    // Unlike the clipping shapes, this one is not transparent at zero: amount adds grit, it does
    // not fade the octave in. Rectification is the effect.
    const curve = distortionCurve('octave', 0, 5)
    // Full-wave rectification: both halves of the input come out the same way up, which is what
    // doubles the frequency.
    expect(curve[0]).toBeCloseTo(curve[4], 5)
    expect(curve[1]).toBeCloseTo(curve[3], 5)
    expect(curve[2]).toBeLessThan(curve[0])
  })

  it('rectifies symmetrically at every amount, or it would not double the pitch', () => {
    for (const amount of [0, 0.4, 1]) {
      const curve = distortionCurve('octave', amount, 1025)
      for (let i = 0; i < 512; i++) {
        expect(curve[i]).toBeCloseTo(curve[1024 - i], 4)
      }
    }
  })

  it('falls back to a usable shape if handed one it does not know', () => {
    expect([...distortionCurve('sizzle' as never, 0.5)]).toEqual([
      ...distortionCurve('overdrive', 0.5),
    ])
  })
})

describe('crushCurve', () => {
  it('quantises to roughly as many levels as the bit depth allows', () => {
    // The whole audible character of a bitcrusher is how few distinct values come out.
    expect(distinctValues(crushCurve(2))).toBeLessThanOrEqual(4)
    expect(distinctValues(crushCurve(3))).toBeLessThanOrEqual(8)
    expect(distinctValues(crushCurve(4))).toBeLessThanOrEqual(16)
  })

  it('gets coarser as bits come off', () => {
    expect(distinctValues(crushCurve(3))).toBeLessThan(distinctValues(crushCurve(6)))
    expect(distinctValues(crushCurve(6))).toBeLessThan(distinctValues(crushCurve(10)))
  })

  it('stays inside range and keeps the ends pinned', () => {
    for (const bits of [MIN_BITS, 5, MAX_BITS]) {
      const curve = crushCurve(bits)
      expect(curve[0]).toBeCloseTo(-1, 5)
      expect(curve[curve.length - 1]).toBeCloseTo(1, 5)
      for (const v of curve) expect(Math.abs(v)).toBeLessThanOrEqual(1.0001)
    }
  })

  it('clamps a bit depth it cannot use rather than producing nonsense', () => {
    expect(distinctValues(crushCurve(0))).toBe(distinctValues(crushCurve(MIN_BITS)))
    expect(distinctValues(crushCurve(64))).toBe(distinctValues(crushCurve(MAX_BITS)))
  })
})

describe('impulseResponse', () => {
  const seeded = (seed = 1) => {
    let state = seed
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296
      return state / 4294967296
    }
  }

  it('is as long as the decay asks for', () => {
    expect(impulseResponse(2, 1000, seeded())[0]).toHaveLength(2000)
    expect(impulseResponse(0.5, 48000, seeded())[0]).toHaveLength(24000)
  })

  it('gives two decorrelated channels, which is what makes it wide', () => {
    const [left, right] = impulseResponse(0.2, 1000, seeded())
    expect(left).toHaveLength(right.length)
    expect([...left]).not.toEqual([...right])
  })

  it('decays instead of holding, which is the difference between a room and a burst', () => {
    const [channel] = impulseResponse(1, 4000, seeded())
    const energy = (from: number, to: number) => {
      let sum = 0
      for (let i = from; i < to; i++) sum += channel[i] * channel[i]
      return sum / (to - from)
    }
    expect(energy(0, 1000)).toBeGreaterThan(energy(1000, 2000))
    expect(energy(1000, 2000)).toBeGreaterThan(energy(3000, 4000))
  })

  it('stays inside range, so a convolver cannot be handed something that clips', () => {
    for (const channel of impulseResponse(0.3, 8000, seeded())) {
      for (const v of channel) expect(Math.abs(v)).toBeLessThanOrEqual(1)
    }
  })

  it('never produces an empty buffer, whatever decay it is given', () => {
    expect(impulseResponse(0, 48000, seeded())[0].length).toBeGreaterThan(0)
  })
})
