import { describe, expect, it } from 'vitest'
import { AudioEngine, type NoteRequest } from './engine'
import { fakeAudio, type FakeAudio } from './fakeAudio'
import { amountFor, targetOf, targetsFrom } from './modulation'
import { MAX_PULSE_WIDTH, MIN_PULSE_WIDTH } from './waveforms'

/**
 * Sweeping the width of a pulse, which is the one waveform parameter that could not move.
 *
 * A pulse here is a `PeriodicWave` with the duty baked into its harmonics when the note starts, and a
 * baked wave is a wave you cannot sweep — so the width could only ever change *between* notes. An
 * oscillator whose width is being modulated builds something else entirely: a sawtooth against a delayed
 * copy of itself, where the delay **is** the duty and is an `AudioParam`.
 *
 * Two things are worth this much care. The delay has to be `duty / frequency` and has to *stay* that
 * through a slide, or the duty walks across the note. And the swept voice must be built **only** when
 * something is sweeping it, or every pulse voice in every patch pays three nodes for a feature it is not
 * using.
 */

const note = (over: Partial<NoteRequest> = {}): NoteRequest => ({
  nodeId: 'o',
  time: 1,
  freq: 200,
  waveform: 'pulse',
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
})

/** An engine on a fake context, with a MOD wired to the oscillator's width where asked for. */
function playing(over: Partial<NoteRequest> = {}, swept = true) {
  const fake: FakeAudio = fakeAudio()
  const engine = new AudioEngine()
  engine.adopt(fake.ctx)
  if (swept) {
    engine.createModulator('m', { kind: 'lfo', wave: 'sine', rate: 2, target: 'width', depth: 0.5 })
    engine.connectMod('m', 'o', 'width', 0.5)
  }
  engine.playNote(note(over))
  return { fake, engine }
}

describe('a pulse whose width is being swept', () => {
  it('is built out of a delay, where an unswept one is not', () => {
    // The whole difference, and the reason it is conditional: three nodes per voice is a cost paid by
    // every pulse in every patch, for something almost none of them are doing.
    expect(playing({}, true).fake.nodes('delay')).toHaveLength(1)
    expect(playing({}, false).fake.nodes('delay')).toHaveLength(0)
  })

  it('sets the delay to one duty cycle of this note', () => {
    // `d = duty / f`, which is what makes the two ramps cancel everywhere but in the window between
    // them. Get this wrong and the duty is whatever the arithmetic happened to produce.
    const { fake } = playing({ freq: 200, pulseWidth: 0.25 })
    const delay = fake.params('delayTime')[0]!
    expect(delay.value).toBeCloseTo(0.25 / 200, 10)
  })

  it('clamps a duty the patch should not have been able to ask for', () => {
    expect(fakeDuty(playing({ pulseWidth: 3 }))).toBeCloseTo(MAX_PULSE_WIDTH / 200, 10)
    expect(fakeDuty(playing({ pulseWidth: -1 }))).toBeCloseTo(MIN_PULSE_WIDTH / 200, 10)
  })

  it('keeps the duty constant through a slide', () => {
    /*
     * The delay has to ramp the other way as the pitch ramps, or a note that slides an octave comes out
     * with half the duty it started with. Exponentially, and that is exact rather than close: the
     * reciprocal of an exponential ramp is an exponential ramp, so the same curve the pitch takes holds
     * the duty still the whole way down it.
     */
    const fake: FakeAudio = fakeAudio()
    const engine = new AudioEngine()
    engine.adopt(fake.ctx)
    engine.createModulator('m', { kind: 'lfo', target: 'width', depth: 0.5 })
    engine.connectMod('m', 'o', 'width', 0.5)

    // Two notes, so the second has somewhere to slide from.
    engine.playNote(note({ freq: 100 }))
    engine.playNote(note({ freq: 200, time: 2, glide: 50 }))

    const written = fake.journal.filter((one) => one.what === 'delayTime')
    const ramp = written.find((one) => one.how === 'exponential')
    expect(ramp, 'the delay never ramped, so a slide walks the duty').toBeTruthy()
    // From one duty cycle at the old pitch to one at the new one.
    expect(ramp!.value).toBeCloseTo(0.5 / 200, 10)
    expect(written.some((one) => one.how === 'set' && one.value === 0.5 / 100)).toBe(true)
  })

  it('inverts one of the two copies, or nothing cancels', () => {
    // Saw *minus* delayed saw. Added instead, what comes out is a louder sawtooth and no pulse at all.
    const { fake } = playing()
    const gains = fake.nodes('gain').map((one) => (one.gain as { value: number }).value)
    expect(gains).toContain(-1)
  })

  it('costs what the target says a swept voice costs, filter or no filter', () => {
    /*
     * The accounting this uncovered: the per-voice surcharge used to be charged only on a voice with its
     * filter on, which was right when the only per-voice targets were the filter's own. A width sweep —
     * and a vibrato, which had the same hole — costs three nodes whatever the filter is doing.
     */
    const width = targetOf('width', 'osc')!
    expect(width.surcharge).toBeGreaterThan(0)

    const plain = playing({}, false)
    const swept = playing({}, true)
    expect(swept.engine.voiceLoadAt(1.2)).toBeCloseTo(
      plain.engine.voiceLoadAt(1.2) + width.surcharge,
      6,
    )
  })

  it('reaches the delay through a gain scaled to this note', () => {
    /*
     * A duty is a share of a cycle and a delay is in seconds, so the modulation has to be divided by the
     * frequency on its way in — the one target whose units are not the parameter's. Built per voice,
     * because every note has a different frequency to divide by.
     */
    const { fake } = playing({ freq: 400 })
    const width = targetOf('width', 'osc')!
    const scale = fake
      .drivers('delayTime')
      .map((one) => (one as { gain?: { value: number } }).gain?.value)
    expect(scale).toContain(1 / 400)

    // And the amount before it is the depth against the target's own span, as everywhere else.
    const amounts = fake.nodes('gain').map((one) => (one.gain as { value: number }).value)
    expect(amounts).toContain(amountFor(width, 0.5))
  })

  it('is offered to a MOD and to a follower, both of which can drive it', () => {
    // It is an `AudioParam`, so unlike the parameters that rebuild something, a SENSE can reach it too.
    expect(targetsFrom('mod', 'osc').map((one) => one.key)).toContain('width')
    expect(targetsFrom('sense', 'osc').map((one) => one.key)).toContain('width')
  })
})

/** The delay time standing on the one delay a swept voice builds. */
function fakeDuty({ fake }: { fake: FakeAudio }): number {
  return fake.params('delayTime')[0]!.value
}
