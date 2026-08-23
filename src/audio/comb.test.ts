import { describe, expect, it } from 'vitest'
import {
  comb,
  combDamping,
  combFeedback,
  combState,
  MAX_COMB_FEEDBACK,
  MAX_COMB_NOTE,
  MIN_COMB_NOTE,
} from './dsp'

/**
 * The comb resonator, tested as arithmetic.
 *
 * Everything that can go wrong here is inaudible until it is obvious. A resonator a semitone out of tune
 * sounds fine on its own and wrong against anything; one whose ring length changes when you retune it
 * sounds like a broken control rather than a musical one; and one whose feedback reaches 1 is not a bug
 * you notice, it is a bug you hear once through a pair of headphones.
 *
 * So the questions asked are about *pitch* and *time*, which are the two things the ear checks, and they
 * are asked of the signal rather than of the coefficients — a test that recomputes the same formula the
 * code uses proves only that it typed it twice.
 */

const RATE = 48000

/** Runs `seconds` of silence through a resonator struck once at the start. */
function struck(
  hz: number,
  seconds: number,
  ring: number,
  dampAt = RATE / 2,
  rate = RATE,
): Float32Array {
  const state = combState(rate)
  const delay = rate / hz
  const feedback = combFeedback(hz, ring)
  const damping = combDamping(dampAt, rate)

  const total = Math.round(rate * seconds)
  const out = new Float32Array(total)
  const block = new Float32Array(128)
  const into = new Float32Array(128)

  for (let at = 0; at < total; at += 128) {
    block.fill(0)
    // One sample of excitation, at the very start. A resonator has no sound of its own, so the shortest
    // possible strike is the cleanest way to hear only what it does.
    if (at === 0) block[0] = 1
    comb(block, into, delay, feedback, damping, state)
    out.set(into.subarray(0, Math.min(128, total - at)), at)
  }
  return out
}

/** The loudest sample in a window, which is the envelope read at one point. */
const peak = (signal: Float32Array, from: number, to: number) => {
  let most = 0
  for (let i = from; i < Math.min(to, signal.length); i++)
    most = Math.max(most, Math.abs(signal[i]))
  return most
}

/**
 * Energy in a window, in decibels against the strike.
 *
 * RMS and not the peak, which is a correction rather than a preference. A comb fed a single sample puts
 * out a *pulse train*, and the loop's low-pass widens each pulse as it goes round — so the peak falls
 * faster than the energy does and every ring measured that way reads twenty decibels short. The first
 * version of these tests failed for exactly that reason and the arithmetic was innocent.
 */
function level(signal: Float32Array, at: number, window = 2400): number {
  const rms = (from: number) => {
    let sum = 0
    for (let i = from; i < Math.min(from + window, signal.length); i++) sum += signal[i] * signal[i]
    return Math.sqrt(sum / window)
  }
  return 20 * Math.log10(rms(at) / rms(0))
}

/** The magnitude of one frequency in one window, by correlation against a sine and a cosine. */
function magnitudeAt(signal: Float32Array, from: number, count: number, hz: number): number {
  let re = 0
  let im = 0
  for (let i = 0; i < count; i++) {
    const turn = (2 * Math.PI * hz * (from + i)) / RATE
    re += signal[from + i] * Math.cos(turn)
    im -= signal[from + i] * Math.sin(turn)
  }
  return Math.hypot(re, im) / count
}

/**
 * The period the signal actually repeats at, in samples, found by correlation.
 *
 * Measured rather than assumed. Counting peaks would have been easier and would have agreed with a
 * resonator ringing at twice the pitch, since a comb fed an impulse puts out a train and a train has a
 * peak whether or not the sign alternates.
 */
function periodOf(signal: Float32Array, from: number, low: number, high: number): number {
  let best = 0
  let bestScore = -Infinity
  const window = Math.min(signal.length - from - high, 8000)
  for (let lag = Math.floor(low); lag <= Math.ceil(high); lag++) {
    let score = 0
    for (let i = 0; i < window; i++) score += signal[from + i] * signal[from + i + lag]
    if (score > bestScore) {
      bestScore = score
      best = lag
    }
  }
  return best
}

