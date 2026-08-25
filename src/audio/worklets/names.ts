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

import {
  MAX_COMB_NOTE,
  MAX_FOLLOW_MS,
  MAX_SENSITIVITY,
  MIN_FOLLOW_MS,
  MAX_REDUCTION,
  MAX_REPEATS,
  MAX_SLICE_SECONDS,
  MIN_COMB_NOTE,
  MIN_REDUCTION,
  MIN_REPEATS,
} from '../dsp'
import { MAX_DECAY } from '../../types/patch'

export const DECIMATOR = 'castillon-decimator'
export const OCTAVE = 'castillon-octave'
export const COMB = 'castillon-comb'
export const STUTTER = 'castillon-stutter'
export const FOLLOW = 'castillon-follow'

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
  [FOLLOW]: [
    // Milliseconds, both of them, which is what every compressor in the world calls these.
    {
      name: 'attack',
      defaultValue: 5,
      minValue: MIN_FOLLOW_MS,
      maxValue: MAX_FOLLOW_MS,
      automationRate: 'k-rate',
    },
    {
      name: 'release',
      defaultValue: 200,
      minValue: MIN_FOLLOW_MS,
      maxValue: MAX_FOLLOW_MS,
      automationRate: 'k-rate',
    },
    // How much of the input becomes control signal, applied *before* the smoothing — see `follow`.
    {
      name: 'sensitivity',
      defaultValue: 1,
      minValue: 0,
      maxValue: MAX_SENSITIVITY,
      automationRate: 'k-rate',
    },
  ],
  [STUTTER]: [
    // The slice in *seconds*, not in beats: a processor has no idea what the tempo is, and the one place
    // that does is the main thread, which computes it from the division and hands it over.
    {
      name: 'slice',
      defaultValue: 0.25,
      minValue: 0.001,
      maxValue: MAX_SLICE_SECONDS,
      automationRate: 'k-rate',
    },
    /*
     * How many times each slice is played before the next is taken. One is a wire.
     *
     * Which is also the effect's on-and-off: a MOD on this *is* the momentary switch, and a slow shape on
     * it is a stutter that comes and goes — so there is no need for a control that only says whether the
     * effect is doing anything.
     */
    {
      name: 'repeats',
      defaultValue: MIN_REPEATS,
      minValue: MIN_REPEATS,
      maxValue: MAX_REPEATS,
      automationRate: 'k-rate',
    },
  ],
}
