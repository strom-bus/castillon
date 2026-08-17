import type { Waveform } from '../types/patch'
import type { NoiseColor } from './noise'

export const WAVEFORMS: Waveform[] = [
  'square',
  'pulse',
  'sawtooth',
  'ramp',
  'triangle',
  'sine',
  'white',
  'pink',
  'brown',
  'blue',
]

/** Short labels, so they fit in the node header. */
export const WAVEFORM_LABELS: Record<Waveform, string> = {
  square: 'SQR',
  pulse: 'PUL',
  sawtooth: 'SAW',
  ramp: 'RMP',
  triangle: 'TRI',
  sine: 'SIN',
  white: 'WHT',
  pink: 'PNK',
  brown: 'BRN',
  blue: 'BLU',
}

export const WAVEFORM_NAMES: Record<Waveform, string> = {
  square: 'Square',
  pulse: 'Pulse',
  sawtooth: 'Sawtooth',
  ramp: 'Ramp (inverted saw)',
  triangle: 'Triangle',
  sine: 'Sine',
  white: 'White noise',
  pink: 'Pink noise',
  brown: 'Brown noise',
  blue: 'Blue noise',
}

const NOISE_COLORS: NoiseColor[] = ['white', 'pink', 'brown', 'blue']

export function isNoise(waveform: Waveform): waveform is NoiseColor {
  return (NOISE_COLORS as string[]).includes(waveform)
}

/** Too thin a pulse has almost no energy left; a useful duty cycle lives in this range. */
export const MIN_PULSE_WIDTH = 0.05
export const MAX_PULSE_WIDTH = 0.95

const HARMONICS = 64

/**
 * The falling ramp: the sawtooth's complement.
 *
 * Web Audio's `sawtooth` rises from -1 to 1. Negating every harmonic gives the one that falls.
 * On its own it sounds identical — the ear does not hear absolute phase — but against other
 * voices the two cancel and reinforce differently, which is the point of having both.
 */
export function rampHarmonics(count = HARMONICS): {
  real: Float32Array
  imag: Float32Array
} {
  const real = new Float32Array(count + 1)
  const imag = new Float32Array(count + 1)
  for (let n = 1; n <= count; n++) {
    imag[n] = (2 / (n * Math.PI)) * (n % 2 === 0 ? 1 : -1)
  }
  return { real, imag }
}

/**
 * Web Audio ships no pulse oscillator, only a fixed square. This builds one as a `PeriodicWave`
 * from the Fourier series of a pulse train with duty cycle `duty`:
 *
 *     b(n) = (2 / nπ) · sin(nπ · duty)
 *
 * At duty = 0.5 the even harmonics cancel out and the result is exactly a square wave, which is
 * the check that the formula is right.
 */
export function pulseHarmonics(
  duty: number,
  count = HARMONICS,
): { real: Float32Array; imag: Float32Array } {
  const d = Math.min(MAX_PULSE_WIDTH, Math.max(MIN_PULSE_WIDTH, duty))
  const real = new Float32Array(count + 1)
  const imag = new Float32Array(count + 1)
  for (let n = 1; n <= count; n++) {
    imag[n] = ((2 / (n * Math.PI)) * Math.sin(n * Math.PI * d)) as number
  }
  return { real, imag }
}
