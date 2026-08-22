import type { Division } from '../types/patch'

/** How many quarter notes a step lasts, per division. */
const DIVISION_BEATS: Record<Division, number> = {
  '1/4': 1,
  '1/8': 0.5,
  '1/16': 0.25,
}

export const DIVISIONS = Object.keys(DIVISION_BEATS) as Division[]

/** Step length in seconds. */
export function stepDuration(bpm: number, division: Division): number {
  return (60 / bpm) * DIVISION_BEATS[division]
}

export function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

/** A hundred cents is a semitone, so twelve hundred of them is the octave every ratio here is built on. */
const CENTS_PER_OCTAVE = 1200

/**
 * The frequency ratio a detune in cents amounts to.
 *
 * Which is the answer to unison on this instrument. Adding voices to one oscillator is how a classic
 * thickens a sound, and it would multiply the budget we spent days measuring. But the cascade already
 * hands you several oscillators — what it does not hand you is a reason for two of them to read as one
 * thick voice rather than as two separate ones. Setting them a few cents apart is that reason, and it
 * costs nothing: the voices already exist, so the point count does not move.
 */
export function detuneRatio(cents: number): number {
  return Math.pow(2, cents / CENTS_PER_OCTAVE)
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** 60 → "C4" */
export function noteName(note: number): string {
  const name = NOTE_NAMES[((note % 12) + 12) % 12]
  const octave = Math.floor(note / 12) - 1
  return `${name}${octave}`
}
