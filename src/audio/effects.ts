import type { EffectKind, FxParams } from '../types/patch'
import { stepDuration } from './clock'
import { crushCurve, depthToBits, driveCurve, impulseResponse } from './dsp'
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

const drive: EffectDescriptor = {
  kind: 'drive',
  label: 'Drive',
  params: ['drive', 'cutoff'],
  releaseTime: 0.02,
  create(ctx) {
    const shaper = ctx.createWaveShaper()
    // Distortion folds harmonics above Nyquist back down as aliasing; oversampling is what keeps
    // that from sounding like grit nobody played.
    shaper.oversample = '4x'
    const post = tone(ctx)
    shaper.connect(post)
    let built = -1

    return {
      input: shaper,
      output: post,
      update(params, { at }) {
        setTone(post, params, at)
        const amount = Math.round(params.drive * 100) / 100
        if (amount === built) return
        built = amount
        shaper.curve = driveCurve(amount)
      },
      dispose() {
        shaper.disconnect()
        post.disconnect()
      },
    }
  },
}

const crush: EffectDescriptor = {
  kind: 'crush',
  label: 'Bitcrusher',
  params: ['depth', 'cutoff'],
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
        const bits = depthToBits(params.depth)
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

export const EFFECTS: EffectDescriptor[] = [reverb, echo, drive, crush]

const byKind = new Map(EFFECTS.map((e) => [e.kind, e]))

export function getEffect(kind: EffectKind): EffectDescriptor | undefined {
  return byKind.get(kind)
}

/** Falls back rather than throwing: a patch may name an effect this build does not have yet. */
export function effectOr(kind: EffectKind): EffectDescriptor {
  return byKind.get(kind) ?? reverb
}
