import { MAX_SWEEP, MIN_SWEEP, type EffectKind, type FxParams } from '../types/patch'
import { stepDuration } from './clock'
import { crushCurve, distortionCurve, impulseResponse, MAX_BITS } from './dsp'
import { MAX_CUTOFF, MIN_CUTOFF } from './filter'

/** What an effect needs to know beyond its own parameters. */
export interface EffectContext {
  /** Absolute time on the audio clock. */
  at: number
  /** Needed by anything synced to the transport, which is why a tempo change updates effects. */
  bpm: number
}

/**
 * The live half of an effect: the chain that sits between an FX node's fixed input and output.
 *
 * Only the middle. The input and output `GainNode`s belong to the node itself and are never
 * replaced, which is what lets the effect be swapped from a dropdown without any cable in the
 * patch noticing.
 */
export interface EffectChain {
  input: AudioNode
  output: AudioNode
  update(params: FxParams, context: EffectContext): void
  /** Called after the node's output has already been faded out. */
  dispose(): void
}

export interface EffectDescriptor {
  kind: EffectKind
  label: string
  /**
   * The parameters the inspector shows beneath Mix, in order. Mix is not listed: every effect has
   * it, and it belongs to the node rather than to the chain.
   */
  params: readonly (keyof FxParams)[]
  /**
   * Overrides for what a parameter is called here. The same `cutoff` is a Tone control on a
   * shaping stage and the whole point on a filter, and calling it the same thing in both places
   * would be worse than either name.
   */
  labels?: Partial<Record<keyof FxParams, string>>
  /** Seconds the node's output is faded over before disposal, for effects with a tail. */
  releaseTime: number
  create(ctx: AudioContext): EffectChain
}

const RAMP = 0.02

/** The tone control the effects share: a low-pass, gentle enough to shape rather than to filter. */
function tone(ctx: AudioContext): BiquadFilterNode {
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.Q.value = 0.7
  filter.frequency.value = MAX_CUTOFF
  return filter
}

function setTone(filter: BiquadFilterNode, params: FxParams, at: number): void {
  const hz = Math.min(MAX_CUTOFF, Math.max(MIN_CUTOFF, params.cutoff ?? MAX_CUTOFF))
  filter.frequency.setTargetAtTime(hz, at, RAMP)
}

const reverb: EffectDescriptor = {
  kind: 'reverb',
  label: 'Reverb',
  params: ['decay', 'cutoff'],
  // Long enough that removing the node lets the tail out rather than cutting it off.
  releaseTime: 0.4,
  create(ctx) {
    const convolver = ctx.createConvolver()
    const damping = tone(ctx)
    convolver.connect(damping)
    let built = -1

    return {
      input: convolver,
      output: damping,
      update(params, { at }) {
        setTone(damping, params, at)

        // Rebuilding the impulse response allocates, so it only happens once the decay has moved
        // enough to hear. Without this, dragging the slider would rebuild it every frame.
        const decay = Math.round(params.decay * 10) / 10
        if (decay === built) return
        built = decay

        const channels = impulseResponse(decay, ctx.sampleRate)
        const buffer = ctx.createBuffer(channels.length, channels[0].length, ctx.sampleRate)
        channels.forEach((channel, i) => buffer.getChannelData(i).set(channel))
        convolver.buffer = buffer
      },
      dispose() {
        convolver.disconnect()
        damping.disconnect()
      },
    }
  },
}

const distortion: EffectDescriptor = {
  kind: 'distortion',
  label: 'Distortion',
  params: ['shape', 'drive', 'cutoff'],
  releaseTime: 0.02,
  create(ctx) {
    const shaper = ctx.createWaveShaper()
    // Distortion folds harmonics above Nyquist back down as aliasing; oversampling is what keeps
    // that from sounding like grit nobody played.
    shaper.oversample = '4x'
    // Rectifying leaves a DC offset, and so does an asymmetric curve — fuzz was already producing
    // one. Offset eats headroom and moves the speaker without being heard, so it goes here.
    const dcBlock = ctx.createBiquadFilter()
    dcBlock.type = 'highpass'
    dcBlock.frequency.value = 20
    const post = tone(ctx)
    shaper.connect(dcBlock)
    dcBlock.connect(post)
    let built = ''

    return {
      input: shaper,
      output: post,
      update(params, { at }) {
        setTone(post, params, at)
        const shape = params.shape ?? 'overdrive'
        const amount = Math.round(params.drive * 100) / 100
        // Rebuilding a 1024-point table is not free, so it happens when the sound would change
        // and not on every frame of a slider drag.
        const key = `${shape}:${amount}`
        if (key === built) return
        built = key
        shaper.curve = distortionCurve(shape, amount)
      },
      dispose() {
        shaper.disconnect()
        dcBlock.disconnect()
        post.disconnect()
      },
    }
  },
}

