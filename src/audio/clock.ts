import type { Division } from '../types/patch'

/** Cuántos negras dura un paso, según la división. */
const DIVISION_BEATS: Record<Division, number> = {
  '1/4': 1,
  '1/8': 0.5,
  '1/16': 0.25,
}

export const DIVISIONS = Object.keys(DIVISION_BEATS) as Division[]

/** Duración de un paso en segundos. */
export function stepDuration(bpm: number, division: Division): number {
  return (60 / bpm) * DIVISION_BEATS[division]
}

/** Duración de un compás de 4/4 en segundos. */
export function barDuration(bpm: number): number {
  return (60 / bpm) * 4
}

export function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** 60 → "C4" */
export function noteName(note: number): string {
  const name = NOTE_NAMES[((note % 12) + 12) % 12]
  const octave = Math.floor(note / 12) - 1
  return `${name}${octave}`
}
