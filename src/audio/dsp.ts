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
   *
   * **The grit is applied to the magnitude, before it is centred, and that ordering is the whole of it.**
   * The other way round — centre to -1..1 and then soft-clip — clips a signal that is *sitting* at -1 for
   * any quiet input, so the limiter saturates on the offset instead of on the sound: the waveform
   * flattens to a near-constant, the alternating part collapses, and the high-pass behind it takes away
   * what little is left. Measured at a tenth the level of the other three shapes on the same input, which
   * is what it sounded like. Clipping the magnitude first is what a pedal does — its fuzz stage is
   * AC-coupled and never sees the offset at all.
   */
  octave(x, amount) {
    const magnitude = Math.abs(x)
    /*
     * Far gentler than the other three, and measured rather than chosen. They clip a signal that swings
     * both ways, so hard clipping drives them toward a square wave — which is the loudest thing there is.
     * This one clips a *magnitude*, which only ever goes up, so the same amount of clipping pins the
     * whole waveform against the top and leaves almost no alternating part at all. Twenty was the old
     * figure and it collapsed a quiet note to a tenth of the level of every other shape. Four is where the
     * level stays flattest across input levels, which is what was measured for rather than guessed at.
     */
    const k = amount * 4
    const driven = k === 0 ? magnitude : ((1 + k) * magnitude) / (1 + k * magnitude)
    // Centred last, so the doubled wave uses the whole range whatever the input level was.
    return 2 * driven - 1
  },
  fuzz(x, amount) {
    const k = amount * 60
    if (k === 0) return x
    /*
     * The bias is the asymmetry: it clips the two halves of the wave by different amounts, and that is
     * what puts even harmonics in and separates fuzz from loud distortion.
     *
     * **A twentieth, not a seventh.** It used to be 0.15, which is larger than the amplitude of a great
     * many notes here — an oscillator at its default gain under an envelope spends most of its life below
     * that. A signal smaller than the bias never crosses zero at all, so it is not clipped asymmetrically,
     * it is clipped *entirely on one side*: the waveform pins against the rail, the alternating part
     * collapses and the high-pass behind it takes away what is left. Measured at a tenth of the level of
     * the other shapes on a quiet note, which is the same fault octave-up had for the same reason.
     *
     * At 0.05 the bias is still three times the clipping knee at full drive, so the asymmetry is very much
     * there — it simply no longer swallows the signal it is meant to be shaping.
     */
    const bias = amount * 0.05
    const biased = x + bias
    const shaped = Math.sign(biased) * (1 - Math.exp(-Math.abs(biased) * (1 + k)))
    return shaped / (1 - Math.exp(-(1 + bias) * (1 + k)))
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
 * How far a wavefolder drives the signal into the folds at full amount.
 *
 * Eight means a peak-level input travels two whole periods of the folding function, which is four
 * reflections — enough that the fundamental is no longer the loudest thing in the output, which is the
 * point of the effect. Higher gets denser and stops being a note; lower never leaves the first fold and
 * is just a triangle-shaped distortion.
 */
const MAX_FOLD_GAIN = 8

/**
 * The folding function: a triangle that is the **identity** between -1 and 1 and reflects outside it.
 *
 * `asin(sin(·))` rather than an arithmetic reflection, because it is exact at the corners and there is no
 * modulo to get the sign of wrong. Period 4, slope 1 through the origin, so a signal inside the range
 * passes through untouched and one driven past it comes back down instead of stopping.
 *
 * That coming-back-down is the whole difference from a clipper, and it is why this is a *waveshape* and
 * not an amount of dirt: a clipper's curve never decreases, so its output is always a squashed version of
 * its input. A folder's turns over, so a louder input can be a *quieter* output and the harmonics move
 * as the level does. Nothing else here changes timbre with dynamics.
 */
function foldOnce(value: number): number {
  return (2 / Math.PI) * Math.asin(Math.sin((value * Math.PI) / 2))
}

/**
 * The curve for a wavefolder: drive pushes the signal into the folds, bias pushes it off centre.
 *
 * **Bias is the control worth having.** Folding a centred signal reflects it identically above and below,
 * which produces odd harmonics only — a hollow, clarinet-like tone however hard it is driven. Offsetting
 * it first makes the two halves fold differently, and that asymmetry is what puts *even* harmonics in.
 * Swept, it is the west-coast timbre: one control moving the harmonic content rather than the volume or
 * the filter, which is a thing nothing else in this instrument can do.
 *
 * Transparent at rest by construction, like every effect here: at drive nought and bias nought the gain
 * is one, the offset is nothing, and the fold is the identity over the whole domain.
 */
export function foldCurve(
  drive: number,
  bias: number,
  points = CURVE_POINTS,
): Float32Array<ArrayBuffer> {
  const amount = Math.min(1, Math.max(0, drive))
  const offset = Math.min(1, Math.max(-1, bias))
  const gain = 1 + amount * (MAX_FOLD_GAIN - 1)

  const curve = new Float32Array(points)
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1
    // The offset is added *after* the gain, so it stays a quarter of a fold whatever the drive is. Added
    // before, a bias would be multiplied into whole periods and come back round to no asymmetry at all.
    curve[i] = foldOnce(x * gain + offset)
  }
  return curve
}

