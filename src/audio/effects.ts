import type { EffectKind, FxParams } from '../types/patch'
import { crushCurve, depthToBits, driveCurve, impulseResponse } from './dsp'

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
  update(params: FxParams, at: number): void
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

const gain: EffectDescriptor = {
  kind: 'gain',
  label: 'Gain',
  params: [],
  releaseTime: 0.02,
  create(ctx) {
    // A pass-through: `gain` is nothing but the node's own Mix, which makes it the right thing to
    // have proven the routing on.
    const node = ctx.createGain()
    node.gain.value = 1
    return {
      input: node,
      output: node,
      update() {},
      dispose() {
        node.disconnect()
      },
    }
  },
}

const reverb: EffectDescriptor = {
  kind: 'reverb',
  label: 'Reverb',
  params: ['decay'],
  // Long enough that removing the node lets the tail out rather than cutting it off.
  releaseTime: 0.4,
  create(ctx) {
    const convolver = ctx.createConvolver()
    let built = -1

    return {
      input: convolver,
      output: convolver,
      update(params) {
        // Rebuilding the impulse response allocates, so it only happens when the decay has moved
        // enough to hear. Without this, dragging the slider would rebuild it per frame.
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
      },
    }
  },
}

const drive: EffectDescriptor = {
  kind: 'drive',
  label: 'Drive',
  params: ['drive'],
  releaseTime: 0.02,
  create(ctx) {
    const shaper = ctx.createWaveShaper()
    // Distortion folds harmonics above Nyquist back down as aliasing; oversampling is what keeps
    // that from sounding like grit that was never played.
    shaper.oversample = '4x'
    let built = -1

    return {
      input: shaper,
      output: shaper,
      update(params) {
        const amount = Math.round(params.drive * 100) / 100
        if (amount === built) return
        built = amount
        shaper.curve = driveCurve(amount)
      },
      dispose() {
        shaper.disconnect()
      },
    }
  },
}

const crush: EffectDescriptor = {
  kind: 'crush',
  label: 'Bitcrusher',
  params: ['depth'],
  releaseTime: 0.02,
  create(ctx) {
    const shaper = ctx.createWaveShaper()
    // Deliberately not oversampled: the aliasing is the sound.
    shaper.oversample = 'none'
    let built = -1

    return {
      input: shaper,
      output: shaper,
      update(params) {
        const bits = depthToBits(params.depth)
        if (bits === built) return
        built = bits
        shaper.curve = crushCurve(bits)
      },
      dispose() {
        shaper.disconnect()
      },
    }
  },
}

export const EFFECTS: EffectDescriptor[] = [gain, reverb, drive, crush]

const byKind = new Map(EFFECTS.map((e) => [e.kind, e]))

export function getEffect(kind: EffectKind): EffectDescriptor | undefined {
  return byKind.get(kind)
}

/** Falls back rather than throwing: a patch may name an effect this build does not have yet. */
export function effectOr(kind: EffectKind): EffectDescriptor {
  return byKind.get(kind) ?? gain
}
