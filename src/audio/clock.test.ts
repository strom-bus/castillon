import { describe, expect, it } from 'vitest'
import { midiToFreq, noteName, stepDuration } from './clock'

describe('clock', () => {
  it('turns BPM and division into a step length', () => {
    expect(stepDuration(120, '1/4')).toBeCloseTo(0.5, 6)
    expect(stepDuration(120, '1/8')).toBeCloseTo(0.25, 6)
    expect(stepDuration(60, '1/16')).toBeCloseTo(0.25, 6)
  })

  it('turns a MIDI note into a frequency', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6)
    expect(midiToFreq(57)).toBeCloseTo(220, 6)
    expect(midiToFreq(81)).toBeCloseTo(880, 6)
  })

  it('names notes', () => {
    expect(noteName(60)).toBe('C4')
    expect(noteName(24)).toBe('C1')
    expect(noteName(61)).toBe('C#4')
    expect(noteName(84)).toBe('C6')
  })
})
