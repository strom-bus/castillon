/**
 * The octave divider. See `octaveDown` in `dsp.ts` for what it does and why it needs a worklet.
 *
 * Runs in `AudioWorkletGlobalScope`: no DOM, no app, and no imports at runtime — the bundler inlines
 * whatever this file imports into one standalone script. Which is the point: the arithmetic stays an
 * ordinary function with ordinary tests, and this is only the plumbing around it.
 */

import { octaveDown, octaveState, type OctaveState } from '../dsp'
import { OCTAVE } from './names'

class Octave extends AudioWorkletProcessor {
  /** One per channel: two sides tracking together would lock the image to the middle. */
  private states: OctaveState[] = []

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0]
    const output = outputs[0]
    // Nothing connected yet, or silence. Staying alive rather than returning false: a processor that
    // ends cannot be restarted, and this one is built before anything sounds through it.
    if (!input || input.length === 0) return true

    for (let channel = 0; channel < output.length; channel++) {
      const from = input[channel] ?? input[0]
      if (!from) continue
      this.states[channel] ??= octaveState()
      octaveDown(from, output[channel], this.states[channel])
    }

    return true
  }
}

registerProcessor(OCTAVE, Octave)