const crush: EffectDescriptor = {
  kind: 'crush',
  label: 'Bitcrusher',
  params: ['bits', 'cutoff'],
  releaseTime: 0.02,
  create(ctx) {
    const shaper = ctx.createWaveShaper()
    // Deliberately not oversampled: here the aliasing is the sound.
    shaper.oversample = 'none'
    const post = tone(ctx)
    shaper.connect(post)
    let built = -1

    return {
      input: shaper,
      output: post,
      update(params, { at }) {
        setTone(post, params, at)
        const bits = Math.round(params.bits ?? MAX_BITS)
        if (bits === built) return
        built = bits
        shaper.curve = crushCurve(bits)
      },
      dispose() {
        shaper.disconnect()
        post.disconnect()
      },
    }
  },
}

/** Slowest possible echo: one beat at the lowest tempo. */
const MAX_ECHO_SECONDS = 4

const echo: EffectDescriptor = {
  kind: 'echo',
  label: 'Echo',
  params: ['time', 'feedback', 'cutoff'],
  releaseTime: 0.3,
  create(ctx) {
    const line = ctx.createDelay(MAX_ECHO_SECONDS)
    const feedback = ctx.createGain()
    const damping = tone(ctx)

    // The tone control sits in the feedback path, not after the output, so each repeat comes back
    // darker than the last. That decay towards dullness is what a tape echo does, and it is what
    // stops long feedback settings turning into a pile of identical copies.
    line.connect(damping)
    damping.connect(feedback)
    feedback.connect(line)

    return {
      input: line,
      output: line,
      update(params, { at, bpm }) {
        setTone(damping, params, at)
        // Synced to the transport, so an echo stays in time when the tempo moves.
        const seconds = Math.min(MAX_ECHO_SECONDS, stepDuration(bpm, params.time ?? '1/8'))
        // Ramped rather than set: jumping the delay time of a running line pitches the repeats.
        line.delayTime.setTargetAtTime(seconds, at, RAMP)
        feedback.gain.setTargetAtTime(Math.min(0.95, Math.max(0, params.feedback ?? 0)), at, RAMP)
      },
      dispose() {
        line.disconnect()
        feedback.disconnect()
        damping.disconnect()
      },
    }
  },
}

/**
 * A filter on the bus, which is not the same sound as the oscillator's own. Per voice, sixteen
 * notes get sixteen filters; here one filter works on the sum, so the resonance rings against
 * everything at once.
 */
const filter: EffectDescriptor = {
  kind: 'filter',
  label: 'Filter',
  params: ['filterType', 'cutoff', 'resonance'],
  // Here the cutoff is the point rather than a shaping stage.
  labels: { cutoff: 'Cutoff' },
  releaseTime: 0.02,
  create(ctx) {
    const biquad = ctx.createBiquadFilter()
    biquad.type = 'lowpass'

    return {
      input: biquad,
      output: biquad,
      update(params, { at }) {
        const type = params.filterType ?? 'lowpass'
        // `off` is a valid setting for the oscillator's filter, where it skips the biquad. As an
        // effect there is nothing to skip, so it means all the way open instead.
        biquad.type = type === 'off' ? 'lowpass' : type
        const hz = type === 'off' ? MAX_CUTOFF : (params.cutoff ?? 2000)
        biquad.frequency.setTargetAtTime(Math.min(MAX_CUTOFF, Math.max(MIN_CUTOFF, hz)), at, RAMP)
        biquad.Q.setTargetAtTime(Math.max(0.1, params.resonance ?? 1), at, RAMP)
      },
      dispose() {
        biquad.disconnect()
      },
    }
  },
}

/** Never all the way to one: a modulated comb at unity feedback runs away rather than resonating. */
const MAX_CHORUS_FEEDBACK = 0.7

/**
 * Chorus and flanger are one effect with two settings, so they are one effect here.
 *
 * Sweep is what separates them. A few milliseconds gives harmonically spaced notches and the
 * metallic jet sweep of a flanger, especially with feedback up; twenty or thirty is heard as
 * detuned doubling instead. Shipping them as two entries would have been the same code twice.
 */
