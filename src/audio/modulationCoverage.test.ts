import { beforeEach, describe, expect, it } from 'vitest'
import { AudioEngine, type NoteRequest } from './engine'
import { EFFECTS, effectOr } from './effects'
import { fakeAudio, type FakeAudio } from './fakeAudio'
import { amountFor, targetOf, targetsFor } from './modulation'
import type { EffectKind, FxParams, ModParams } from '../types/patch'

/**
 * Every parameter a MOD offers, on every effect, and on an oscillator — checked one target at a time.
 *
 * This exists because offering a target and reaching it are two different pieces of knowledge. The
 * list comes from the effect's own parameters; reaching one means either an `AudioParam` the chain
 * hands over by name, or a recomputation the engine drives. A parameter can appear in the list and go
 * nowhere, and from the outside that looks like a broken cable rather than a gap — which is exactly
 * how the echo's Width was found.
 *
 * The two ways a target is reached need two different questions asked of them:
 *
 * - **Connected**, where the modulator's signal runs into an `AudioParam`. The question is whether the
 *   parameter has a new driver, which the fake records.
 * - **Recomputed**, where the engine writes a new value every tick because the thing being modulated
 *   rebuilds a buffer or a curve. There is no connection to look at, so the question is whether the
 *   effect keeps changing once the clock moves — and keeps still when nothing is modulating it.
 */

/** Names the fake gives the parameters, where a target can be pinned to one exactly. */
const BY_NAME: Record<string, string> = {
  cutoff: 'frequency',
  resonance: 'Q',
  rate: 'oscFrequency',
  time: 'delayTime',
  pan: 'pan',
}

/**
 * Effects where a name means something other than the usual thing.
 *
 * A ring modulator's Freq borrows the cutoff field for its range and its log slider, but what it sets
 * is the carrier — an oscillator, not a filter.
 */
const ELSEWHERE: Record<string, Record<string, string>> = {
  ring: { cutoff: 'oscFrequency' },
  /*
   * The resonator borrows three fields and none of them is what the name usually means. Its Damping is
   * the low-pass inside the feedback loop rather than a filter after the effect, its Ring is a feedback
   * amount solved for a time rather than an impulse response, and its Pitch is a delay length. All three
   * are parameters on the worklet, so all three are named by what the processor calls them.
   */
  comb: { cutoff: 'damping', decay: 'ring', pitch: 'note' },
}

const nameOf = (kind: EffectKind, key: string): string | undefined =>
  ELSEWHERE[kind]?.[key] ?? BY_NAME[key]

const paramsFor = (kind: EffectKind): FxParams =>
  ({ effect: kind, mix: 0.8, ...effectOr(kind).defaults }) as FxParams

const LFO: ModParams = { kind: 'lfo', wave: 'sine', rate: 2, depth: 0.7 }

let fake: FakeAudio
let engine: AudioEngine

beforeEach(() => {
  fake = fakeAudio()
  engine = new AudioEngine()
  engine.adopt(fake.ctx)
})

/**
 * Moves the audio clock on and steps the recomputed modulations, which is what a render does.
 *
 * An adopted engine starts no timer of its own: whoever adopted the context owns the clock, and a
 * wall-clock timer there would fire against a clock that is not the one producing the audio. So this
 * drives it the same way `renderPatch` does, one step at a time.
 */
function tick(seconds = 0.12): void {
  fake.advance(seconds)
  engine.advanceValueModulation()
}

function note(nodeId: string, over: Partial<NoteRequest> = {}): NoteRequest {
  return {
    nodeId,
    time: fake.ctx.currentTime,
    freq: 440,
    waveform: 'sine',
    pulseWidth: 0.5,
    duration: 0.5,
    gain: 0.8,
    attack: 5,
    decay: 0,
    glide: 0,
    velocity: 1,
    release: 50,
    filterType: 'lowpass',
    cutoff: 1200,
    resonance: 4,
    ...over,
  }
}

