/**
 * Sliding from one step's pitch into the next (PLAN §18.11).
 *
 * Per oscillator, because in a cascade a step list belongs to one oscillator and the slide is between
 * *its* consecutive notes. It also does something here a keyboard cannot ask for: the cascade retriggers
 * the same oscillator over and over, so a glide turns a list of steps into one continuous line instead of
 * a run of separate events.
 */

import { describe, expect, it } from 'vitest'
import { AudioEngine, glideSeconds, type NoteRequest } from './engine'
import { fakeAudio } from './fakeAudio'

/** What the stub journals an oscillator's frequency under. */
const FREQ = 'oscFrequency'
const A4 = 440
const A5 = 880

function note(over: Partial<NoteRequest> = {}): NoteRequest {
  return {
    nodeId: 'o',
    time: 1,
    freq: A4,
    waveform: 'square',
    pulseWidth: 0.5,
    duration: 1,
    gain: 0.5,
    attack: 10,
    decay: 0,
    release: 100,
    glide: 0,
    velocity: 1,
    filterType: 'off',
    cutoff: 2000,
    resonance: 1,
    ...over,
  }
}

/** The pitches written for a run of notes, one array per note, in order. */
function pitches(what: string, notes: Array<Partial<NoteRequest>>): number[][] {
  const fake = fakeAudio()
  const engine = new AudioEngine()
  engine.adopt(fake.ctx)

  return notes.map((over) => {
    const before = fake.journal.length
    engine.playNote(note(over))
    return fake.journal
      .slice(before)
      .filter((write) => write.what === what)
      .map((write) => write.value as number)
  })
}

describe('a glide', () => {
  it('jumps straight to the pitch when it is off', () => {
    // The default, and what every patch made before glide existed still does.
    expect(pitches(FREQ, [{ freq: A4 }, { freq: A5 }])).toEqual([[A4], [A5]])
  })

  it('starts the second note at the first one pitch and travels', () => {
    const [first, second] = pitches(FREQ, [
      { freq: A4, glide: 200 },
      { freq: A5, glide: 200 },
    ])
    expect(first).toEqual([A4])
    expect(second).toEqual([A4, A5])
  })

  it('has nowhere to slide from on the very first note', () => {
    // So it must not invent one. A first note that arrives from an assumed pitch is a click.
    expect(pitches(FREQ, [{ freq: A5, glide: 200 }])).toEqual([[A5]])
  })

  it('does not slide between two notes at the same pitch', () => {
    // A ramp from a value to itself is not wrong so much as pointless, and Web Audio charges for it.
    expect(
      pitches(FREQ, [
        { freq: A4, glide: 200 },
        { freq: A4, glide: 200 },
      ])[1],
    ).toEqual([A4])
  })

  it('travels in ratios rather than in hertz', () => {
    /*
     * Pitch is heard as ratios, so a linear ramp through hertz covers the bottom of an octave quickly and
     * crawls through the top — heard as a slide that slows down as it arrives. Pinned by which automation
     * method was called, because both spell the same pair of values and only the path between differs.
     */
    const fake = fakeAudio()
    const engine = new AudioEngine()
    engine.adopt(fake.ctx)
    engine.playNote(note({ freq: A4, glide: 200 }))
    const before = fake.journal.length
    engine.playNote(note({ freq: A5, glide: 200 }))

    const written = fake.journal.slice(before).filter((write) => write.what === FREQ)
    expect(written.map((write) => write.how)).toEqual(['set', 'exponential'])
  })

  it('slides a noise buffer too, by its rate', () => {
    // The rate is what pitches a buffer, so the gesture is the same one. Ratios rather than hertz here.
    const [, second] = pitches('playbackRate', [
      { freq: A4, glide: 200, waveform: 'white' },
      { freq: A5, glide: 200, waveform: 'white' },
    ])
    expect(second).toHaveLength(2)
    expect(second[1] / second[0]).toBeCloseTo(2, 6)
  })

  it('keeps each node sliding from its own last note, not from another node one', () => {
    // Two oscillators interleaved is the normal case in a cascade, and one bleeding into the other would
    // be heard as pitches neither of them plays.
    const fake = fakeAudio()
    const engine = new AudioEngine()
    engine.adopt(fake.ctx)
    for (const req of [
      note({ nodeId: 'a', freq: A4, glide: 200 }),
      note({ nodeId: 'b', freq: 100, glide: 200 }),
      note({ nodeId: 'a', freq: A5, glide: 200 }),
    ]) {
      engine.playNote(req)
    }
    const written = fake.journal.filter((w) => w.what === FREQ).map((w) => w.value)
    // a: 440, b: 100, then a slides 440 → 880 rather than 100 → 880.
    expect(written).toEqual([A4, 100, A4, A5])
  })
})

describe('how long a slide gets', () => {
  it('is the time asked for, in seconds', () => {
    expect(glideSeconds(250, 1)).toBeCloseTo(0.25, 6)
  })

  it('never outlasts the note', () => {
    // Otherwise the slide never arrives and what is heard is a pitch still on its way somewhere.
    expect(glideSeconds(5000, 0.2)).toBeCloseTo(0.2, 6)
  })

  it('is nothing at all when asked for nothing, or for less', () => {
    expect(glideSeconds(0, 1)).toBe(0)
    expect(glideSeconds(-100, 1)).toBe(0)
  })
})
