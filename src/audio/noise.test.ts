import { describe, expect, it } from 'vitest'
import { fillBrown, fillNoise, fillPink, fillWhite } from './noise'

/** Deterministic pseudo-random so the spectral assertions do not flake. */
function seeded(seed = 1): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function make(fill: (data: Float32Array, random: () => number) => void, n = 8192): Float32Array {
  const data = new Float32Array(n)
  fill(data, seeded())
  return data
}

/**
 * Mean absolute difference between neighbouring samples is a cheap proxy for spectral tilt:
 * the more high-frequency energy, the more the signal jumps sample to sample.
 */
function roughness(data: Float32Array): number {
  let total = 0
  for (let i = 1; i < data.length; i++) total += Math.abs(data[i] - data[i - 1])
  return total / (data.length - 1)
}

function peak(data: Float32Array): number {
  let max = 0
  for (const v of data) max = Math.max(max, Math.abs(v))
  return max
}

describe('noise', () => {
  it('gets darker from white to pink to brown', () => {
    // This is the whole point of having three colours: each rolls off faster than the last.
    const white = roughness(make(fillWhite))
    const pink = roughness(make(fillPink))
    const brown = roughness(make(fillBrown))

    expect(white).toBeGreaterThan(pink)
    expect(pink).toBeGreaterThan(brown)
  })

  it('stays inside the usable range so the master bus is not slammed', () => {
    expect(peak(make(fillWhite))).toBeLessThanOrEqual(1)
    expect(peak(make(fillPink))).toBeLessThan(1.5)
    expect(peak(make(fillBrown))).toBeLessThan(1.5)
  })

  it('actually fills the buffer', () => {
    for (const fill of [fillWhite, fillPink, fillBrown]) {
      const data = make(fill, 256)
      expect(data.some((v) => v !== 0)).toBe(true)
    }
  })

  it('brown wanders instead of jumping', () => {
    // Integrated noise: consecutive samples stay close together.
    const data = make(fillBrown, 4096)
    const jumps = roughness(data)
    expect(jumps).toBeLessThan(0.1)
  })

  it('dispatches by colour name', () => {
    const a = new Float32Array(512)
    const b = new Float32Array(512)
    fillNoise('pink', a, seeded())
    fillPink(b, seeded())
    expect([...a]).toEqual([...b])
  })
})