describe('every parameter of every effect', () => {
  for (const descriptor of EFFECTS) {
    describe(descriptor.kind, () => {
      for (const target of targetsFor('fx', descriptor.kind)) {
        it(`is modulated through its ${target.key}`, () => {
          engine.createEffect('fx', paramsFor(descriptor.kind), 120)
          engine.createModulator('mod', LFO)

          if (target.via === 'audio') {
            const named = nameOf(descriptor.kind, target.key)
            const before = named ? fake.drivers(named).length : fake.wires()

            engine.connectMod('mod', 'fx', target.key, 0.7)

            const after = named ? fake.drivers(named).length : fake.wires()
            expect(after).toBeGreaterThan(before)
            return
          }

          // Recomputed. Nothing is connected, so what is checked is that the value keeps moving while
          // the cable is there — and, first, that it sits still while it is not, or a passing test
          // would only mean the effect was noisy.
          const quiet = fake.journal.length
          tick()
          expect(fake.journal.length).toBe(quiet)

          engine.connectMod('mod', 'fx', target.key, 0.7)
          const before = fake.journal.length
          tick()
          expect(fake.journal.length).toBeGreaterThan(before)
        })
      }

      it('lets go of every one of them again', () => {
        // A parameter left with a modulator attached keeps whatever offset it was holding, so pulling
        // the cable has to be as complete as making it.
        engine.createEffect('fx', paramsFor(descriptor.kind), 120)
        engine.createModulator('mod', LFO)
        let expected = fake.wires()

        for (const target of targetsFor('fx', descriptor.kind)) {
          engine.connectMod('mod', 'fx', target.key, 0.7)
          engine.disconnectMod('mod', 'fx')

          // A mix leaves its inverter attached to the dry gain, and that is deliberate: it is cached
          // per node so that wiring a mix twice cannot stack inverters, and with nothing coming into
          // it, it adds nothing to the parameter it is still attached to. So the count it is measured
          // against moves once, there, and stays where it moved to.
          if (target.key === 'mix') expected += 1
          expect(fake.wires()).toBe(expected)
        }

        // And the driver stops with the last of them, rather than running on for nothing.
        const settled = fake.journal.length
        tick()
        expect(fake.journal.length).toBe(settled)
      })
    })
  }
})

describe("an oscillator's filter", () => {
  it('is driven on the note that is already sounding', () => {
    engine.createModulator('mod', LFO)
    engine.playNote(note('osc'))
    const before = fake.drivers('frequency').length

    engine.connectMod('mod', 'osc', 'cutoff', 0.6)
    expect(fake.drivers('frequency').length).toBe(before + 1)
  })

  it('is driven on every note after the cable, not only the first', () => {
    engine.createModulator('mod', LFO)
    engine.connectMod('mod', 'osc', 'cutoff', 0.6)

    const before = fake.drivers('frequency').length
    for (let i = 0; i < 3; i++) {
      fake.advance(0.1)
      engine.playNote(note('osc'))
    }
    // One per note: each voice builds its own biquad, which is the point of a per-voice filter.
    expect(fake.drivers('frequency').length).toBe(before + 3)
  })

  it('drives resonance separately from cutoff', () => {
    engine.createModulator('mod', LFO)
    engine.connectMod('mod', 'osc', 'resonance', 0.6)
    engine.playNote(note('osc'))

    expect(fake.drivers('Q')).toHaveLength(1)
    expect(fake.drivers('frequency')).toHaveLength(0)
  })

  it('carries a depth in the target’s own units', () => {
    // The reason each link gets its own gain: one depth means thousands of hertz on a cutoff and a
    // number under twenty on a Q, so a shared gain would be wrong for one of them.
    engine.createModulator('sweep', LFO)
    engine.createModulator('peak', LFO)
    engine.connectMod('sweep', 'osc', 'cutoff', 0.5)
    engine.connectMod('peak', 'osc', 'resonance', 0.5)
    engine.playNote(note('osc'))

    const [onCutoff] = fake.drivers('frequency') as Array<{ gain: { value: number } }>
    const [onQ] = fake.drivers('Q') as Array<{ gain: { value: number } }>
    expect(onCutoff.gain.value).toBeCloseTo(amountFor(targetOf('cutoff', 'osc')!, 0.5), 3)
    expect(onQ.gain.value).toBeCloseTo(amountFor(targetOf('resonance', 'osc')!, 0.5), 3)
    expect(onCutoff.gain.value).toBeGreaterThan(onQ.gain.value * 10)
  })

  it('does nothing at all to a voice with its filter off', () => {
    engine.createModulator('mod', LFO)
    engine.connectMod('mod', 'osc', 'cutoff', 0.6)
    engine.playNote(note('osc', { filterType: 'off' }))

    // No filter to sweep, and nothing thrown for trying: the panel says the filter has to be on.
    expect(fake.drivers('frequency')).toHaveLength(0)
  })

  it('leaves nothing behind when the note ends', () => {
    engine.createModulator('mod', LFO)
    engine.connectMod('mod', 'osc', 'cutoff', 0.6)
    engine.playNote(note('osc'))
    expect(fake.drivers('frequency')).toHaveLength(1)

    fake.endAll()
    expect(fake.drivers('frequency')).toHaveLength(0)
  })

  it('lets go of a sounding note when the cable is pulled', () => {
    engine.createModulator('mod', LFO)
    engine.connectMod('mod', 'osc', 'cutoff', 0.6)
    engine.playNote(note('osc'))

    engine.disconnectMod('mod', 'osc')
    expect(fake.drivers('frequency')).toHaveLength(0)
  })

  it('lets go when the modulator itself is deleted', () => {
    engine.createModulator('mod', LFO)
    engine.connectMod('mod', 'osc', 'cutoff', 0.6)
    engine.playNote(note('osc'))

    engine.disposeModulator('mod')
    expect(fake.drivers('frequency')).toHaveLength(0)
  })

  it('still modulates its level, which is a bus rather than a voice', () => {
    // The other half of what an oscillator offers, and reached the ordinary way.
    engine.createModulator('mod', LFO)
    const before = fake.wires()
    engine.connectMod('mod', 'osc', 'level', 0.6)
    expect(fake.wires()).toBeGreaterThan(before)
  })
})

