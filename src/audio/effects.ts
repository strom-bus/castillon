import type { EffectKind, FxParams } from '../types/patch'

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
  /** Which parameters the inspector shows. The node, inspector and codec all read this. */
  params: readonly (keyof FxParams)[]
  /** Seconds the node's output is faded over before disposal, for effects with a tail. */
  releaseTime: number
  create(ctx: AudioContext): EffectChain
}

/** Every effect gets `level`; these are the ones on top of it. */
const gain: EffectDescriptor = {
  kind: 'gain',
  label: 'Gain',
  params: [],
  releaseTime: 0.02,
  create(ctx) {
    // A pass-through. `gain` is nothing but the node's own level control, which makes it exactly
    // the right thing to prove the routing path on: if it works, the path works.
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

export const EFFECTS: EffectDescriptor[] = [gain]

const byKind = new Map(EFFECTS.map((e) => [e.kind, e]))

export function getEffect(kind: EffectKind): EffectDescriptor | undefined {
  return byKind.get(kind)
}

/** Falls back rather than throwing: a patch may name an effect this build does not have yet. */
export function effectOr(kind: EffectKind): EffectDescriptor {
  return byKind.get(kind) ?? gain
}
