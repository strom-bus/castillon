/**
 * A step's velocity as a modulation source (PLAN §18.14).
 *
 * It scaled the gain and nothing else, which made it very nearly a second name for level. What is useful
 * is the number itself: the same cable on a cutoff opening further for a hard step than for a soft one.
 *
 * It needs no new kind of modulator, which is the point. A MOD here is defined by its clock — an LFO keeps
 * its own rate, an envelope runs when something triggers it — and a per-note envelope already has the only
 * clock a velocity could use. So this is a property of that envelope rather than a third thing.
 */

import { describe, expect, it } from 'vitest'
import { AudioEngine, type NoteRequest } from './engine'
import { fakeAudio, type FakeAudio } from './fakeAudio'
import { defaultFxParams } from '../nodes/registry'
import type { ModParams } from '../types/patch'

const PER_NOTE: ModParams = {
  kind: 'env',
  fires: 'note',
  target: 'cutoff',
  depth: 0.8,
  attack: 5,
  decay: 200,
}

function note(over: Partial<NoteRequest> = {}): NoteRequest {
  return {
    nodeId: 'o',
    time: 1,
    freq: 440,
    waveform: 'square',
    pulseWidth: 0.5,
    duration: 1,
    /*
     * Silent on purpose, so the reading below cannot pick up the wrong gain.
     *
     * The stub journals every gain under one name, and a voice has two of them: its own amplitude and the
     * shape a per-note envelope draws. With the voice at nothing, any non-zero write belongs to the
     * envelope — and reading the voice's 0.5 as an envelope peak is exactly what this test did first.
     */
    gain: 0,
    attack: 5,
    decay: 0,
    release: 50,
    glide: 0,
    velocity: 1,
    filterType: 'lowpass',
    cutoff: 1000,
    resonance: 2,
    ...over,
  }
}

/** The peaks a per-note envelope drew on its voices, one per note played. */
function peaks(mod: ModParams, velocities: number[]): number[] {
  const fake: FakeAudio = fakeAudio()
  const engine = new AudioEngine()
  engine.adopt(fake.ctx)
  engine.createModulator('m', mod)
  engine.connectMod('m', 'o', 'cutoff', 0.8)

  return velocities.map((velocity) => {
    const before = fake.journal.length
    engine.playNote(note({ velocity }))
    // The per-voice shape is a gain drawn between zero and the peak, so the peak is the largest thing
    // written to it while this note was being built.
    const written = fake.journal
      .slice(before)
      .filter((write) => write.what === 'gain')
      .map((write) => write.value as number)
    return Math.max(0, ...written)
  })
}

describe('velocity on a per-note envelope', () => {
  it('is off unless asked for', () => {
    // So every patch made before this existed modulates exactly as deeply as it did.
    const [soft, hard] = peaks(PER_NOTE, [0.2, 1])
    expect(soft).toBeCloseTo(hard!, 9)
  })

  it('opens further for a hard step than for a soft one', () => {
    const [soft, hard] = peaks({ ...PER_NOTE, byVelocity: true }, [0.25, 1])
    expect(hard).toBeGreaterThan(soft!)
  })

  it('scales in proportion, so a quarter velocity is a quarter of the sweep', () => {
    // Pinned as arithmetic, since "more" would pass on any monotonic muddle.
    const [quarter, full] = peaks({ ...PER_NOTE, byVelocity: true }, [0.25, 1])
    expect(quarter! / full!).toBeCloseTo(0.25, 6)
  })

  it('reaches nothing at all at zero velocity', () => {
    const [silent] = peaks({ ...PER_NOTE, byVelocity: true }, [0])
    expect(silent).toBeCloseTo(0, 9)
  })
})

describe('what velocity cannot reach', () => {
  it('leaves an effect modulation alone, having no note to read', () => {
    /*
     * A cable onto an effect is one shared graph, not one per voice, so there is no note whose velocity it
     * could take. Honouring the flag there would mean the last note played quietly reshaping a modulation
     * that every voice hears — which is the kind of coupling this instrument goes out of its way to avoid.
     */
    const fake = fakeAudio()
    const engine = new AudioEngine()
    engine.adopt(fake.ctx)
    engine.createEffect('f', { ...defaultFxParams(), effect: 'filter' }, 120)
    engine.createModulator('m', { ...PER_NOTE, byVelocity: true })

    expect(() => engine.connectMod('m', 'f', 'cutoff', 0.8)).not.toThrow()
    // The shared depth is set from the cable, untouched by any note.
    expect(fake.params('gain').length).toBeGreaterThan(0)
  })
})