/**
 * The longest slice a stutter can hold, in seconds.
 *
 * A quarter note at the slowest tempo the transport allows: three seconds. Allocated for the worst case
 * rather than grown on demand, because a buffer that reallocates mid-loop is a click, and because the
 * worst case is one three-second array per channel — less than a reverb's impulse response.
 */
export const MAX_SLICE_SECONDS = 3

/** How many times a slice may be repeated before the next one is taken. One is a wire. */
export const MIN_REPEATS = 1
export const MAX_REPEATS = 8

/**
 * What a stutter has to remember: the slice it captured, where it is in playing it, and which repeat.
 */
export interface StutterState {
  line: Float32Array
  /** Position within the current slice, counted in samples. */
  at: number
  /**
   * Which repeat of the group this is. Nought is the live one — passed through *and* recorded — and every
   * other value plays back what nought captured.
   */
  repeat: number
  /**
   * The slice length in use, which is only read at a boundary.
   *
   * Changing it mid-slice would jump the read head into the middle of the recorded waveform, which is a
   * click; and a stutter's slice is a *musical* length, so the only sensible moment for a new one to take
   * effect is when the current one ends.
   */
  length: number
}

export function stutterState(sampleRate: number): StutterState {
  return {
    line: new Float32Array(Math.max(1, Math.ceil(sampleRate * MAX_SLICE_SECONDS))),
    at: 0,
    repeat: 0,
    length: 0,
  }
}

/**
 * One block through a beat-repeat.
 *
 * A stutter is not an echo, and the difference is worth stating because they are one control apart in a
 * list. An echo *adds* a decaying copy some time later and the original keeps going underneath. A stutter
 * **replaces** the signal: it takes a slice, plays it again in place of what actually happened next, and
 * nothing decays. What you hear is a bar that stops advancing.
 *
 * The model is one number: how many times each slice is played before the next is taken. At one it is a
 * wire — the live slice is passed through and recorded, and there is never a repeat — which is the
 * promise every effect here makes. At two, every other slice is the one before it. At eight, a bar of the
 * cascade turns into one eighth of itself.
 *
 * Which also means it needs no on/off of its own: a MOD on the repeat count *is* the momentary switch,
 * and a slow shape on it is a stutter that comes and goes.
 *
 * Pure over its arguments, state included, so it can be tested with two arrays and no audio thread.
 */
export function stutter(
  input: Float32Array,
  output: Float32Array,
  sliceSamples: number,
  repeats: number,
  state: StutterState,
): void {
  const size = state.line.length
  const wanted = Math.max(1, Math.min(size, Math.round(sliceSamples)))
  const groups = Math.max(MIN_REPEATS, Math.min(MAX_REPEATS, Math.round(repeats)))
  // A resonator built this block starts at the length it was told rather than at nothing.
  if (state.length === 0) state.length = wanted

  for (let i = 0; i < input.length; i++) {
    if (state.at >= state.length) {
      state.at = 0
      state.repeat = (state.repeat + 1) % groups
      // A new slice length only ever lands here, between slices.
      if (state.repeat === 0) state.length = wanted
    }

    if (state.repeat === 0) {
      // The live pass: heard as it happens and kept for the repeats that follow.
      state.line[state.at] = input[i]
      output[i] = input[i]
    } else {
      output[i] = state.line[state.at]
    }

    state.at++
  }
}

