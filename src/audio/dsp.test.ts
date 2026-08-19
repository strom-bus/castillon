import { describe, expect, it } from 'vitest'
import {
  bitsToDepth,
  crushCurve,
  depthToBits,
  driveCurve,
  impulseResponse,
  MAX_BITS,
  MIN_BITS,
} from './dsp'

function distinctValues(curve: Float32Array): number {
  return new Set([...curve].map((v) => v.toFixed(5))).size
}

describe('driveCurve', () => {
  it('is transparent at zero, so the lowest setting really is off', () => {
    const curve = driveCurve(0, 5)
    expect([...curve]).toEqual([-1, -0.5, 0, 0.5, 1])
  })

  it('leaves silence alone and keeps the ends pinned', () => {
    for (const amount of [0, 0.3, 1]) {
      const curve = driveCurve(amount, 9)
      expect(curve[4]).toBeCloseTo(0, 6)
      expect(curve[0]).toBeCloseTo(-1, 6)
      expect(curve[8]).toBeCloseTo(1, 6)
    }
  })

  it('lifts quiet signal more as it is driven harder, which is what clipping is', () => {
    const quiet = 600 // a point a quarter of the way up
    expect(driveCurve(1)[quiet]).toBeGreaterThan(driveCurve(0.2)[quiet])
    expect(driveCurve(0.2)[quiet]).toBeGreaterThan(driveCurve(0)[quiet])
  })

  it('never exceeds the range it was given', () => {
    for (const amount of [0, 0.5, 1]) {
      for (const v of driveCurve(amount)) expect(Math.abs(v)).toBeLessThanOrEqual(1.0001)
    }
  })

  it('rises without ever turning back', () => {
    const curve = driveCurve(0.7)
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1])
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

describe('bit depth carried in the normalised depth parameter', () => {
  it('round-trips every usable bit depth', () => {
    for (let bits = MIN_BITS; bits <= MAX_BITS; bits++) {
      expect(depthToBits(bitsToDepth(bits))).toBe(bits)
    }
  })

  it('survives the quantisation the patch code applies to depth', () => {
    // The codec stores depth to two decimal places; the mapping has to be coarse enough to fit.
    for (let bits = MIN_BITS; bits <= MAX_BITS; bits++) {
      const stored = Math.round(bitsToDepth(bits) * 100) / 100
      expect(depthToBits(stored)).toBe(bits)
    }
  })

  it('spans the ends', () => {
    expect(depthToBits(0)).toBe(MIN_BITS)
    expect(depthToBits(1)).toBe(MAX_BITS)
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
