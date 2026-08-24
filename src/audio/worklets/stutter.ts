/**
 * The beat-repeat. See `stutter` in `dsp.ts` for what it does and why it needs a worklet.
 *
 * Runs in `AudioWorkletGlobalScope`: no DOM, no app, and no imports at runtime — the bundler inlines
 * whatever this file imports into one standalone script. Which is the point: the arithmetic stays an
 * ordinary function with ordinary tests, and this is only the plumbing around it.
 */

import { stutter, stutterState, type StutterState } from '../dsp'
import { STUTTER, WORKLET_PARAMS } from './names'

class Stutter extends AudioWorkletProcessor {
  // Declared in `names.ts`, which is the one place both this and the test stub for `AudioWorkletNode`
  // can read. See there for why they are k-rate.
  static get parameterDescriptors() {
    return WORKLET_PARAMS[STUTTER]
  }

  /**
   * One buffer per channel.
   *
   * Two sides sharing a slice would collapse the repeats to the middle while the live passes stayed
   * wide, which is a stereo image that flickers rather than a stutter.
   */
  private states: StutterState[] = []

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0]
    const output = outputs[0]
    // Nothing connected yet, or silence. Staying alive rather than returning false: a processor that
    // ends cannot be restarted, and this one is built before anything sounds through it.
    if (!input || input.length === 0) return true

    const slice = (parameters.slice[0] ?? 0.25) * sampleRate
    const repeats = parameters.repeats[0] ?? 1

    for (let channel = 0; channel < output.length; channel++) {
      const from = input[channel] ?? input[0]
      if (!from) continue
      this.states[channel] ??= stutterState(sampleRate)
      stutter(from, output[channel], slice, repeats, this.states[channel])
    }

    return true
  }
}

registerProcessor(STUTTER, Stutter)
