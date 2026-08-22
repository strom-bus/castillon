import type { FilterType } from '../types/patch'

export const FILTER_TYPES: FilterType[] = ['off', 'lowpass', 'highpass', 'bandpass']

export const FILTER_NAMES: Record<FilterType, string> = {
  off: 'Off',
  lowpass: 'Low pass',
  highpass: 'High pass',
  bandpass: 'Band pass',
}

/** Short markers for the node header. `off` shows nothing at all. */
export const FILTER_LABELS: Record<FilterType, string> = {
  off: '',
  lowpass: 'LP',
  highpass: 'HP',
  bandpass: 'BP',
}

/**
 * The note key tracking measures from: C1, the bottom of what a step can hold.
 *
 * Anchoring at the bottom rather than at middle C is what keeps the control from ever working backwards.
 * Every note is at or above C1, so turning tracking up only ever opens the filter — where a reference in
 * the middle would darken any patch whose notes happened to sit below it, which reads as the knob doing
 * the opposite of what it says.
 */
export const KEY_ANCHOR = 24

/**
 * The cutoff a particular note gets, once key tracking has had its say.
 *
 * Absolute Hz is the wrong unit for this instrument, and not as a matter of taste. The die spreads notes
 * across three octaves, so one setting is bright at the top of an oscillator's range and dead at the
 * bottom — and unlike a keyboard, where a player stays in a register and trims by ear, here the machine
 * chooses the register. Without this there is no cutoff value that suits what a roll actually produces.
 *
 * At 1 the cutoff doubles every octave, which is the filter following pitch exactly. At 0 it does not
 * move, which is what everything did before this existed.
 */
export function trackedCutoff(cutoff: number, note: number, keyTrack: number): number {
  if (keyTrack <= 0) return cutoff
  return cutoff * Math.pow(2, (keyTrack * (note - KEY_ANCHOR)) / 12)
}

export const MIN_CUTOFF = 20
export const MAX_CUTOFF = 18000

/** Above this the filter self-oscillates loudly enough to be a hazard rather than an effect. */
export const MIN_RESONANCE = 0.1
export const MAX_RESONANCE = 24

const RANGE = Math.log(MAX_CUTOFF / MIN_CUTOFF)

/**
 * Cutoff is stored in Hz but edited on a logarithmic slider.
 *
 * A linear 20–18000 control is useless: everything musically interesting happens in the bottom
 * tenth of it, and the top half is all the same hiss. Mapping through log space gives each
 * octave the same amount of travel, which is how the ear hears it.
 */
export function cutoffToSlider(hz: number): number {
  const clamped = Math.min(MAX_CUTOFF, Math.max(MIN_CUTOFF, hz))
  return Math.log(clamped / MIN_CUTOFF) / RANGE
}

export function sliderToCutoff(position: number): number {
  const clamped = Math.min(1, Math.max(0, position))
  return MIN_CUTOFF * Math.exp(clamped * RANGE)
}

/** 2400 → "2.4k", 440 → "440" */
export function formatCutoff(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}`
}