describe('a modulated mix', () => {
  it('drives the dry side as well as the wet one', () => {
    engine.createEffect('fx', paramsFor('reverb'), 120)
    engine.createModulator('mod', LFO)
    engine.connectMod('mod', 'fx', 'mix', 0.7)

    // The dry half moves against the wet half through a gain of -1, and Web Audio has no negative
    // connection, so the modulation has to pass *through* that gain. Driving the gain's own value
    // instead leaves its input silent — and silence times anything is silence, which is how this was
    // wired at first: the wet side swept and the dry side sat still.
    const inverters = (
      fake.drivers('gain') as Array<{ gain: { value: number }; incoming: unknown[] }>
    ).filter((driver) => driver.gain?.value === -1)

    expect(inverters).toHaveLength(1)
    expect(inverters[0].incoming.length).toBeGreaterThan(0)
  })
})

describe('a deleted modulator', () => {
  it('stops driving what it was recomputing', () => {
    // This leaked: deleting a MOD let go of its connections but not of its recomputed ones, so the
    // parameter stayed wherever the sweep had left it and the driver kept running.
    engine.createEffect('fx', paramsFor('reverb'), 120)
    engine.createModulator('mod', LFO)
    engine.connectMod('mod', 'fx', 'decay', 0.7)
    tick()

    engine.disposeModulator('mod')
    const settled = fake.journal.length
    tick()
    tick()
    expect(fake.journal.length).toBe(settled)
  })
})

describe('a disposed engine', () => {
  it('lets go of a recomputed modulation, timer and all', () => {
    // A render builds a whole engine per export and used to throw it away without this, leaving a
    // twenty-times-a-second driver calling a context that had finished rendering. One per export.
    engine.createEffect('fx', paramsFor('reverb'), 120)
    engine.createModulator('mod', LFO)
    engine.connectMod('mod', 'fx', 'decay', 0.7)
    expect(engine.hasValueModulation()).toBe(true)

    engine.dispose()
    expect(engine.hasValueModulation()).toBe(false)

    const settled = fake.journal.length
    tick()
    expect(fake.journal.length).toBe(settled)
  })

  it('lets go of a connected modulation too', () => {
    engine.createEffect('fx', paramsFor('filter'), 120)
    engine.createModulator('mod', LFO)
    engine.connectMod('mod', 'fx', 'cutoff', 0.7)
    expect(fake.wires()).toBeGreaterThan(0)

    engine.dispose()
    expect(fake.wires()).toBe(0)
  })

  it('lets go of a sounding voice', () => {
    engine.createModulator('mod', LFO)
    engine.connectMod('mod', 'osc', 'cutoff', 0.6)
    engine.playNote(note('osc'))
    expect(fake.drivers('frequency')).toHaveLength(1)

    engine.dispose()
    expect(fake.drivers('frequency')).toHaveLength(0)
  })
})

describe('a recomputed modulation on audio time', () => {
  /** Where a swept decay lands after stepping the clock the way a render steps it. */
  function sweep(steps: number): number[] {
    const local = fakeAudio()
    const rendering = new AudioEngine()
    rendering.adopt(local.ctx)
    rendering.createEffect('fx', paramsFor('reverb'), 120)
    rendering.createModulator('mod', LFO)
    rendering.connectMod('mod', 'fx', 'decay', 0.8)

    const seen: number[] = []
    for (let i = 0; i < steps; i++) {
      local.advance(0.05)
      rendering.advanceValueModulation()
      seen.push(local.journal.length)
    }
    rendering.dispose()
    return seen
  }

  it('follows the same path every time, which is what an export needs', () => {
    // The reason this had to move off the wall clock: an offline render produces a minute of audio in
    // about a second, so a 50 ms timer fired once or twice per render at whatever moment it landed on.
    // Two exports of the same patch did not match, and neither contained much of its own modulation.
    expect(sweep(40)).toEqual(sweep(40))
  })

  it('actually moves, rather than settling after the first step', () => {
    const path = sweep(40)
    expect(path.at(-1)!).toBeGreaterThan(path[0])
  })
})
