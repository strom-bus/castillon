import { describe, expect, it } from 'vitest'
import { follow, followCoefficient, followState, MAX_FOLLOW_MS, MIN_FOLLOW_MS } from './dsp'

/**
 * The envelope follower: how loud a branch is, as a signal something else can be moved by.
 *
 * The one thing worth being careful about is that **up and down are different speeds**, and that is not a
 * refinement — it is the feature. A single smoothing constant gives a follower that lets go as slowly as
 * it grabs, which tracks the *average* of a branch rather than its shape, and the shape is what anybody
 * wants to hear. Fast up and slow down is what makes a follower duck on the attack of a note and recover
 * between notes, which is the gesture every sidechain in music is.
 */

const RATE = 48000

/** Runs a signal through, in blocks of 128 as the audio thread would. */
function through(input: Float32Array, attackMs: number, releaseMs: number, gain = 1) {
  const state = followState()
  const out = new Float32Array(input.length)
  const up = followCoefficient(attackMs, RATE)
  const down = followCoefficient(releaseMs, RATE)
  for (let at = 0; at < input.length; at += 128) {
    const block = input.subarray(at, Math.min(at + 128, input.length))
    const into = new Float32Array(block.length)
    follow(block, into, up, down, gain, state)
    out.set(into, at)
  }
  return out
}

/** A burst of full-scale signal, then silence. */
function burst(onMs: number, offMs: number): Float32Array {
  const on = Math.round((onMs / 1000) * RATE)
  const off = Math.round((offMs / 1000) * RATE)
  const out = new Float32Array(on + off)
  for (let i = 0; i < on; i++) out[i] = Math.sin((2 * Math.PI * 440 * i) / RATE)
  return out
}

/** Where the output has got to, at a moment given in milliseconds. */
const at = (out: Float32Array, ms: number) => out[Math.round((ms / 1000) * RATE)]

describe('the envelope follower', () => {
  it('is silent on silence and stays there', () => {
    // A follower that idled above nought would be a modulation nobody asked for, applied for ever.
    const out = through(new Float32Array(4096), 5, 200)
    for (const value of out) expect(value).toBe(0)
  })

  it('rises to the size of what it hears, and stops there', () => {
    const out = through(burst(400, 0), 20, 200)
    const settled = at(out, 350)
    expect(settled).toBeGreaterThan(0.6)
    expect(settled).toBeLessThanOrEqual(1)
    // Settled, not still climbing: a follower that never arrived would be a slow fade dressed as a level.
    expect(Math.abs(settled - at(out, 250))).toBeLessThan(0.02)
  })

  it('follows the peaks rather than the average, which is what the asymmetry buys', () => {
    /*
     * The rectified magnitude of a full-scale sine averages 2/π — about 0.64 — and that is where a
     * *symmetrical* follower settles, because it falls between the peaks of the wave as readily as it
     * rises to them. Asymmetrical, it climbs on every peak and barely falls in between, so it settles near
     * the peak instead.
     *
     * That difference is the whole reason for two controls, and it is worth an assertion of its own: I
     * expected the average and measured the peak, which is the follower being right and the expectation
     * being wrong.
     */
    /*
     * Averaged over a window at the end rather than sampled at one instant, which the first version did.
     * A single sample carries both the ripple of the wave and however far a one-pole has got to — and a
     * 200 ms smoothing measured at 350 ms is only four fifths of the way there, so it read as an average
     * that was not the average.
     */
    const tail = (out: Float32Array) => {
      const from = Math.round(0.5 * RATE)
      let sum = 0
      for (let i = from; i < out.length; i++) sum += out[i]
      return sum / (out.length - from)
    }
    const asymmetric = tail(through(burst(600, 0), 5, 500))
    const symmetric = tail(through(burst(600, 0), 20, 20))

    expect(symmetric).toBeCloseTo(2 / Math.PI, 1)
    expect(asymmetric).toBeGreaterThan(symmetric + 0.2)
  })

  it('grabs faster than it lets go, which is the whole point', () => {
    /*
     * The claim this file exists for. Asked to rise in five milliseconds and fall in five hundred, it has
     * to be most of the way up almost at once and still well up long after the sound has stopped.
     */
    const out = through(burst(100, 400), 5, 500)
    // Up within twenty milliseconds of the note starting.
    expect(at(out, 20)).toBeGreaterThan(0.5)
    // And still holding a third of that a hundred milliseconds after it ended.
    expect(at(out, 200)).toBeGreaterThan(at(out, 20) / 3)
  })

  it('lets go faster when it is asked to', () => {
    const slow = through(burst(100, 400), 5, 500)
    const quick = through(burst(100, 400), 5, 20)
    expect(at(quick, 160)).toBeLessThan(at(slow, 160) / 2)
  })

  it('is symmetrical when both times are the same, so the asymmetry is the setting', () => {
    // Or every test above would pass on a follower that ignored one of its two controls and happened to be
    // fast. Same time both ways: the decay after a burst mirrors the rise into it.
    const out = through(burst(200, 200), 50, 50)
    const rise = at(out, 50) / at(out, 190)
    const fall = at(out, 250) / at(out, 190)
    expect(rise).toBeCloseTo(1 - fall, 1)
  })

  it('scales what it hears before smoothing it, so a quiet branch can still drive something', () => {
    /*
     * Sensitivity is an input gain and not an output one, and the difference shows at the top: scaled
     * before, a quiet branch reaches full control signal and *stays* there through the loud parts.
     * Scaled after, it would only ever reach a fraction of the way and the control would be unusable on
     * exactly the branches that need it.
     */
    const quiet = new Float32Array(burst(300, 0).map((v) => v * 0.1))
    expect(at(through(quiet, 20, 200, 1), 250)).toBeLessThan(0.1)
    expect(at(through(quiet, 20, 200, 8), 250)).toBeGreaterThan(0.4)
  })

  it('never goes negative, whatever it is fed', () => {
    // It reads the *size* of a signal, so a control signal below nought would be a follower inverting the
    // thing it is pointed at — which is what a negative depth is for, one layer up.
    const wobbly = Float32Array.from(
      { length: 8192 },
      (_, i) => Math.sin(i / 3) * (i % 7 === 0 ? -2 : 1),
    )
    for (const value of through(wobbly, 5, 50, 4)) expect(value).toBeGreaterThanOrEqual(0)
  })

  it('answers something usable for a response time that cannot be', () => {
    // A hand-built patch or an older code can carry anything, and a coefficient outside nought to one is a
    // filter that runs away rather than one that smooths.
    for (const ms of [-100, 0, 1e9]) {
      const c = followCoefficient(ms, RATE)
      expect(c).toBeGreaterThan(0)
      expect(c).toBeLessThanOrEqual(1)
    }
    expect(followCoefficient(50, 0)).toBe(1)
    // And the fastest setting is faster than the slowest, or the control is upside down.
    expect(followCoefficient(MIN_FOLLOW_MS, RATE)).toBeGreaterThan(
      followCoefficient(MAX_FOLLOW_MS, RATE),
    )
  })
})
