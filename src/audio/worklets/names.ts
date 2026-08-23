/**
 * What both sides of a worklet need to agree on: the name it registers under, and the parameters it
 * declares.
 *
 * Its own module because the two sides cannot import each other — a processor runs in
 * `AudioWorkletGlobalScope`, which has no DOM and no app, so the bundler inlines whatever it imports
 * into a standalone file. A shared constant is inlined into both and cannot drift.
 *
 * The parameter descriptors live here rather than inside each processor for the same reason the node
 * registry holds its own ports: the test stub for `AudioWorkletNode` has to know which parameters a
 * processor has, and it used to hold a list of its own — one hard-coded `['hold']`, written when there
 * was one worklet, still saying so when there were three. A stub that disagrees with the thing it
 * stands in for makes the test around it answer a question about the stub.
 */

import { MAX_COMB_NOTE, MAX_REDUCTION, MIN_COMB_NOTE, MIN_REDUCTION } from '../dsp'
import { MAX_DECAY } from '../../types/patch'

export const DECIMATOR = 'castillon-decimator'
export const OCTAVE = 'castillon-octave'
export const COMB = 'castillon-comb'

/** One parameter of one processor, in the shape `parameterDescriptors` wants it. */
export interface WorkletParam {
  name: string
  defaultValue: number
  minValue: number
  maxValue: number
  automationRate: 'a-rate' | 'k-rate'
}

/**
 * Every processor's parameters, keyed by the name it registers under.
 *
 * All `k-rate` so far — one value per block of 128 samples rather than per sample. Every one of these
 * is a *setting* rather than a signal, a block is under three milliseconds, and a modulation cable
 * still reaches a k-rate parameter; it is simply read once a block.
 */
export const WORKLET_PARAMS: Record<string, WorkletParam[]> = {
  [DECIMATOR]: [
    // A hold count is not a smooth quantity — it is how many outputs one sample lasts.
    {
      name: 'hold',
      defaultValue: MIN_REDUCTION,
      minValue: MIN_REDUCTION,
      maxValue: MAX_REDUCTION,
      automationRate: 'k-rate',
    },
  ],
  // The divider has nothing to set: it follows the signal and that is the whole of it.
  [OCTAVE]: [],
  [COMB]: [
    {
      name: 'note',
      defaultValue: 57,
      minValue: MIN_COMB_NOTE,
      maxValue: MAX_COMB_NOTE,
      automationRate: 'k-rate',
    },
    { name: 'ring', defaultValue: 2, minValue: 0, maxValue: MAX_DECAY, automationRate: 'k-rate' },
    {
      name: 'damping',
      defaultValue: 4000,
      minValue: 20,
      // Above Nyquist on purpose: that is what "no damping at all" is, and the top of the control has to
      // be able to reach it. `combDamping` returns nothing rather than almost nothing there.
      maxValue: 96000,
      automationRate: 'k-rate',
    },
  ],
}