/** How fast a follower may be asked to react, in milliseconds. */
export const MIN_FOLLOW_MS = 1
export const MAX_FOLLOW_MS = 2000

/** How much of the input becomes control signal, at the top of the control. */
export const MAX_SENSITIVITY = 8

/** What a follower remembers: the level it has arrived at. */
export interface FollowState {
  level: number
}

export function followState(): FollowState {
  return { level: 0 }
}

/**
 * One block of envelope following: the size of the signal, smoothed, with a fast way up and a slow way
 * down.
 *
 * **Why the two are different is the whole feature.** A single smoothing constant gives a follower that
 * lets go as slowly as it grabs, which tracks the *average* of a branch rather than its shape — and the
 * shape is what anybody wants to hear. Fast up and slow down is what makes a follower duck on the attack
 * of a note and recover between notes, which is the gesture every sidechain in music is.
 *
 * `|x|` rather than a square: the rectified magnitude is what an analogue detector reads, and it needs no
 * root afterwards. Both coefficients are one-pole, computed from a time to reach roughly two thirds of the
 * way — which is what "attack" and "release" mean on every compressor ever built.
 *
 * Pure over its arguments, state included, so it can be tested with two arrays and no audio thread.
 */
export function follow(
  input: Float32Array,
  output: Float32Array,
  attackCoefficient: number,
  releaseCoefficient: number,
  gain: number,
  state: FollowState,
): void {
  const up = Math.min(1, Math.max(0, attackCoefficient))
  const down = Math.min(1, Math.max(0, releaseCoefficient))
  const scale = Math.max(0, gain)

  for (let i = 0; i < input.length; i++) {
    const size = Math.abs(input[i]) * scale
    // Rising uses the attack and falling uses the release, which is the one branch in the whole function
    // and the reason it cannot be a biquad.
    const rate = size > state.level ? up : down
    state.level += (size - state.level) * rate
    output[i] = state.level
  }
}

/**
 * The one-pole coefficient for a response time, at a sample rate.
 *
 * Time to about two thirds of the way there, which is what a compressor means by attack and release — not
 * time to arrive, which for a one-pole is never.
 */
