/**
 * The stepped random shape (PLAN §18.13).
 *
 * Not a fifth waveform but a different behaviour. Every other shape is periodic, so until this existed
 * every modulation in the app was ultimately predictable — a wobble you could learn. That sits badly with
 * an instrument whose claim is that the cascade breathes rather than keeping a pulse, which is the same
 * reason we chose not to sync to a clock.
 */

import { describe, expect, it } from 'vitest'
import { AudioEngine } from './engine'
import { fakeAudio, type FakeAudio } from './fakeAudio'
import { LFO_SHAPES, LFO_SHAPE_LABELS } from './modulation'
import { defaultFxParams } from '../nodes/registry'
import type { ModParams } from '../types/patch'

const RANDOM: ModParams = { kind: 'lfo', wave: 'random', rate: 2, depth: 0.6, target: 'level' }
const SINE: ModParams = { kind: 'lfo', wave: 'sine', rate: 2, depth: 0.6, target: 'level' }

function engineOn(): { fake: FakeAudio; engine: AudioEngine } {
  const fake = fakeAudio()
  const engine = new AudioEngine()
  engine.adopt(fake.ctx)
  return { fake, engine }
}

describe('a random modulator', () => {
  it('is offered as a shape, with a name', () => {
    expect(LFO_SHAPES).toContain('random')
    expect(LFO_SHAPE_LABELS.random).toBeTruthy()
  })

  it('runs off a buffer rather than an oscillator', () => {
    // Which it has to: an oscillator has no setting that holds a value and then jumps.
    const { fake, engine } = engineOn()
    engine.createModulator('m', RANDOM)
    expect(fake.nodes('bufferSource')).toHaveLength(1)
    expect(fake.nodes('osc')).toHaveLength(0)
  })

  it('takes its rate on the playback rate, not on a frequency', () => {
    const { fake, engine } = engineOn()
    engine.createModulator('m', RANDOM)
    expect(fake.params('playbackRate')).toHaveLength(1)
    expect(fake.params('oscFrequency')).toHaveLength(0)
  })

  it('holds each value rather than sliding between them', () => {
    /*
     * The whole distinction. A buffer of single random samples played slowly would be interpolated into a
     * smooth wander — which is a shape that already exists in all but name. Each value has to occupy a run
     * of identical samples so that resampling has nothing to smooth except the one sample at each edge.
     */
    const { fake, engine } = engineOn()
    engine.createModulator('m', RANDOM)
    const data = (
      fake.nodes('bufferSource')[0]!.buffer as { getChannelData(c: number): Float32Array }
    ).getChannelData(0)

    // Measured as the shortest plateau, not as a count of changes. Counting changes cannot tell a held
    // value from a spike: writing one sample per step and leaving the rest at zero gives just as few
    // transitions, and passed this test until the shortest run was what it asked about.
    let shortest = Infinity
    let run = 1
    for (let i = 1; i < data.length; i++) {
      if (data[i] === data[i - 1]) run++
      else {
        shortest = Math.min(shortest, run)
        run = 1
      }
    }
    shortest = Math.min(shortest, run)

    expect(shortest).toBeGreaterThan(100)
  })

  it('swings both ways, like every other shape', () => {
    // A unipolar modulator could only ever push a parameter one way, which is an offset, not a modulation.
    const { fake, engine } = engineOn()
    engine.createModulator('m', RANDOM)
    const data = (
      fake.nodes('bufferSource')[0]!.buffer as { getChannelData(c: number): Float32Array }
    ).getChannelData(0)
    // Walked rather than spread: a few hundred thousand samples through Math.min overflows the stack,
    // which reads as a failing assertion about the audio and is nothing of the kind.
    let low = Infinity
    let high = -Infinity
    for (const value of data) {
      low = Math.min(low, value)
      high = Math.max(high, value)
    }
    expect(low).toBeLessThan(0)
    expect(high).toBeGreaterThan(0)
  })

  it('shares one buffer between all of them', () => {
    // Sixty-four steps at a hundred milliseconds each is megabytes if every modulator owns a copy.
    const { fake, engine } = engineOn()
    engine.createModulator('a', RANDOM)
    engine.createModulator('b', RANDOM)
    const buffers = fake.nodes('bufferSource').map((node) => node.buffer)
    expect(buffers).toHaveLength(2)
    expect(buffers[0]).toBe(buffers[1])
  })
})

describe('changing a live modulator shape', () => {
  it('keeps the cable when it crosses between random and periodic', () => {
    /*
     * The failure this was written against. The two shapes cannot be the same node, so the switch needs
     * new hardware, and rebuilding the modulator is the obvious way to get it — which would silently cut
     * the cable, since disposing a modulator releases every link it holds. Only the source is replaced,
     * and every link hangs off the depth gain, so nothing downstream notices.
     */
    for (const [from, to] of [
      [SINE, RANDOM],
      [RANDOM, SINE],
    ]) {
      const { fake, engine } = engineOn()
      engine.createModulator('m', from!)
      engine.createEffect('f', { ...defaultFxParams(), effect: 'filter' }, 120)
      engine.connectMod('m', 'f', 'cutoff', 0.5)

      const wired = fake.wires()
      expect(wired).toBeGreaterThan(0)

      engine.updateModulator('m', to!)
      expect(fake.wires()).toBe(wired)
    }
  })

  it('gets the node the shape needs after the switch', () => {
    const { fake, engine } = engineOn()
    engine.createModulator('m', SINE)
    expect(fake.nodes('bufferSource')).toHaveLength(0)

    engine.updateModulator('m', RANDOM)
    expect(fake.nodes('bufferSource')).toHaveLength(1)
  })

  it('builds nothing new when the shape stays on one side', () => {
    // Two periodic shapes are the same oscillator with a different type, and swapping hardware for that
    // would drop the phase for no reason.
    const { fake, engine } = engineOn()
    engine.createModulator('m', SINE)
    const before = fake.nodes('osc').length
    engine.updateModulator('m', { ...SINE, wave: 'square' })
    expect(fake.nodes('osc')).toHaveLength(before)
  })
})
