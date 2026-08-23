import { describe, expect, it } from 'vitest'
import { AudioEngine, type NoteRequest } from './engine'
import { fakeAudio, type FakeAudio } from './fakeAudio'
import { MAX_VIBRATO, amountFor, targetsFor } from './modulation'
import type { ModParams } from '../types/patch'

/**
 * A MOD reaching an oscillator's pitch, which is vibrato.
 *
 * The one destination the modulation graph never had, and the reason the instrument read as missing
 * something basic: a synthesiser without vibrato is a synthesiser you notice the lack of before you
 * notice anything it does have.
 *
 * It needed no new machinery. The per-voice path already existed for the filter, and `detune` turned out
 * to be entirely free — an oscillator's *static* detune control is folded into the frequency the voice is
 * asked for, and glide ramps `frequency` — so a vibrato owns that parameter outright and composes with
 * both by construction rather than by care.
 */

const LFO: ModParams = { kind: 'lfo', wave: 'sine', rate: 5, depth: 0.5, target: 'pitch' }

function note(over: Partial<NoteRequest> = {}): NoteRequest {
  return {
    nodeId: 'o',
    time: 1,
    freq: 440,
    waveform: 'square',
    pulseWidth: 0.5,
    duration: 1,
    gain: 0.5,
    attack: 5,
    decay: 0,
    release: 50,
    glide: 0,
    velocity: 1,
    filterType: 'off',
    cutoff: 1000,
    resonance: 2,
    ...over,
  }
}

/** Plays one note under a modulator and answers what reached the source's detune. */
function drivingDetune(mod: ModParams, over: Partial<NoteRequest> = {}): number {
  return detuneDrivers(mod, over).length
}

/** The same, but handing back the drivers themselves, so their depth can be read off them. */
function detuneDrivers(
  mod: ModParams,
  over: Partial<NoteRequest> = {},
): Array<{ gain: { value: number } }> {
  const fake: FakeAudio = fakeAudio()
  const engine = new AudioEngine()
  engine.adopt(fake.ctx)
  engine.createModulator('m', mod)
  engine.connectMod('m', 'o', mod.target ?? 'pitch', mod.depth ?? 0.5)
  engine.playNote(note(over))
  return fake.drivers('detune') as Array<{ gain: { value: number } }>
}

const OSC_PITCH = targetsFor('osc').find((one) => one.key === 'pitch')!

describe('pitch as a modulation destination', () => {
  it('is offered on an oscillator at all', () => {
    expect(targetsFor('osc').map((target) => target.key)).toContain('pitch')
  })

  it('connects the modulator to a voice as it is built', () => {
    // The per-voice path: a note played after the cable exists arrives already wired.
    expect(drivingDetune(LFO)).toBeGreaterThan(0)
  })

  it('reaches a voice with no filter, unlike the filter targets', () => {
    /*
     * Worth its own check because the code it replaced began `if (!voice.filter) return`. Pitch is the
     * first per-voice destination that is not on the filter, so a voice with the filter switched off used
     * to have nowhere for a per-voice cable to land — and would have silently ignored one.
     */
    expect(drivingDetune(LFO, { filterType: 'off' })).toBeGreaterThan(0)
  })

  it('reaches a noise voice too, where it shifts the grain', () => {
    /*
     * A noise waveform is a buffer rather than an oscillator, and both carry `detune`. On a buffer it
     * moves the playback rate, which is a texture rather than a note — a real change, so there is no
     * reason to refuse it, and the panel says what it does instead of promising a pitch.
     */
    expect(drivingDetune(LFO, { waveform: 'pink' })).toBeGreaterThan(0)
  })

  it('does not touch detune when the cable points somewhere else', () => {
    // Or the checks above would pass on a voice that wires everything to everything.
    const elsewhere: ModParams = { ...LFO, target: 'level' }
    expect(drivingDetune(elsewhere)).toBe(0)
  })

  it('bends by a semitone at full depth and proportionally under it', () => {
    /*
     * Depth is a share of the target's own span, so the same control means the same thing here as on a
     * cutoff. A semitone either way at the top is wide on purpose: a tenth is ten cents, which is the
     * shimmer most patches want, and a narrower span would put every useful setting in the first sliver.
     */
    const target = targetsFor('osc').find((one) => one.key === 'pitch')!
    expect(amountFor(target, 1)).toBeCloseTo(MAX_VIBRATO, 6)
    expect(amountFor(target, 0.1)).toBeCloseTo(MAX_VIBRATO / 10, 6)
  })

  it('bends by that much *in the engine*, and not only in the table', () => {
    /*
     * The check above asks the parameter table and gets the right answer. The engine asked something else
     * — `targetOf(key)` with no node type, which answered from the effect parameters — and for as long as
     * no name meant two things the two agreed and nobody could tell. Then a comb resonator arrived with a
     * `pitch` of its own, twelve semitones wide against the vibrato's hundred cents, and since depth is a
     * *share* of the span every vibrato in the instrument silently became eight times too small.
     *
     * Nothing threw, nothing looked wrong, and the whole suite stayed green — because every test about
     * vibrato asked the table. So this one asks the gain the engine actually set.
     */
    const [driver] = detuneDrivers({ ...LFO, depth: 1 })
    expect(driver.gain.value).toBeCloseTo(MAX_VIBRATO, 4)

    const [half] = detuneDrivers({ ...LFO, depth: 0.5 })
    expect(half.gain.value).toBeCloseTo(amountFor(OSC_PITCH, 0.5), 4)
  })

  it('is symmetrical about the note, rather than only bending upward', () => {
    // A vibrato that only ever went sharp would be heard as an out-of-tune note, not as a vibrato.
    const target = targetsFor('osc').find((one) => one.key === 'pitch')!
    expect(target.min).toBe(-target.max)
  })

  it('is built per voice, which is what makes a per-note envelope possible on it', () => {
    // A pitch envelope per note is a whole percussive sound — the drop at the front of a kick — and it
    // needs the same `perVoice` flag the filter has, not a shared shape every voice reads together.
    const target = targetsFor('osc').find((one) => one.key === 'pitch')!
    expect(target.perVoice).toBe(true)
  })
})
