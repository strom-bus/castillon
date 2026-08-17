import type { Waveform } from '../types/patch'
import type { NoiseColor } from './noise'

export const WAVEFORMS: Waveform[] = [
  'square',
  'pulse',
  'sawtooth',
  'triangle',
  'sine',
  'white',
  'pink',
  'brown',
]

/** Short labels, so they fit in the node header. */
export const WAVEFORM_LABELS: Record<Waveform, string> = {
  square: 'SQR',
  pulse: 'PUL',
  sawtooth: 'SAW',
  triangle: 'TRI',
  sine: 'SIN',
  white: 'WHT',
  pink: 'PNK',
  brown: 'BRN',
}

export const WAVEFORM_NAMES: Record<Waveform, string> = {
  square: 'Square',
  pulse: 'Pulse',
  sawtooth: 'Sawtooth',
  triangle: 'Triangle',
  sine: 'Sine',
  white: 'White noise',
  pink: 'Pink noise',
  brown: 'Brown noise',
}

const NOISE_COLORS: NoiseColor[] = ['white', 'pink', 'brown']

export function isNoise(waveform: Waveform): waveform is NoiseColor {
  return (NOISE_COLORS as string[]).includes(waveform)
}

/** Too thin a pulse has almost no energy left; a useful duty cycle lives in this range. */
export const MIN_PULSE_WIDTH = 0.05
export const MAX_PULSE_WIDTH = 0.95

const HARMONICS = 64

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