const chorus: EffectDescriptor = {
  kind: 'chorus',
  label: 'Chorus',
  params: ['sweep', 'rate', 'depth', 'feedback', 'cutoff'],
  releaseTime: 0.1,
  create(ctx) {
    const line = ctx.createDelay(0.1)
    const post = tone(ctx)
    const feedback = ctx.createGain()
    feedback.gain.value = 0
    line.connect(post)
    line.connect(feedback)
    feedback.connect(line)

    // The first internal LFO in the project, and the pattern parameter modulation will reuse: an
    // oscillator through a gain, connected to an AudioParam rather than to another node.
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    const swing = ctx.createGain()
    lfo.connect(swing)
    swing.connect(line.delayTime)
    lfo.start()

    return {
      input: line,
      output: post,
      update(params, { at }) {
        setTone(post, params, at)
        const centre = Math.min(MAX_SWEEP, Math.max(MIN_SWEEP, params.sweep ?? 6)) / 1000
        line.delayTime.setTargetAtTime(centre, at, RAMP)
        lfo.frequency.setTargetAtTime(Math.max(0.01, params.rate ?? 1.5), at, RAMP)
        // Swing is a share of the delay itself, so depth means the same thing at any sweep rather
        // than modulating a short delay straight through zero.
        swing.gain.setTargetAtTime((params.depth ?? 0.4) * centre * 0.9, at, RAMP)
        feedback.gain.setTargetAtTime(
          Math.min(MAX_CHORUS_FEEDBACK, Math.max(0, params.feedback ?? 0)),
          at,
          RAMP,
        )
      },
      dispose() {
        lfo.stop()
        lfo.disconnect()
        swing.disconnect()
        feedback.disconnect()
        line.disconnect()
        post.disconnect()
      },
    }
  },
}

/** Four stages is the classic count: enough notches to hear the sweep, few enough to stay cheap. */
const PHASER_STAGES = 4
const MAX_PHASER_FEEDBACK = 0.6

/**
 * A chain of all-pass filters with their frequencies swept together.
 *
 * Not a flanger with a different name: an all-pass chain puts its notches at frequencies that are
 * *not* harmonically related, which is why it sweeps hollow rather than metallic. The stages are
 * spread rather than stacked at one frequency, or the notches would pile up into one.
 */
const phaser: EffectDescriptor = {
  kind: 'phaser',
  label: 'Phaser',
  params: ['rate', 'depth', 'feedback', 'cutoff'],
  labels: { cutoff: 'Centre' },
  releaseTime: 0.05,
  create(ctx) {
    const stages = Array.from({ length: PHASER_STAGES }, () => {
      const filter = ctx.createBiquadFilter()
      filter.type = 'allpass'
      filter.Q.value = 0.6
      return filter
    })
    stages.forEach((stage, i) => {
      if (i > 0) stages[i - 1].connect(stage)
    })

    const last = stages[stages.length - 1]
    const feedback = ctx.createGain()
    feedback.gain.value = 0
    last.connect(feedback)
    feedback.connect(stages[0])

    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    const swing = ctx.createGain()
    lfo.connect(swing)
    // One modulator into every stage, so the notches move together and the sweep reads as one
    // gesture rather than four.
    for (const stage of stages) swing.connect(stage.frequency)
    lfo.start()

    return {
      input: stages[0],
      output: last,
      update(params, { at }) {
        const centre = Math.min(MAX_CUTOFF, Math.max(MIN_CUTOFF, params.cutoff ?? 600))
        stages.forEach((stage, i) => {
          // Spread across the stages, which is what keeps four notches instead of one deep one.
          stage.frequency.setTargetAtTime(centre * (1 + i * 0.6), at, RAMP)
        })
        lfo.frequency.setTargetAtTime(Math.max(0.01, params.rate ?? 0.6), at, RAMP)
        swing.gain.setTargetAtTime((params.depth ?? 0.6) * centre * 0.8, at, RAMP)
        feedback.gain.setTargetAtTime(
          Math.min(MAX_PHASER_FEEDBACK, Math.max(0, params.feedback ?? 0)),
          at,
          RAMP,
        )
      },
      dispose() {
        lfo.stop()
        lfo.disconnect()
        swing.disconnect()
        feedback.disconnect()
        for (const stage of stages) stage.disconnect()
      },
    }
  },
}

/**
 * Amplitude modulation. The cheapest effect here, and the one that most rewards a long branch: a
 * slow tremolo across a whole limb of the cascade does something none of the others can.
 */
