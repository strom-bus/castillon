import { describe, expect, it } from 'vitest'
import { MAX_REPEATS, stutter, stutterState } from './dsp'

/**
 * The beat-repeat, tested as arithmetic.
 *
 * A stutter is one control away from an echo in a list and nothing like it in behaviour: an echo *adds* a
 * decaying copy while the original keeps going, and a stutter **replaces** what happened next with what
 * happened before. So the tests are about identity — is this slice the same samples as that one — which
 * is a thing that can be asserted exactly rather than approximately.
 *
 * Driven with a ramp rather than a sine, deliberately: every sample is a different number, so a slice
 * copied from the wrong place, read at the wrong offset or dropped entirely is visible as a value, where
 * a periodic signal would hide all three.
 */

/** A ramp, so every sample says where it came from. */
const ramp = (count: number, from = 0) =>
  Float32Array.from({ length: count }, (_, i) => (from + i) / 1000)

/** Runs a signal through in blocks of 128, as the audio thread would. */
function through(input: Float32Array, slice: number, repeats: number, rate = 48000): Float32Array {
  const state = stutterState(rate)
  const out = new Float32Array(input.length)
  for (let at = 0; at < input.length; at += 128) {
    const block = input.subarray(at, Math.min(at + 128, input.length))
    const into = new Float32Array(block.length)
    stutter(block, into, slice, repeats, state)
    out.set(into, at)
  }
  return out
}

const sliceOf = (signal: Float32Array, index: number, length: number) =>
  Array.from(signal.subarray(index * length, (index + 1) * length))

describe('the stutter', () => {
  it('is a wire at one repeat, sample for sample', () => {
    /*
     * The promise every effect here makes, and for this one it is exact rather than close: at one repeat
     * every slice is the live one, so the input is recorded and passed through and nothing is ever played
     * back. Not "almost transparent" — identical.
     */
    const input = ramp(1024)
    expect(Array.from(through(input, 100, 1))).toEqual(Array.from(input))
  })

  it('plays every other slice twice at two repeats', () => {
    const slice = 100
    const out = through(ramp(slice * 6), slice, 2)

    // Slices 0, 2 and 4 are live; 1, 3 and 5 are the ones before them, exactly.
    expect(sliceOf(out, 1, slice)).toEqual(sliceOf(out, 0, slice))
    expect(sliceOf(out, 3, slice)).toEqual(sliceOf(out, 2, slice))
    // And the live ones are still the input, so it repeats without also replacing what it repeats.
    expect(sliceOf(out, 2, slice)).toEqual(sliceOf(ramp(slice * 6), 2, slice))
  })

  it('holds one slice for the whole group at four, then takes a new one', () => {
    const slice = 64
    const out = through(ramp(slice * 9), slice, 4)

    for (const repeat of [1, 2, 3]) {
      expect(sliceOf(out, repeat, slice), `repeat ${repeat}`).toEqual(sliceOf(out, 0, slice))
    }
    // The fifth slice starts a new group, so it is live material and *not* the one being repeated.
    expect(sliceOf(out, 4, slice)).not.toEqual(sliceOf(out, 0, slice))
    expect(sliceOf(out, 4, slice)).toEqual(sliceOf(ramp(slice * 9), 4, slice))
  })

  it('throws away what happened during a repeat rather than queueing it', () => {
    /*
     * The difference from a delay, said as a property. A delay would eventually play everything; a stutter
     * plays a slice again *instead of* what came next, and that material is simply gone. So the fifth
     * slice at four repeats is the input's fifth slice, not its second.
     */
    const slice = 64
    const out = through(ramp(slice * 9), slice, 4)
    expect(sliceOf(out, 4, slice)).not.toEqual(sliceOf(ramp(slice * 9), 1, slice))
  })

  it('takes a new slice length between groups, not between repeats', () => {
    /*
     * Two failures hide here and only one is obvious. Changing the length **mid-slice** jumps the read
     * head into the middle of the recorded waveform, which is a click. Changing it between two *repeats*
     * of the same group is subtler and worse: the repeats then play a different length than was recorded,
     * so every one of them is a different fragment and the loop stops being a loop.
     *
     * Asserted on the audio rather than on the state field, because a version that moved the length at
     * every boundary rather than at every group left the field-based version of this test green.
     */
    const slice = 64
    const state = stutterState(48000)
    const input = ramp(slice * 8)
    const out = new Float32Array(input.length)

    // The whole first slice at 64, then a shorter length asked for from the second block on — which is
    // inside the group of four and must not land until the group ends.
    for (let at = 0; at < input.length; at += slice) {
      const into = new Float32Array(slice)
      stutter(input.subarray(at, at + slice), into, at === 0 ? slice : 20, 4, state)
      out.set(into, at)
    }

    for (const repeat of [1, 2, 3]) {
      expect(sliceOf(out, repeat, slice), `repeat ${repeat} played a different length`).toEqual(
        sliceOf(out, 0, slice),
      )
    }
  })

  it('never reads past the buffer it was given, however long a slice it is asked for', () => {
    /*
     * A typed array answers `undefined` past its end rather than throwing, and a `Float32Array` turns
     * that into **NaN** — which is silence at best and a locked-up graph at worst, and it does not throw
     * anywhere for anybody to catch.
     *
     * Exposing it takes patience: a slice longer than the line keeps the effect in its live pass, where
     * it never reads, so the first version of this test ran 256 samples and proved nothing. It has to run
     * long enough to finish an over-long slice and start repeating one.
     */
    const rate = 8000
    const line = rate * 3
    const state = stutterState(rate)
    const total = line * 3
    const out = new Float32Array(128)
    for (let at = 0; at < total; at += 128) {
      // Asked for a slice a little longer than the whole buffer.
      stutter(ramp(128, at), out, line + 500, 2, state)
      for (const value of out) expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('survives a slice length that cannot be one', () => {
    // Nought and negatives arrive from a tempo somebody set to an extreme, or from an older patch code.
    const state = stutterState(8000)
    const out = new Float32Array(256)
    for (const slice of [-5, 0, 1]) {
      expect(() => stutter(ramp(256), out, slice, 4, state)).not.toThrow()
      for (const value of out) expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('clamps a repeat count from somewhere careless', () => {
    const slice = 32
    const input = ramp(slice * 4)
    // Below one is a wire, not a division by nothing.
    expect(Array.from(through(input, slice, 0))).toEqual(Array.from(input))
    expect(Array.from(through(input, slice, -3))).toEqual(Array.from(input))
    // And past the cap it behaves as the cap rather than holding a slice for ever.
    expect(Array.from(through(ramp(slice * 40), slice, 999))).toEqual(
      Array.from(through(ramp(slice * 40), slice, MAX_REPEATS)),
    )
  })

  it('keeps its place across block boundaries, since a slice is not a multiple of 128', () => {
    /*
     * The thing a block-based test can hide. A slice of 100 samples straddles every 128-sample block, so
     * the position and the repeat counter both have to survive being handed a fresh array — which is the
     * whole reason the state is a parameter rather than a local.
     */
    const slice = 100
    const out = through(ramp(slice * 4), slice, 2)
    expect(sliceOf(out, 1, slice)).toEqual(sliceOf(out, 0, slice))
    expect(sliceOf(out, 3, slice)).toEqual(sliceOf(out, 2, slice))
  })
})
