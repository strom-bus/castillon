import { describe, expect, it } from 'vitest'
import { defaultOscParams, stepAt } from '../nodes/registry'
import { DIRECTIONS, type Patch, type PatchNode } from '../types/patch'
import { ActivityBus } from '../viz/activity'
import { CascadeScheduler } from './scheduler'
import type { Engine, NoteRequest } from './engine'

/**
 * Which way an oscillator reads its steps.
 *
 * The one thing worth being careful about here is what does **not** reverse. A sequence played backwards
 * is a phrase played backwards — the notes come in the other order and the groove stays where it was. If
 * the timing reversed with them, a swung sequence would run its groove backwards too, which is a
 * different feature and one nobody asked for. So the tests below check the notes moved and the *slots*
 * did not, which are two assertions about the same run.
 */

class Recorder implements Engine {
  notes: NoteRequest[] = []
  now() {
    return 0
  }
  chance() {
    return 0
  }
  playNote(req: NoteRequest) {
    this.notes.push(req)
  }
  voiceLoadAt() {
    return 0
  }
  effectLoad() {
    return 0
  }
  nodeBusyUntil() {
    return 0
  }
  releaseNodeVoices() {}
  restartLfo() {}
  fireEnvelope() {}
}

/** Four steps whose notes say where they came from. */
const NOTES = [60, 62, 64, 65]

