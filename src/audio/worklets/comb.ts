/**
 * The comb resonator. See `comb` in `dsp.ts` for what it does and why it needs a worklet.
 *
 * Runs in `AudioWorkletGlobalScope`: no DOM, no app, and no imports at runtime — the bundler inlines
 * whatever this file imports into one standalone script. Which is the point: the arithmetic stays an
 * ordinary function with ordinary tests, and this is only the plumbing around it.
 */

import { comb, combDamping, combFeedback, combState, type CombState } from '../dsp'
import { COMB, WORKLET_PARAMS } from './names'

/** MIDI note to hertz, which is the one piece of arithmetic that has to happen on this side. */
function hzOf(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

class Comb extends AudioWorkletProcessor {
  // Declared in `names.ts`, which is the one place both this and the test stub for `AudioWorkletNode`
  // can read. See there for why they are all k-rate.
  static get parameterDescriptors() {
    return WORKLET_PARAMS[COMB]
  }

  /**
   * One resonator per channel.
   *
   * Two sides sharing a delay line would sum to mono the moment anything rang, and a resonator is the
   * one effect where that is not a subtlety: the whole tail would collapse to the middle.
   */
  private states: CombState[] = []

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0]
    const output = outputs[0]
    /*
     * A resonator is the one effect here that must keep running with nothing coming in. It is what a
     * tail *is*: the input stopped and the sound has not. Every other worklet returns early on silence
     * and loses nothing; this one would cut its own ring off.
     */
    if (!output || output.length === 0) return true

    const note = parameters.note[0] ?? 45
    const hz = hzOf(note)
    const delay = sampleRate / hz
    const feedback = combFeedback(hz, parameters.ring[0] ?? 1)
    const damping = combDamping(parameters.damping[0] ?? 4000, sampleRate)

    for (let channel = 0; channel < output.length; channel++) {
      this.states[channel] ??= combState(sampleRate)
      // Silence rather than nothing when the input has gone away, so the loop keeps turning over what is
      // already in it.
      const from = input?.[channel] ?? input?.[0] ?? new Float32Array(output[channel].length)
      comb(from, output[channel], delay, feedback, damping, this.states[channel])
    }

    return true
  }
}

registerProcessor(COMB, Comb)
