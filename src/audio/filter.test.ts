import { describe, expect, it } from 'vitest'
import { cutoffToSlider, formatCutoff, MAX_CUTOFF, MIN_CUTOFF, sliderToCutoff } from './filter'

describe('cutoff mapping', () => {
  it('spans the whole audible range end to end', () => {
    expect(sliderToCutoff(0)).toBeCloseTo(MIN_CUTOFF, 6)
    expect(sliderToCutoff(1)).toBeCloseTo(MAX_CUTOFF, 6)
  })

  it('round-trips', () => {
    for (const hz of [20, 100, 440, 1000, 2000, 8000, 18000]) {
      expect(sliderToCutoff(cutoffToSlider(hz))).toBeCloseTo(hz, 4)
    }
  })

  it('gives every octave the same amount of travel', () => {
    // This is the whole point of the log mapping: a linear control would spend nine tenths of
    // its range above 2 kHz, where it barely does anything musical.
    const octave = (hz: number) => cutoffToSlider(hz * 2) - cutoffToSlider(hz)
    const low = octave(100)
    const high = octave(4000)
    expect(low).toBeCloseTo(high, 6)
  })

  it('clamps rather than running off either end', () => {
    expect(cutoffToSlider(1)).toBe(0)
    expect(cutoffToSlider(50000)).toBe(1)
    expect(sliderToCutoff(-3)).toBeCloseTo(MIN_CUTOFF, 6)
    expect(sliderToCutoff(9)).toBeCloseTo(MAX_CUTOFF, 6)
  })

  it('puts the midpoint at the geometric mean, not the arithmetic one', () => {
    const middle = sliderToCutoff(0.5)
    expect(middle).toBeCloseTo(Math.sqrt(MIN_CUTOFF * MAX_CUTOFF), 4)
    // Which is around 600 Hz, not the 9 kHz a linear slider would land on.
    expect(middle).toBeLessThan(1000)
  })
})

describe('formatCutoff', () => {
  it('switches to kHz once it stops being readable in Hz', () => {
    expect(formatCutoff(440)).toBe('440')
    expect(formatCutoff(999)).toBe('999')
    expect(formatCutoff(2400)).toBe('2.4k')
    expect(formatCutoff(18000)).toBe('18.0k')
  })
})
