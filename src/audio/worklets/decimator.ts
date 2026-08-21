/**
 * The sample-rate decimator, the half of the bitcrusher a `WaveShaperNode` cannot do.
 *
 * This file runs in `AudioWorkletGlobalScope` on the audio thread: no DOM, no `window`, and nothing of
 * the app. What it *can* do is import — the bundler inlines the import into a standalone file — which
 * is the whole reason to build it as an entry rather than ship a hand-written script. `decimate` stays
 * an ordinary function in `dsp.ts` with ordinary tests, and this is only the plumbing around it.
 */

import { decimate, decimateState, MAX_REDUCTION, MIN_REDUCTION, type DecimateState } from '../dsp'
import { DECIMATOR } from './names'

class Decimator extends AudioWorkletProcessor {
  /**
   * `k-rate`: one value per block of 128 samples rather than per sample.
   *
   * A hold count is not a smooth quantity — it is how many outputs one sample lasts — and a block is
   * under three milliseconds, so nothing audible is lost. It is far cheaper, and a modulation cable
   * still reaches it: connecting a signal to a k-rate parameter works, it is simply read once a block.
   */
  static get parameterDescriptors() {
    return [
      {
        name: 'hold',
        defaultValue: MIN_REDUCTION,
        minValue: MIN_REDUCTION,
        maxValue: MAX_REDUCTION,
        automationRate: 'k-rate' as const,
      },
    ]
  }

  /** One per channel: the two sides have to hold independently or the image collapses to the middle. */
  private states: DecimateState[] = []

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0]
    const output = outputs[0]
    // No input yet — the graph may be connected before anything sounds. Staying alive rather than
    // returning false, because a processor that ends cannot be restarted.
    if (!input || input.length === 0) return true

    const hold = parameters.hold[0] ?? MIN_REDUCTION

    for (let channel = 0; channel < output.length; channel++) {
      const from = input[channel] ?? input[0]
      if (!from) continue
      this.states[channel] ??= decimateState()
      decimate(from, output[channel], hold, this.states[channel])
    }

    return true
  }
}

registerProcessor(DECIMATOR, Decimator)
