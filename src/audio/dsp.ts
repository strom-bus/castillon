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
 * The classic soft-clip curve: `y = (1 + k)x / (1 + k|x|)`.
 *
 * At `amount` 0 it is the identity, which matters — an effect at its lowest setting should be
 * transparent rather than nearly so.
 */
export function driveCurve(amount: number, points = CURVE_POINTS): Float32Array<ArrayBuffer> {
  const k = Math.max(0, amount) * 100
  const curve = new Float32Array(points)
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x))
  }
  return curve
}

/**
 * A staircase that rounds the signal to `bits` of resolution.
 *
 * This is bit-depth reduction only. The other half of a bitcrusher — decimating the sample rate —
 * means holding samples between outputs, which a `WaveShaperNode` cannot do and which would need
 * an `AudioWorklet`. The quantisation grit is the audible half.
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

/** The normalised `depth` parameter carries bit depth, so the two have to agree on the mapping. */
export function depthToBits(depth: number): number {
  const clamped = Math.min(1, Math.max(0, depth))
  return MIN_BITS + Math.round(clamped * (MAX_BITS - MIN_BITS))
}

export function bitsToDepth(bits: number): number {
  const clamped = Math.min(MAX_BITS, Math.max(MIN_BITS, Math.round(bits)))
  return (clamped - MIN_BITS) / (MAX_BITS - MIN_BITS)
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