const tremolo: EffectDescriptor = {
  kind: 'tremolo',
  label: 'Tremolo',
  params: ['rate', 'depth'],
  releaseTime: 0.02,
  create(ctx) {
    const amp = ctx.createGain()
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    const swing = ctx.createGain()
    lfo.connect(swing)
    swing.connect(amp.gain)
    lfo.start()

    return {
      input: amp,
      output: amp,
      update(params, { at }) {
        const depth = Math.min(1, Math.max(0, params.depth ?? 0.6))
        // The base sits at whatever the swing does not use, so the peak stays at unity and the
        // effect never makes the signal louder than it arrived — only quieter, rhythmically.
        amp.gain.setTargetAtTime(1 - depth / 2, at, RAMP)
        swing.gain.setTargetAtTime(depth / 2, at, RAMP)
        lfo.frequency.setTargetAtTime(Math.max(0.01, params.rate ?? 4), at, RAMP)
      },
      dispose() {
        lfo.stop()
        lfo.disconnect()
        swing.disconnect()
        amp.disconnect()
      },
    }
  },
}

/**
 * Ring modulation: the signal multiplied by an oscillator, which is what a gain node does when its
 * gain is driven at audio rate. Cheap, and unmistakable — it replaces the pitch you played with
 * the sum and difference of two.
 */
const ring: EffectDescriptor = {
  kind: 'ring',
  label: 'Ring mod',
  params: ['cutoff'],
  // The carrier frequency, which the cutoff field already covers with the right range and a log
  // slider to set it on.
  labels: { cutoff: 'Freq' },
  releaseTime: 0.02,
  create(ctx) {
    const multiplier = ctx.createGain()
    // Zero, so the carrier alone decides the output. A gain left at 1 would pass the dry signal
    // through underneath and turn the effect into a blend.
    multiplier.gain.value = 0

    const carrier = ctx.createOscillator()
    carrier.type = 'sine'
    carrier.connect(multiplier.gain)
    carrier.start()

    return {
      input: multiplier,
      output: multiplier,
      update(params, { at }) {
        const hz = Math.min(MAX_CUTOFF, Math.max(MIN_CUTOFF, params.cutoff ?? 400))
        carrier.frequency.setTargetAtTime(hz, at, RAMP)
      },
      dispose() {
        carrier.stop()
        carrier.disconnect()
        multiplier.disconnect()
      },
    }
  },
}

/** How far behind the left channel the right can be pushed. Past this it stops being width. */
const MAX_WIDTH_SECONDS = 0.02

/**
 * Position and width. Everything else in the project arrives dead centre, so this is the effect
 * that opens the image up.
 *
 * Width is a few milliseconds of delay on the right channel only. The ear reads a gap that small
 * as space rather than as a repeat — the Haas effect — which is how one mono voice becomes wide.
 */
const pan: EffectDescriptor = {
  kind: 'pan',
  label: 'Pan',
  params: ['pan', 'width'],
  releaseTime: 0.02,
  create(ctx) {
    const input = ctx.createGain()
    const left = ctx.createDelay(MAX_WIDTH_SECONDS)
    const right = ctx.createDelay(MAX_WIDTH_SECONDS)
    const merger = ctx.createChannelMerger(2)
    const panner = ctx.createStereoPanner()

    input.connect(left)
    input.connect(right)
    left.connect(merger, 0, 0)
    right.connect(merger, 0, 1)
    merger.connect(panner)

    return {
      input,
      output: panner,
      update(params, { at }) {
        panner.pan.setTargetAtTime(Math.min(1, Math.max(-1, params.pan ?? 0)), at, RAMP)
        const spread = Math.min(1, Math.max(0, params.width ?? 0)) * MAX_WIDTH_SECONDS
        right.delayTime.setTargetAtTime(spread, at, RAMP)
      },
      dispose() {
        input.disconnect()
        left.disconnect()
        right.disconnect()
        merger.disconnect()
        panner.disconnect()
      },
    }
  },
}

export const EFFECTS: EffectDescriptor[] = [
  reverb,
  echo,
  distortion,
  crush,
  filter,
  chorus,
  phaser,
  tremolo,
  ring,
  pan,
]

const byKind = new Map(EFFECTS.map((e) => [e.kind, e]))

export function getEffect(kind: EffectKind): EffectDescriptor | undefined {
  return byKind.get(kind)
}

/** Falls back rather than throwing: a patch may name an effect this build does not have yet. */
export function effectOr(kind: EffectKind): EffectDescriptor {
  return byKind.get(kind) ?? reverb
}