describe('the comb resonator', () => {
  it('rings at the pitch it was tuned to', () => {
    // 200 Hz is 240 samples at this rate, which is a whole number — so this is the easy case, and the
    // one that would still pass if the interpolation were removed entirely.
    const out = struck(200, 0.3, 1)
    expect(periodOf(out, 1000, 200, 280)).toBe(240)
  })

  it('is in tune where the delay is not a whole number of samples', () => {
    /*
     * The case integer delays cannot do, and the reason there is interpolation at all. 1000 Hz wants 48
     * samples exactly, so it proves nothing; 1046.5 Hz — C6 — wants 45.87, and rounding to 46 is five
     * cents flat while rounding to 45 is thirty-three sharp. Asserted in cents, because that is the unit
     * the error is audible in.
     */
    const hz = 1046.5
    const out = struck(hz, 0.2, 1)
    // Correlation answers in whole samples, so the period is read from a longer stretch: fifteen cycles
    // of a 45.87-sample wave repeat every 688, and the error in *that* is a fifteenth of the error here.
    const fifteen = periodOf(out, 2000, 15 * 45.87 - 12, 15 * 45.87 + 12)
    const cents = 1200 * Math.log2(fifteen / (15 * (RATE / hz)))
    expect(Math.abs(cents)).toBeLessThan(10)
  })

  it('holds its tuning across the whole range it offers', () => {
    for (const note of [MIN_COMB_NOTE, 48, 69, MAX_COMB_NOTE]) {
      const hz = 440 * Math.pow(2, (note - 69) / 12)
      const want = RATE / hz
      const out = struck(hz, 0.4, 2)
      const found = periodOf(out, Math.round(want * 4), want * 0.85, want * 1.15)
      const cents = 1200 * Math.log2(found / want)
      expect(Math.abs(cents), `note ${note} is ${cents.toFixed(1)} cents out`).toBeLessThan(25)
    }
  })

  it('rings for as long as it was asked to, whatever the pitch', () => {
    /*
     * The whole reason the control is a time and not a feedback amount. One trip round the loop is one
     * cycle of the note, so a fixed feedback rings eight times longer at 100 Hz than at 800 — and a
     * control that changed the length of a note when you retuned it would be a fault, not a feature.
     *
     * Sixty decibels down at the time asked for, to within three, over three octaves.
     */
    for (const hz of [100, 400, 800]) {
      const db = level(struck(hz, 1, 0.5), Math.round(RATE * 0.5))
      expect(db, `${hz} Hz reads ${db.toFixed(1)} dB at half a second`).toBeLessThan(-57)
      expect(db, `${hz} Hz reads ${db.toFixed(1)} dB at half a second`).toBeGreaterThan(-63)
    }
  })

  it('falls a little short at the ends of its range and never long', () => {
    /*
     * Both ends deviate and both for a reason worth stating rather than hiding behind a loose bound: the
     * lowest note loses about two decibels to the loop's high-pass, which has to sit below it, and the
     * highest loses about twelve because linear interpolation is a mild low-pass and a trip round the
     * loop up there is twenty-three samples rather than fourteen hundred.
     *
     * Asserted as *shorter, never longer*, which is the direction that cannot surprise anybody. A ring
     * that outlasted its setting would pile up under the next note.
     */
    for (const hz of [32.7, 2093]) {
      const db = level(struck(hz, 1, 0.5), Math.round(RATE * 0.5))
      expect(db, `${hz} Hz reads ${db.toFixed(1)} dB at half a second`).toBeLessThan(-57)
      expect(db, `${hz} Hz reads ${db.toFixed(1)} dB at half a second`).toBeGreaterThan(-80)
    }
  })

  it('shortens the ring as the damping closes', () => {
    /*
     * A struck string loses its top and its length together — more damping is a duller *and* shorter
     * note, which is why Ring is the length with the loop open rather than a promise the damping has to
     * be compensated against. Read at one pitch, so the pitch compensation in `combFeedback` cannot
     * confound it: an earlier version of this compared two pitches and was measuring both at once.
     */
    const at = (damping: number) => level(struck(200, 1, 1, damping), Math.round(RATE * 0.5))
    const corners = [RATE / 2, 6000, 2000, 800]
    const lengths = corners.map(at)

    for (let i = 1; i < lengths.length; i++) {
      expect(lengths[i], `corner ${corners[i]} rings longer than ${corners[i - 1]}`).toBeLessThan(
        lengths[i - 1],
      )
    }
    // And it is a real difference rather than a rounding: fully open against a corner at 800 is a note
    // three times shorter, not a shade duller.
    expect(lengths[lengths.length - 1]).toBeLessThan(lengths[0] - 25)
  })

  it('darkens as it dies, so the partials go before the note does', () => {
    /*
     * The one multiplication that separates a struck string from a metallic buzz, and the thing damping
     * is *for*. A comb at 200 Hz resonates at 200, 400, 600 and up; a single sample of excitation puts
     * something in all of them, and a corner at 800 takes the upper ones away first.
     *
     * Read as a spectrum rather than as an envelope, because "darkens" is a statement about which
     * frequencies are left and an envelope cannot answer it.
     */
    const out = struck(200, 0.6, 1, 800)
    const lost = (hz: number) =>
      20 *
      Math.log10(
        magnitudeAt(out, Math.round(RATE * 0.3), 4800, hz) / magnitudeAt(out, 2400, 4800, hz),
      )

    expect(lost(1600), 'the eighth partial outlasts the fundamental').toBeLessThan(lost(200) - 6)
    expect(lost(3200), 'the sixteenth partial outlasts the eighth').toBeLessThan(lost(200) - 6)
  })

  it('cannot run away, even asked for an endless ring at the loudest setting', () => {
    /*
     * The failure nobody catches in a test and everybody catches in headphones. A loop at exactly unity
     * never decays; a shade above it doubles every cycle. Asked for a ring of a thousand seconds the
     * feedback saturates at its cap, and the cap has to be below one rather than at it.
     */
    expect(combFeedback(100, 1e6)).toBeLessThan(1)
    expect(combFeedback(100, 1e6)).toBeLessThanOrEqual(MAX_COMB_FEEDBACK)

    /*
     * The bound itself, pinned rather than derived. Exactly one is not a worse setting than 0.9995, it is
     * a different thing: a loop that neither grows nor decays, so a note struck once goes on sounding
     * until the transport stops. Nothing downstream can tell that apart from a stuck voice, and no test
     * about the audio catches it — raising the cap to one leaves the ring bounded and every other
     * assertion here green.
     */
    expect(MAX_COMB_FEEDBACK).toBeLessThan(1)

    /*
     * And the clamp inside the loop, which is the one that matters. `combFeedback` cannot return one for
     * any finite time, so raising the cap to exactly one leaves every test about *it* green — the cap is
     * there for a value arriving from somewhere else, which is what a modulation cable is. So this hands
     * the loop a feedback above one directly and asks it to stay bounded anyway.
     */
    const state = combState(RATE)
    const strike = new Float32Array(128)
    const block = new Float32Array(128)
    strike[0] = 1
    comb(strike, block, 240, 1.5, 0, state)
    for (let i = 0; i < 800; i++) comb(new Float32Array(128), block, 240, 1.5, 0, state)
    expect(peak(block, 0, 128), 'a feedback above one has to be clamped, not obeyed').toBeLessThan(
      2,
    )

    const out = struck(100, 4, 1e6)
    // Four seconds in it is still going — that is the point of the setting — and it has not grown.
    expect(level(out, Math.round(RATE * 3.5))).toBeGreaterThan(-40)
    expect(peak(out, 0, out.length)).toBeLessThan(4)
  })

  it('lets no direct current out, and does not sit on any either', () => {
    /*
     * A steady offset is the one input a resonator handles badly by construction: a low-pass has a gain
     * of exactly one at nought hertz, so a nought in the delay line is multiplied by the feedback and by
     * nothing else, once per trip. At a high pitch a trip is thirty samples and the feedback is 0.996,
     * which is a thump lasting a seventh of a second at no pitch at all — louder and longer than the
     * note standing in front of it. There are two high-passes for this, one in the loop and one on the
     * tap, and neither is visible in anything a listener would describe.
     */
    const state = combState(RATE)
    const on = new Float32Array(128).fill(1)
    const out = new Float32Array(128)
    let last = new Float32Array(128)
    for (let i = 0; i < 400; i++) {
      comb(on, out, RATE / 1600, combFeedback(1600, 1), combDamping(800, RATE), state)
      last = out.slice()
    }
    let mean = 0
    for (const sample of last) mean += sample
    mean /= last.length
    // Half a second of hard offset in, and what comes out is centred and bounded rather than climbing.
    expect(Math.abs(mean)).toBeLessThan(0.05)
    expect(peak(last, 0, last.length)).toBeLessThan(2)
  })

  it('is silent until it is struck, and silent again if nothing strikes it', () => {
    // A resonator has no sound of its own. One that hummed would be an oscillator with extra steps.
    const state = combState(RATE)
    const out = new Float32Array(128)
    for (let i = 0; i < 100; i++) {
      comb(new Float32Array(128), out, 240, MAX_COMB_FEEDBACK, 0, state)
      expect(peak(out, 0, 128)).toBe(0)
    }
  })

  it('starts in tune rather than sliding up to pitch', () => {
    /*
     * The delay chases its target so that retuning a ringing resonator bends rather than clicks, and the
     * first block would otherwise chase it up from zero — every note beginning with a swoop. A resonator
     * built this block starts where it was told.
     */
    const out = struck(200, 0.1, 1)
    expect(periodOf(out, 300, 200, 280)).toBe(240)
  })

  it('bends rather than clicking when it is retuned mid-ring', () => {
    /*
     * Retuning by jumping the read head cuts the waveform mid-cycle, which is a click. The delay chases
     * its target instead, which sounds like a string being bent.
     *
     * Driven continuously rather than struck once, and that is the whole test rather than a detail: with
     * a single impulse the delay line is almost all zeros, so a jumped read head usually lands on silence
     * and the discontinuity never appears. Written that way first, and deleting the glide left it green.
     */
    const state = combState(RATE)
    const out = new Float32Array(128)
    const drive = new Float32Array(128)
    let phase = 0
    const fill = () => {
      for (let i = 0; i < 128; i++) {
        drive[i] = 0.5 * Math.sin(phase)
        phase += (2 * Math.PI * 200) / RATE
      }
    }

    // Long enough for the line to be full at the old pitch.
    for (let i = 0; i < 60; i++) {
      fill()
      comb(drive, out, RATE / 200, combFeedback(200, 2), 0, state)
    }

    const slew = () => {
      let most = 0
      for (let i = 1; i < out.length; i++) most = Math.max(most, Math.abs(out[i] - out[i - 1]))
      return most
    }
    const steady = slew()

    // Retuned an octave up while it is sounding, which is the largest jump a hand can make.
    let worst = 0
    for (let i = 0; i < 40; i++) {
      fill()
      comb(drive, out, RATE / 400, combFeedback(400, 2), 0, state)
      worst = Math.max(worst, slew())
    }

    // A slid read head cannot outrun what the waveform itself does between samples; a jumped one puts a
    // step in that is several times that.
    expect(worst, `${worst.toFixed(3)} against a steady ${steady.toFixed(3)}`).toBeLessThan(
      steady * 2.5,
    )
  })

  it('opens the loop filter fully at and above Nyquist instead of inverting it', () => {
    // A corner the loop cannot reach is no filter. Left unclamped the coefficient goes on shrinking,
    // and past the point where it would go negative the one-pole becomes a high-pass — a different
    // instrument, arrived at by turning a knob labelled Damping to the top.
    expect(combDamping(RATE / 2, RATE)).toBeGreaterThanOrEqual(0)
    expect(combDamping(RATE * 4, RATE)).toBeGreaterThanOrEqual(0)
    expect(combDamping(20, RATE)).toBeGreaterThan(combDamping(2000, RATE))
  })

  it('answers something harmless for a rate or a pitch that cannot be', () => {
    expect(combDamping(0, RATE)).toBe(0)
    expect(combDamping(1000, 0)).toBe(0)
    expect(combFeedback(100, 0)).toBeLessThan(0.01)
  })
})
