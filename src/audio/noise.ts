/**
 * Noise generators. Pure functions over a buffer so their spectral tilt can be tested without
 * Web Audio: brown falls off faster than pink, and pink faster than white.
 */

export type NoiseColor = 'white' | 'pink' | 'brown'

type Random = () => number

/** Flat spectrum: every sample independent. */
export function fillWhite(data: Float32Array, random: Random = Math.random): void {
  for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1
}

/**
 * Pink noise, -3 dB per octave. Paul Kellet's filter approximation: a bank of one-pole
 * filters whose sum tracks 1/f closely enough across the audible range.
 */
export function fillPink(data: Float32Array, random: Random = Math.random): void {
  let b0 = 0
  let b1 = 0
  let b2 = 0
  let b3 = 0
  let b4 = 0
  let b5 = 0
  let b6 = 0

  for (let i = 0; i < data.length; i++) {
    const white = random() * 2 - 1
    b0 = 0.99886 * b0 + white * 0.0555179
    b1 = 0.99332 * b1 + white * 0.0750759
    b2 = 0.969 * b2 + white * 0.153852
    b3 = 0.8665 * b3 + white * 0.3104856
    b4 = 0.55 * b4 + white * 0.5329522
    b5 = -0.7616 * b5 - white * 0.016898
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11
    b6 = white * 0.115926
  }
}

/**
 * Brown (red) noise, -6 dB per octave: integrated white noise. The 0.02 factor and the
 * renormalisation keep the random walk from drifting out of range.
 */
export function fillBrown(data: Float32Array, random: Random = Math.random): void {
  let last = 0
  for (let i = 0; i < data.length; i++) {
    const white = random() * 2 - 1
    last = (last + 0.02 * white) / 1.02
    data[i] = last * 3.5
  }
}

const FILLERS: Record<NoiseColor, (data: Float32Array, random?: Random) => void> = {
  white: fillWhite,
  pink: fillPink,
  brown: fillBrown,
}

export function fillNoise(color: NoiseColor, data: Float32Array, random?: Random): void {
  FILLERS[color](data, random)
}
