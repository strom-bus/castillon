import { describe, expect, it } from 'vitest'
import { fillBlue, fillBrown, fillNoise, fillPink, fillWhite } from './noise'

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
 * Spectral tilt proxy: how far the signal jumps sample to sample, relative to how loud it is.
 * More high-frequency energy means bigger jumps for the same level.
 *
 * The division by RMS is what makes this a measure of *tilt* rather than of volume — blue is
 * normalised to a lower peak than white, so an absolute jump size would rank them by loudness
 * instead of by brightness.
 */
function roughness(data: Float32Array): number {
  let jumps = 0
  let energy = 0
  for (let i = 1; i < data.length; i++) {
    jumps += Math.abs(data[i] - data[i - 1])
    energy += data[i] * data[i]
  }
  const rms = Math.sqrt(energy / (data.length - 1))
  return rms === 0 ? 0 : jumps / (data.length - 1) / rms
}

function peak(data: Float32Array): number {
  let max = 0
  for (const v of data) max = Math.max(max, Math.abs(v))
  return max
}

describe('noise', () => {
  it('runs bright to dark: blue, white, pink, brown', () => {
    // This is the whole point of having several colours: each tilts further than the last.
    // Blue rises with frequency where pink falls, so it sits on the far side of white.
    const blue = roughness(make(fillBlue))
    const white = roughness(make(fillWhite))
    const pink = roughness(make(fillPink))
    const brown = roughness(make(fillBrown))

    expect(blue).toBeGreaterThan(white)
    expect(white).toBeGreaterThan(pink)
    expect(pink).toBeGreaterThan(brown)
  })

  it('blue is pink mirrored, not just white with a boost', () => {
    // Pink tilts down by the same 3 dB/octave blue tilts up, so their roughness should sit
    // either side of white by a comparable factor.
    const blue = roughness(make(fillBlue))
    const white = roughness(make(fillWhite))
    const pink = roughness(make(fillPink))
    expect(blue / white).toBeGreaterThan(1)
    expect(white / pink).toBeGreaterThan(1)
  })

  it('stays inside the usable range so the master bus is not slammed', () => {
    expect(peak(make(fillWhite))).toBeLessThanOrEqual(1)
    expect(peak(make(fillPink))).toBeLessThan(1.5)
    expect(peak(make(fillBrown))).toBeLessThan(1.5)
    expect(peak(make(fillBlue))).toBeLessThanOrEqual(1)
  })

  it('actually fills the buffer', () => {
    for (const fill of [fillWhite, fillPink, fillBrown, fillBlue]) {
      const data = make(fill, 256)
      expect(data.some((v) => v !== 0)).toBe(true)
    }
  })

  it('brown wanders instead of jumping', () => {
    // Integrated noise: consecutive samples stay close together relative to the signal's level.
    // Stated against white rather than as a bare number, so the bound means something.
    expect(roughness(make(fillBrown, 4096))).toBeLessThan(roughness(make(fillWhite, 4096)) / 5)
  })

  it('dispatches by colour name', () => {
    const a = new Float32Array(512)
    const b = new Float32Array(512)
    fillNoise('pink', a, seeded())
    fillPink(b, seeded())
    expect([...a]).toEqual([...b])
  })
})
