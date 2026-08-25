/**
 * The envelope follower. See `follow` in `dsp.ts` for what it does and why the two speeds differ.
 *
 * Runs in `AudioWorkletGlobalScope`: no DOM, no app, and no imports at runtime — the bundler inlines
 * whatever this file imports into one standalone script. Which is the point: the arithmetic stays an
 * ordinary function with ordinary tests, and this is only the plumbing around it.
 *
 * **Why it cannot be native.** `|x|` is a `WaveShaperNode` and smoothing is a low-pass, so a follower with
 * *one* speed needs no worklet at all. Two speeds needs to know whether the signal is rising, which is a
 * comparison against the value it last put out — and that is memory, which is what a worklet is for. One
 * speed would track the average of a branch rather than its shape, and the shape is the whole feature.
 */

import { follow, followCoefficient, followState, type FollowState } from '../dsp'
import { FOLLOW, WORKLET_PARAMS } from './names'

class Follow extends AudioWorkletProcessor {
  // Declared in `names.ts`, which is the one place both this and the test stub for `AudioWorkletNode`
  // can read. See there for why they are k-rate.
  static get parameterDescriptors() {
    return WORKLET_PARAMS[FOLLOW]
  }

  /**
   * One per channel, and then summed on the way out.
   *
   * A follower's output is a *control* signal, and a control signal has no stereo image — something
   * pointed at a filter cutoff wants one number, not two. Following each channel separately and then
   * taking the louder of the two is what a detector does: a note panned hard to one side still ducks the
   * pad, where averaging would let it through at half strength.
   */
  private states: FollowState[] = []

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0]
    const output = outputs[0]
    if (!output || output.length === 0) return true

    const up = followCoefficient(parameters.attack[0] ?? 5, sampleRate)
    const down = followCoefficient(parameters.release[0] ?? 200, sampleRate)
    const gain = parameters.sensitivity[0] ?? 1

    /*
     * Nothing coming in still has to be followed, so the level falls to nothing at the release time rather
     * than stopping where it was. A branch that goes quiet has to *release* the thing it was holding — a
     * follower that froze on silence would leave a filter shut for ever.
     */
    const width = output[0].length
    const silence = new Float32Array(width)
    const perChannel: Float32Array[] = []
    const channels = Math.max(1, input?.length ?? 1)

    for (let channel = 0; channel < channels; channel++) {
      this.states[channel] ??= followState()
      const from = input?.[channel] ?? silence
      const into = new Float32Array(width)
      follow(from, into, up, down, gain, this.states[channel])
      perChannel.push(into)
    }

    // The louder side, sample by sample, written to every output channel so it can be connected to
    // anything without caring how wide it is.
    for (let i = 0; i < width; i++) {
      let most = 0
      for (const one of perChannel) most = Math.max(most, one[i])
      for (const out of output) out[i] = most
    }

    return true
  }
}

registerProcessor(FOLLOW, Follow)
