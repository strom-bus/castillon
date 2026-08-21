import type { DistortionShape } from '../types/patch'

/**
 * The pure maths behind the effects: curves and buffers, no Web Audio.
 *
 * Kept apart so the part that is easy to get quietly wrong can be tested directly, rather than
 * only being heard.
 */

export const MIN_BITS = 2
export const MAX_BITS = 16

/** Resolution of the tables handed to a `WaveShaperNode`. */
const CURVE_POINTS = 1024

/**
 * Three flavours of the same stage, differing only in how hard the knee is.
 *
 * All three are the identity at `amount` 0, which matters: an effect at its lowest setting should
 * be transparent rather than nearly so.
 *
 * - `overdrive` is the classic soft clip, `y = (1 + k)x / (1 + k|x|)`, gentle enough to thicken.
 * - `distortion` uses `tanh`, which turns over harder and squares off sooner.
 * - `fuzz` compresses so far that almost everything reaches full scale, and is slightly asymmetric
 *   — that asymmetry adds even harmonics, and it is what separates fuzz from loud distortion.
 */
const SHAPES: Record<DistortionShape, (x: number, amount: number) => number> = {
  overdrive(x, amount) {
    const k = amount * 30
    return ((1 + k) * x) / (1 + k * Math.abs(x))
  },
  distortion(x, amount) {
    const k = amount * 40
    return k === 0 ? x : Math.tanh(x * (1 + k)) / Math.tanh(1 + k)
  },
  /**
   * Full-wave rectification, which doubles the frequency: this is how an analogue octave-up pedal
   * works, and why it sounds fuzzy rather than clean. `amount` adds grit on top rather than fading
   * the effect in — an octaver at its lowest setting still octaves, since that is what it is.
   *
   * Rectifying leaves a DC offset behind, so the chain that uses this has to block DC.
   */
  octave(x, amount) {
    const rectified = 2 * Math.abs(x) - 1
    const k = amount * 20
    return k === 0 ? rectified : ((1 + k) * rectified) / (1 + k * Math.abs(rectified))
  },
  fuzz(x, amount) {
    const k = amount * 60
    if (k === 0) return x
    // The bias is the asymmetry: it clips the two halves of the wave by different amounts.
    const biased = x + amount * 0.15
    const shaped = Math.sign(biased) * (1 - Math.exp(-Math.abs(biased) * (1 + k)))
    return shaped / (1 - Math.exp(-(1 + amount * 0.15) * (1 + k)))
  },
}

export function distortionCurve(
  shape: DistortionShape,
  amount: number,
  points = CURVE_POINTS,
): Float32Array<ArrayBuffer> {
  const clamped = Math.min(1, Math.max(0, amount))
  const fn = SHAPES[shape] ?? SHAPES.overdrive
  const curve = new Float32Array(points)
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1
    curve[i] = Math.max(-1, Math.min(1, fn(x, clamped)))
  }
  return curve
}

/**
 * A staircase that rounds the signal to `bits` of resolution.
 *
 * This is bit-depth reduction only. The other half of a bitcrusher — decimating the sample rate — is
 * `decimate` below, which needs state between samples and therefore an `AudioWorklet`.
 */
export function crushCurve(bits: number, points = CURVE_POINTS): Float32Array<ArrayBuffer> {
  const clamped = Math.min(MAX_BITS, Math.max(MIN_BITS, Math.round(bits)))
  const steps = Math.pow(2, clamped) - 1
  const curve = new Float32Array(points)
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1
    curve[i] = Math.round(((x + 1) / 2) * steps) / steps / 0.5 - 1
  }
  return curve
}

/**
 * A reverb impulse response, generated rather than loaded: noise shaped by an exponential decay.
 *
 * It ships nothing and fetches nothing, which is the point. It is not a real room — no early
 * reflections, no modal structure — but for a synth tail it is convincing, and two decorrelated
 * channels give it width.
 */
export function impulseResponse(
  seconds: number,
  sampleRate: number,
  random: () => number = Math.random,
): Float32Array<ArrayBuffer>[] {
  const length = Math.max(1, Math.floor(seconds * sampleRate))
  return [0, 1].map(() => {
    const channel = new Float32Array(length)
    for (let i = 0; i < length; i++) {
      // Squared so the tail falls away steeply at first and then lingers, which is what a decay
      // sounds like; a straight ramp reads as a fade rather than a room.
      const envelope = Math.pow(1 - i / length, 2)
      channel[i] = (random() * 2 - 1) * envelope
    }
    return channel
  })
}

/** Sample-rate reduction: 1 leaves the signal alone, 32 holds each sample for thirty-two outputs. */
export const MIN_REDUCTION = 1
export const MAX_REDUCTION = 32

/** What a decimator has to remember between blocks: the sample it is holding, and for how long. */
export interface DecimateState {
  held: number
  counted: number
}

export function decimateState(): DecimateState {
  return { held: 0, counted: 0 }
}

/**
 * Sample-rate decimation, one block at a time.
 *
 * A sample-and-hold on the audio itself: take one sample, emit it `hold` times, take the next. The
 * effective sample rate becomes the real one divided by `hold`, and everything above the new Nyquist
 * folds back down — which is the sound. No filtering, deliberately: filtering it would remove the
 * aliasing, and the aliasing is the whole point, the same argument that keeps the bit-depth shaper
 * un-oversampled.
 *
 * This is the thing a `WaveShaperNode` cannot do. A curve maps a sample to a sample with no memory,
 * and holding a value *is* memory — which is why this half of the bitcrusher waited for a worklet.
 *
 * Pure over its arguments, state included, so it can be tested without any of Web Audio.
 */
export function decimate(
  input: Float32Array,
  output: Float32Array,
  hold: number,
  state: DecimateState,
): void {
  const every = Math.max(1, Math.round(hold))

  for (let i = 0; i < input.length; i++) {
    // Counted up rather than down so that a hold of 1 takes every sample and changing `hold` mid-block
    // cannot strand the counter above the new value.
    if (state.counted <= 0) {
      state.held = input[i]
      state.counted = every
    }
    output[i] = state.held
    state.counted--
  }
}
