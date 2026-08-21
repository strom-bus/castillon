import { describe, expect, it } from 'vitest'
import { waveAt } from './engine'
import { LFO_SHAPES } from './modulation'

/**
 * The wave a value-rate modulation is driven by.
 *
 * It exists because an `OscillatorNode` cannot be sampled, which makes it a *second* definition of a
 * shape the audio path already has — so what matters is that it agrees: a square that stepped at a
 * different place here than in the oscillator would be two controls wearing one name.
 */

describe('waveAt', () => {
  it('starts every shape at the value the oscillator does', () => {
    // Web Audio's oscillators all begin at zero except the square, which begins at its peak.
    expect(waveAt('sine', 0)).toBeCloseTo(0, 6)
    expect(waveAt('triangle', 0)).toBe(-1)
    expect(waveAt('sawtooth', 0)).toBe(-1)
    expect(waveAt('square', 0)).toBe(1)
  })

  it('stays inside minus one and one, whatever the phase', () => {
    for (const shape of LFO_SHAPES) {
      for (let i = 0; i <= 200; i++) {
        const value = waveAt(shape, i / 37)
        expect(value).toBeGreaterThanOrEqual(-1)
        expect(value).toBeLessThanOrEqual(1)
      }
    }
  })

  it('repeats every turn, so a rate means cycles per second', () => {
    for (const shape of LFO_SHAPES) {
      expect(waveAt(shape, 0.3)).toBeCloseTo(waveAt(shape, 7.3), 6)
    }
  })

  it('goes up and comes back for the shapes that should', () => {
    expect(waveAt('sine', 0.25)).toBeCloseTo(1, 6)
    expect(waveAt('sine', 0.75)).toBeCloseTo(-1, 6)
    expect(waveAt('triangle', 0.25)).toBeCloseTo(0, 6)
    expect(waveAt('triangle', 0.5)).toBeCloseTo(1, 6)
  })

  it('steps rather than slides, for the square', () => {
    expect(waveAt('square', 0.49)).toBe(1)
    expect(waveAt('square', 0.51)).toBe(-1)
  })

  it('handles a negative phase, since a clock can be read before a modulator started', () => {
    for (const shape of LFO_SHAPES) {
      expect(Number.isFinite(waveAt(shape, -0.4))).toBe(true)
    }
  })
})