function patchOf(over: Partial<ReturnType<typeof defaultOscParams>>): Patch {
  const nodes: PatchNode[] = [
    { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
    {
      id: 'o',
      type: 'osc',
      position: { x: 0, y: 0 },
      params: {
        ...defaultOscParams(),
        steps: NOTES.map((note) => ({ note, active: true, velocity: 1 })),
        ...over,
      },
    },
  ]
  return {
    version: 1,
    bpm: 120,
    loop: true,
    nodes,
    edges: [{ id: 's->o', kind: 'event', source: 's', target: 'o' }],
  }
}

/** Plays `seconds` of a patch and hands back the notes, in the order they were scheduled. */
function played(over: Partial<ReturnType<typeof defaultOscParams>>, seconds = 2) {
  const engine = new Recorder()
  const activity = new ActivityBus(() => 0)
  activity.push = () => {}
  const scheduler = new CascadeScheduler({ engine, activity, getPatch: () => patchOf(over) })
  scheduler.start()
  scheduler.drain(seconds)
  scheduler.stop()
  return engine.notes
}

const notesOf = (over: Partial<ReturnType<typeof defaultOscParams>>, seconds = 2) =>
  played(over, seconds).map((note) => Math.round(note.freq ?? 0))

/** MIDI note to the frequency the engine will have asked for, so the two can be compared. */
const freqOf = (note: number) => Math.round(440 * Math.pow(2, (note - 69) / 12))

describe('stepAt', () => {
  it('is the identity going forward', () => {
    for (let i = 0; i < 4; i++) expect(stepAt(i, 4, 'forward', 1)).toBe(i)
    // And on every pass, since forward has no memory of which time round it is.
    for (const lap of [1, 2, 7]) expect(stepAt(2, 4, 'forward', lap)).toBe(2)
  })

  it('turns the run round going back, on every pass alike', () => {
    expect([0, 1, 2, 3].map((i) => stepAt(i, 4, 'reverse', 1))).toEqual([3, 2, 1, 0])
    expect([0, 1, 2, 3].map((i) => stepAt(i, 4, 'reverse', 4))).toEqual([3, 2, 1, 0])
  })

  it('alternates by pass when it ping-pongs, starting outward', () => {
    // Counting from one, so the first pass is the forward one — a sequence that began by running
    // backwards would be a reverse that took two passes to say so.
    expect([0, 1, 2, 3].map((i) => stepAt(i, 4, 'pingpong', 1))).toEqual([0, 1, 2, 3])
    expect([0, 1, 2, 3].map((i) => stepAt(i, 4, 'pingpong', 2))).toEqual([3, 2, 1, 0])
    expect([0, 1, 2, 3].map((i) => stepAt(i, 4, 'pingpong', 3))).toEqual([0, 1, 2, 3])
  })

  it('answers something in range for a pass count that cannot be', () => {
    // A lap of nought or below arrives from nowhere today, and the modulo keeps its sign in JavaScript —
    // which is the same trap the SIEVE's arithmetic has to take twice.
    for (const lap of [0, -1, -6]) {
      const answer = stepAt(1, 4, 'pingpong', lap)
      expect(answer).toBeGreaterThanOrEqual(0)
      expect(answer).toBeLessThan(4)
    }
    expect(stepAt(0, 0, 'reverse', 1)).toBe(0)
  })

  it('covers every direction the type offers', () => {
    // So a fourth one cannot be added and quietly fall through to forward.
    for (const direction of DIRECTIONS) {
      const seen = [0, 1, 2, 3].map((i) => stepAt(i, 4, direction, 2))
      expect([...seen].sort(), direction).toEqual([0, 1, 2, 3])
    }
  })
})

describe('an oscillator reading its steps', () => {
  it('plays them in order going forward', () => {
    expect(notesOf({ direction: 'forward' }, 1)).toEqual(NOTES.map(freqOf))
  })

  it('plays them backwards going back, and keeps doing so', () => {
    const back = [...NOTES].reverse().map(freqOf)
    expect(notesOf({ direction: 'reverse' }, 2)).toEqual([...back, ...back])
  })

  it('turns round on the second pass when it ping-pongs', () => {
    /*
     * The endpoints repeat — 1 2 3 4 then 4 3 2 1 — because a pass is one whole traversal and there is
     * nowhere inside it to change direction. Asserted rather than worked around, since it is the audible
     * consequence of how the scheduler commits a sequence.
     */
    expect(notesOf({ direction: 'pingpong' }, 2)).toEqual([
      ...NOTES.map(freqOf),
      ...[...NOTES].reverse().map(freqOf),
    ])
  })

  it('leaves the timing exactly where it was, which is the whole point', () => {
    /*
     * The assertion this file exists for. Reversing the *content* must not move a single slot: same
     * count, same instants, same lengths. A version that reversed the times as well would pass every
     * test above and run the groove backwards.
     */
    const forward = played({ direction: 'forward' }, 2)
    const back = played({ direction: 'reverse' }, 2)
    expect(back).toHaveLength(forward.length)
    for (const [i, note] of back.entries()) {
      expect(note.time, `slot ${i}`).toBeCloseTo(forward[i].time, 9)
      expect(note.duration, `slot ${i}`).toBeCloseTo(forward[i].duration, 9)
    }
  })

  it('keeps a swung sequence swinging forward when it is reversed', () => {
    /*
     * The same claim where it actually bites. Swing makes alternate slots long and short; reversing the
     * notes must leave that pattern alone, or a backwards phrase arrives with a backwards groove.
     *
     * Asserted **absolutely** and not as forward-against-reverse. Comparing the two directions can only
     * see a difference *between* them, and the failure worth catching — the slot lengths being read in
     * the wrong order — happens to both directions at once. Written that way first, and reversing the
     * lengths left it green.
     */
    const swung = { swing: 2, useSwing: true } as const
    const forward = played({ ...swung, direction: 'forward' }, 2)
    const back = played({ ...swung, direction: 'reverse' }, 2)

    // The long half comes first, in both directions. That is what "the groove stays forward" means.
    expect(forward[0].duration).toBeGreaterThan(forward[1].duration)
    expect(back[0].duration).toBeGreaterThan(back[1].duration)
    // And the pattern alternates rather than the first note simply being longest.
    expect(back[2].duration).toBeCloseTo(back[0].duration, 9)
    expect(back[3].duration).toBeCloseTo(back[1].duration, 9)

    expect(back.map((n) => n.time)).toEqual(forward.map((n) => n.time))
    // And the swing is really there, or every comparison above is two straight sequences agreeing.
    const straight = played({ direction: 'forward' }, 2)
    expect(forward.map((n) => n.time)).not.toEqual(straight.map((n) => n.time))
  })

  it('lights the step it is playing, not the slot it is playing it in', () => {
    /*
     * What you want to see is the bar you are hearing, and on the way back those are not the same number.
     * A version that lit the slot would look right going forward and be wrong every time it reversed —
     * which is the sort of thing nobody notices until they are trying to read a patch.
     */
    const engine = new Recorder()
    const lit: { step: number; time: number }[] = []
    const activity = new ActivityBus(() => 0)
    activity.push = (event) => {
      if (event.kind === 'step' && event.id === 'o')
        lit.push({ step: event.step, time: event.time })
    }
    const scheduler = new CascadeScheduler({
      engine,
      activity,
      getPatch: () => patchOf({ direction: 'reverse' }),
    })
    scheduler.start()
    scheduler.drain(1)
    scheduler.stop()

    expect(lit.map((one) => one.step).slice(0, NOTES.length)).toEqual([3, 2, 1, 0])
    // And each lit bar lands on the note it belongs to, rather than merely being counted backwards.
    for (const [i, one] of lit.slice(0, NOTES.length).entries()) {
      expect(engine.notes[i].time, `slot ${i}`).toBeCloseTo(one.time, 9)
      expect(Math.round(engine.notes[i].freq ?? 0)).toBe(freqOf(NOTES[one.step]))
    }
  })

  it('carries each step’s own settings with it, not just its note', () => {
    /*
     * A step is a note *and* a velocity, a chance, a roll, a slide. Reversing only the note would leave
     * the first slot loud because the first step is loud, while playing the last step's pitch — which is
     * a sequence nobody wrote.
     */
    const steps = NOTES.map((note, i) => ({ note, active: true, velocity: i === 3 ? 0.25 : 1 }))
    const back = played({ steps, direction: 'reverse' }, 1)
    // The quiet step was last; played backwards it has to arrive first.
    expect(back[0].velocity).toBeCloseTo(0.25, 6)
    expect(back[3].velocity).toBeCloseTo(1, 6)
  })

  it('reverses a sequence of any length, including an odd one', () => {
    // Polymetry made odd counts ordinary, and an off-by-one in the mapping shows up on odd lengths first.
    for (const count of [1, 2, 3, 5]) {
      const notes = Array.from({ length: count }, (_, i) => 60 + i)
      const steps = notes.map((note) => ({ note, active: true, velocity: 1 }))
      const back = notesOf({ steps, direction: 'reverse' }, 0.9).slice(0, count)
      expect(back, `${count} steps`).toEqual([...notes].reverse().map(freqOf))
    }
  })
})
