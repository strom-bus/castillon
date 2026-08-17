import { describe, expect, it } from 'vitest'
import { MAX_PULSE_WIDTH, MIN_PULSE_WIDTH, pulseHarmonics } from './waveforms'

describe('pulseHarmonics', () => {
  it('at 50 % duty it is exactly a square wave', () => {
    // A square wave has no even harmonics. That the formula produces them as zeros is the
    // check that it is the right Fourier series.
    const { imag } = pulseHarmonics(0.5, 8)
    expect(imag[2]).toBeCloseTo(0, 10)
    expect(imag[4]).toBeCloseTo(0, 10)
    expect(imag[6]).toBeCloseTo(0, 10)
    expect(Math.abs(imag[1])).toBeGreaterThan(0.5)
    expect(Math.abs(imag[3])).toBeGreaterThan(0.1)
  })

  it('at 25 % duty the fourth harmonic drops out', () => {
    // sin(nπ · 0.25) is zero whenever n is a multiple of 4.
    const { imag } = pulseHarmonics(0.25, 8)
    expect(imag[4]).toBeCloseTo(0, 10)
    expect(imag[8]).toBeCloseTo(0, 10)
    expect(Math.abs(imag[1])).toBeGreaterThan(0)
  })

  it('leaves the DC and cosine terms empty', () => {
    const { real, imag } = pulseHarmonics(0.3, 4)
    expect([...real].every((v) => v === 0)).toBe(true)
    expect(imag[0]).toBe(0)
  })

  it('clamps the duty cycle to a usable range', () => {
    expect(pulseHarmonics(0, 4).imag[1]).toBeCloseTo(pulseHarmonics(MIN_PULSE_WIDTH, 4).imag[1], 10)
    expect(pulseHarmonics(1, 4).imag[1]).toBeCloseTo(pulseHarmonics(MAX_PULSE_WIDTH, 4).imag[1], 10)
  })

  it('returns count + 1 coefficients, index 0 being DC', () => {
    const { real, imag } = pulseHarmonics(0.5, 16)
    expect(real).toHaveLength(17)
    expect(imag).toHaveLength(17)
  })
})