export function followCoefficient(milliseconds: number, sampleRate: number): number {
  if (!(sampleRate > 0)) return 1
  const ms = Math.min(MAX_FOLLOW_MS, Math.max(MIN_FOLLOW_MS, milliseconds))
  return Math.min(1, Math.max(0, 1 - Math.exp(-1 / ((ms / 1000) * sampleRate))))
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
/**
 * Writes one channel of a reverb tail into an array that already exists.
 *
 * In place because the caller has somewhere to put it. Building the channel separately and copying it into
 * an audio buffer allocates the whole tail twice, and a tail is a megabyte — which is nothing for one
 * reverb and a hundred and fifty for a measurement holding seventy-nine of them.
 */
export function fillImpulse(channel: Float32Array, random: () => number = Math.random): void {
  const length = channel.length
  for (let i = 0; i < length; i++) {
    // Squared so the tail falls away steeply at first and then lingers, which is what a decay sounds
    // like; a straight ramp reads as a fade rather than a room.
    const envelope = Math.pow(1 - i / length, 2)
    channel[i] = (random() * 2 - 1) * envelope
  }
}

export function impulseResponse(
  seconds: number,
  sampleRate: number,
  random: () => number = Math.random,
): Float32Array<ArrayBuffer>[] {
  const length = Math.max(1, Math.floor(seconds * sampleRate))
  return [0, 1].map(() => {
    const channel = new Float32Array(length)
    fillImpulse(channel, random)
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

/**
 * How fast the divider's detector follows the signal, and how far from zero it has to travel.
 *
 * The detector reads a smoothed copy rather than the signal itself. Raw, every wobble near zero counts
 * as a crossing and the divider flips at random — a hiss rather than an octave. The threshold is
 * hysteresis on top of that: the signal has to get clearly above zero and clearly below before the
 * next flip counts.
 */
const DETECT_SMOOTHING = 0.02
const DETECT_THRESHOLD = 0.02

/** What a divider has to remember between samples. */
export interface OctaveState {
  /** The smoothed copy the crossings are counted on. */
  smoothed: number
  /** Whether the last confident reading was above the threshold. */
  above: boolean
  /** The divider's current sign, flipped on every crossing. */
  sign: number
}

export function octaveState(): OctaveState {
  return { smoothed: 0, above: false, sign: 1 }
}

/**
 * An octave below, by dividing the signal's own frequency.
 *
 * The oldest trick in the pedal book and still the only way to do it without analysis: a flip-flop
 * clocked by the signal's zero crossings gives a square at half the frequency, and multiplying the
 * input by that square puts the fundamental an octave down. It is not a pitch shifter and does not
 * pretend to be — on a chord it tracks the loudest partial and grinds on the rest, which is the sound
 * rather than a shortcoming.
 *
 * This is what a `WaveShaperNode` cannot do. Octave *up* is full-wave rectification, a curve with no
 * memory, which is why it has been a fourth distortion shape all along. Going down needs to know what
 * the signal did last sample, and memory is what a worklet is for.
 *
 * Pure over its arguments, state included, so it can be tested with two arrays and no audio thread.
 */
export function octaveDown(input: Float32Array, output: Float32Array, state: OctaveState): void {
  for (let i = 0; i < input.length; i++) {
    state.smoothed += (input[i] - state.smoothed) * DETECT_SMOOTHING

    if (state.above) {
      if (state.smoothed < -DETECT_THRESHOLD) state.above = false
    } else if (state.smoothed > DETECT_THRESHOLD) {
      state.above = true
      // One flip per cycle of the input, so the square runs at half its frequency.
      state.sign = -state.sign
    }

    output[i] = input[i] * state.sign
  }
}

/**
 * The comb resonator: a delay line short enough to be a pitch, fed back into itself.
 *
 * A delay of one two-hundredth of a second repeats what you put in two hundred times a second, which is
 * not an echo — it is a note. Feed it back and it rings at that pitch; put a low-pass inside the loop
 * and each trip round loses its top, so the ring starts bright and darkens as it dies. That last part is
 * the whole difference between a struck string and a metallic buzz, and it is one multiplication.
 *
 * Karplus-Strong, in other words, with the excitation left to whoever wired something into it. There is
 * no oscillator here: the resonator has no sound of its own and every note it plays is the shape of
 * whatever was fed in, which is why it belongs among the effects rather than among the nodes.
 *
 * **What the Ring control is worth, measured.** Asked for half a second, the tail is 58 to 59 decibels
 * down at half a second anywhere from 100 Hz to 800 — which is the promise, since the control solves for
 * a time rather than naming a feedback amount. Both ends of the range fall a little short and both for a
 * stated reason: the lowest note loses about two decibels to the loop's high-pass (see `DC_CORNER`), and
 * the highest loses about twelve because linear interpolation is itself a mild low-pass and a trip round
 * the loop up there is twenty-three samples rather than fourteen hundred. Shorter than asked at the very
 * top, never longer, and never a different pitch.
 *
 * **Why this needs a worklet at all.** A `DelayNode` inside a feedback loop is held to a minimum of one
 * render quantum — 128 samples — so the highest pitch a native comb can reach is the sample rate over
 * 128: about 344 Hz at 44.1 kHz and 375 at 48. Not just low, but *different on different hardware*,
 * which for a tuned resonator means the same patch plays a different note on another machine. There is
 * no version of that worth shipping.
 */

/** Lowest and highest note the resonator can be tuned to, as MIDI numbers: C1 to C7. */
export const MIN_COMB_NOTE = 24
export const MAX_COMB_NOTE = 96

/**
 * The most of itself the loop may feed back.
 *
 * Below one, always: at exactly one the resonator never decays, and a shade above it doubles every trip
 * round the loop until it is the only thing anybody can hear. The margin is what makes that impossible
 * rather than unlikely.
 */
export const MAX_COMB_FEEDBACK = 0.9995

/**
 * How much of itself the loop keeps, to lose 60 dB in `seconds` at this pitch.
 *
 * The control is a *time* rather than a feedback amount because a resonator's feedback does not mean
 * anything on its own: one trip round the loop is one cycle of the note, so 0.99 rings for a third of a
 * second at 100 Hz and a twentieth at 2 kHz. Asking for a time and solving for the feedback keeps a ring
 * the same length as you retune it, which is what anyone turning the knob believes it does.
 */
export function combFeedback(hz: number, seconds: number): number {
  const trips = Math.max(1, hz * Math.max(0, seconds))
  return Math.min(MAX_COMB_FEEDBACK, Math.pow(10, -3 / trips))
}

/**
 * The one-pole low-pass coefficient for a corner at `hz`, at this sample rate.
 *
 * Returned as the weight the filter gives its *own* previous output, so the loop reads
 * `lp += (1 - damping) * (y - lp)` — a form whose gain at DC is exactly one. That matters more than it
 * looks: the filter sits inside the feedback loop, so any gain it had would multiply every trip round
 * and the ring would be a different length than asked for. At unity DC gain the low notes decay in the
 * time the control says and the high ones decay faster, which is the point of having it.
 */
export function combDamping(hz: number, sampleRate: number): number {
  if (!(hz > 0) || !(sampleRate > 0)) return 0
  // At and above Nyquist the filter is *gone*, not merely wide: `exp(-π)` is still 0.04, and a resonator
  // whose brightest setting quietly rounds off every trip round the loop is one whose Ring control lies
  // at the top of the knob. Zero is the only honest answer for a corner the loop cannot reach.
  if (hz >= sampleRate / 2) return 0
  return Math.max(0, Math.min(0.9999, Math.exp((-2 * Math.PI * hz) / sampleRate)))
}

/**
 * Where the loop's high-pass sits, in hertz. Low enough to be under the lowest note it can be tuned to.
 *
 * **Why a resonator needs one at all.** The loop is `x + feedback · lowpass(delayed)`, and a low-pass has
 * a gain of exactly one at nought hertz — so a direct current sitting in the delay line is multiplied by
 * the feedback and nothing else, once per trip. At a high pitch a trip is thirty samples and the feedback
 * is 0.996, which means any offset in whatever was fed in decays with a time constant of a seventh of a
 * second: a thump, sounding at no pitch, louder and longer than the note it is standing in front of.
 *
 * A real string does not do this because a fixed end reflects with its sign flipped, and a loop that
 * inverts has no resonance at nought hertz to begin with. Inverting this one would move every note it
 * plays by an octave, so the honest equivalent is to take the nought out on the way round.
 */
const DC_CORNER = 5

/** The high-pass's pole, kept where the loop is: one number, derived once per block. */
function dcPole(sampleRate: number): number {
  return sampleRate > 0 ? Math.max(0, 1 - (2 * Math.PI * DC_CORNER) / sampleRate) : 0
}

/** What a resonator has to remember: the loop itself, where it is writing, and the filter's last output. */
export interface CombState {
  /** The delay line, as long as the lowest note needs. Written round and round. */
  line: Float32Array
  write: number
  /** The low-pass's previous output, which is the only state the damping has. */
  low: number
  /** The loop's high-pass: its last input and last output, all a one-pole needs to block a nought. */
  dcIn: number
  dcOut: number
  /**
   * And a second one on the way out, which is not the same job.
   *
   * The loop's high-pass keeps a nought from *ringing*; this one keeps a nought from *leaving*. A send
   * carrying direct current is worse than useless — inaudible, and eating headroom in the master limiter
   * all the way past — and the tap is taken before the loop's filter, so it has not been through one.
   *
   * Taking the output from after the loop's high-pass instead would have cost nothing and been wrong:
   * that tap is the *damped* signal, and handing it out darkens the attack of whatever was fed in, which
   * is not the resonator's business. So the tap keeps its brightness and loses its nought separately.
   *
   * What this does **not** fix, measured rather than assumed: a comb tuned high with the damping closed
   * leaves a residue around twenty hertz, some fifty decibels under the strike, because a non-inverting
   * delay line has a resonance approaching nought and that is what the loop can still sustain when the
   * note itself cannot. Removing it wants a corner near thirty hertz, which is above the lowest note this
   * can be tuned to — so it would shorten a bass ring to fix an extreme setting, and it is left alone.
   */
  outIn: number
  outOut: number
  /** The high-pass's pole for the rate this was built at, since the rate cannot change under it. */
  pole: number
  /**
   * The delay actually in use, which chases the one asked for.
   *
   * Retuning a ringing resonator by jumping the read head cuts the waveform mid-cycle and clicks. This
   * slides instead, which sounds like a string being bent — a better answer than the click and a better
   * answer than refusing to retune.
   */
  delay: number
}

export function combState(sampleRate: number): CombState {
  // Long enough for the lowest note, plus a sample so the interpolation always has two to read.
  const longest = sampleRate / (440 * Math.pow(2, (MIN_COMB_NOTE - 69) / 12))
  return {
    line: new Float32Array(Math.ceil(longest) + 2),
    write: 0,
    low: 0,
    dcIn: 0,
    dcOut: 0,
    outIn: 0,
    outOut: 0,
    delay: 0,
    pole: dcPole(sampleRate),
  }
}

/** How fast the delay slides to a new pitch: a fifth of the way there each sample, per millisecond. */
const GLIDE = 0.0008

/**
 * One block through the resonator.
 *
 * Reads the line a fractional number of samples back, because integer delays cannot be tuned: at 48 kHz
 * a note wanting 24.4 samples gets 24, which is seventy cents sharp — audibly out of tune with anything
 * else playing. Linear interpolation between the two neighbouring samples costs one multiply and buys
 * the whole top of the range.
 *
 * Pure over its arguments, state included, so it can be tested with two arrays and no audio thread.
 */
export function comb(
  input: Float32Array,
  output: Float32Array,
  target: number,
  feedback: number,
  damping: number,
  state: CombState,
): void {
  const size = state.line.length
  // Two samples of headroom at each end: one for the interpolation to read, one so a delay equal to the
  // line length cannot land on the sample about to be overwritten.
  const wanted = Math.max(1, Math.min(size - 2, target))
  // A resonator built this block starts in tune rather than sliding up from nothing.
  if (state.delay === 0) state.delay = wanted
  const keep = Math.max(0, Math.min(MAX_COMB_FEEDBACK, feedback))
  const damp = Math.max(0, Math.min(0.9999, damping))

  for (let i = 0; i < input.length; i++) {
    state.delay += (wanted - state.delay) * GLIDE

    const back = state.write - state.delay + size
    const whole = Math.floor(back)
    const fraction = back - whole
    const a = state.line[whole % size]
    const b = state.line[(whole + 1) % size]
    const delayed = a + (b - a) * fraction

    // The filter's own output is what goes back round, so what the listener hears is the undamped tap
    // and what rings is the damped one. Taking the damped signal both ways would darken the attack of
    // whatever was fed in, which is not the resonator's business.
    state.low += (1 - damp) * (delayed - state.low)

    // And the nought comes out on the way round, or it is the loudest thing in the tail. See DC_CORNER.
    state.dcOut = state.low - state.dcIn + state.pole * state.dcOut
    state.dcIn = state.low

    state.line[state.write] = input[i] + state.dcOut * keep
    state.write = (state.write + 1) % size

    // The undamped tap, minus the nought the comb resonates at no matter what the loop does.
    state.outOut = delayed - state.outIn + state.pole * state.outOut
    state.outIn = delayed
    output[i] = state.outOut
  }
}
