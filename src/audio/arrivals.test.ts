import { beforeEach, describe, expect, it } from 'vitest'
import { defaultOscParams, defaultHoldParams } from '../nodes/registry'
import type { NodeId, Patch, PatchEdge, PatchNode, HoldParams } from '../types/patch'
import { ActivityBus } from '../viz/activity'
import type { Engine, NoteRequest } from './engine'
import { CascadeScheduler } from './scheduler'

/**
 * A HOLD counting the triggers that reach it rather than the passes of the cascade.
 *
 * The arithmetic is the same function either way — `hold.test.ts` owns that. What is at stake here is
 * *which number* it is handed, and the two only come apart in the places this instrument is unusual:
 * under an oscillator sending on every step, and inside a loop. So every test here is the same patch
 * twice, changing nothing but what is counted, and asserting the two disagree.
 *
 * That last case is the reason the node exists in this form. A node that waited for all of its parents
 * cannot be built in a graph that permits cycles — a parent hanging below the waiter only ever fires
 * after it, so the wait never ends and neither does the pass. Counting is defined everywhere and cannot
 * deadlock, which is a weaker promise and a keepable one.
 */

class FakeEngine implements Engine {
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

let engine: FakeEngine

function edge(source: string, target: string): PatchEdge {
  return { id: `${source}->${target}`, kind: 'event', source, target }
}

function build(patch: Patch) {
  engine = new FakeEngine()
  const activity = new ActivityBus(() => 0)
  activity.push = () => {}
  return new CascadeScheduler({ engine, activity, getPatch: () => patch })
}

/** A step lasts 0.25 s at 120 BPM on a 1/8 division, which is what every count below is read against. */
const STEP = 0.25

function hold(id: NodeId, params: Partial<HoldParams>): PatchNode {
  return {
    id,
    type: 'hold',
    position: { x: 0, y: 0 },
    params: { ...defaultHoldParams(), ...params },
  }
}

/** An oscillator of `count` steps, handing its branch one trigger per step. */
function sender(id: NodeId, count: number): PatchNode {
  return {
    id,
    type: 'osc',
    position: { x: 0, y: 0 },
    params: {
      ...defaultOscParams(),
      propagateMode: 'onStep',
      steps: Array.from({ length: count }, (_, i) => ({
        note: 60 + i,
        active: true,
        velocity: 1,
      })),
    },
  }
}

/** A single-step oscillator, so one note stands for one trigger that got through. */
function voice(id: NodeId): PatchNode {
  return {
    id,
    type: 'osc',
    position: { x: 0, y: 0 },
    params: { ...defaultOscParams(), steps: [{ note: 72, active: true, velocity: 1 }] },
  }
}

/**
 * Runs a sender of `steps` steps over a hold, and reports which arrivals got through.
 *
 * As step numbers counted from one across the whole run, so a pattern that restarts every pass and one
 * that carries on are different lists rather than the same one read twice.
 */
function through(steps: number, params: Partial<HoldParams>, seconds: number): number[] {
  const patch: Patch = {
    version: 1,
    bpm: 120,
    loop: true,
    nodes: [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
      sender('top', steps),
      hold('g', params),
      voice('v'),
    ],
    edges: [edge('s', 'top'), edge('top', 'g'), edge('g', 'v')],
  }
  const scheduler = build(patch)
  scheduler.start()
  scheduler.drain(seconds)
  scheduler.stop()

  const first = engine.notes.find((note) => note.nodeId === 'top')!.time
  return engine.notes
    .filter((note) => note.nodeId === 'v')
    .map((note) => Math.round((note.time - first) / STEP) + 1)
}

beforeEach(() => {
  engine = new FakeEngine()
})

describe('a hold counting the triggers that reach it', () => {
  it('divides the steps, where counting passes divides the passes', () => {
    /*
     * The whole point, said as one comparison. Four steps handing a branch four triggers a pass: counting
     * passes takes all four or none, because every trigger in a pass carries the same lap. Counting
     * arrivals takes every other one, which is a rhythm the instrument could not otherwise make.
     */
    const byPass = through(4, { every: 2, offset: 1, counts: 'passes' }, 2)
    const byTrigger = through(4, { every: 2, offset: 1, counts: 'triggers' }, 2)

    expect(byPass).toEqual([1, 2, 3, 4])
    expect(byTrigger).toEqual([1, 3, 5, 7])
  })

  it('carries the count across the pass boundary instead of starting over', () => {
    /*
     * A divider does not begin again every bar, and there is no bar here to begin again at. An odd number
     * of steps a pass is what makes the two readings distinguishable at all: carrying on gives 1, 3, 5,
     * 7, whose middle two are the *second* step of the second pass and the first of the third, where
     * starting over each pass would give 1, 3, 4, 6, 7 — the same count of notes and a different rhythm.
     */
    const taken = through(3, { every: 2, offset: 1, counts: 'triggers' }, 2)
    expect(taken).toEqual([1, 3, 5, 7])
    expect(taken).not.toEqual([1, 3, 4, 6, 7])
  })

  it('is the same as counting passes where a pass brings one trigger', () => {
    // Which is what makes it safe to offer at all: in a plain chain the setting is not a choice, so
    // nobody has to understand it before they can use a HOLD.
    const byPass = through(1, { every: 3, offset: 2, counts: 'passes' }, 4)
    const byTrigger = through(1, { every: 3, offset: 2, counts: 'triggers' }, 4)
    expect(byTrigger).toEqual(byPass)
    expect(byTrigger.length).toBeGreaterThan(1)
  })

  it('takes the run it is given rather than every third of everything', () => {
    // Guards the pair of numbers being read at all: a longer run has to thin the stream further.
    const half = through(4, { every: 2, offset: 1, counts: 'triggers' }, 2)
    const quarter = through(4, { every: 4, offset: 1, counts: 'triggers' }, 2)
    expect(quarter).toEqual([1, 5])
    expect(quarter.length).toBeLessThan(half.length)
  })

  it('counts again from the start when the transport does', () => {
    /*
     * Pressing Play has to give the same patch twice. The count is kept per node and outlives a pass on
     * purpose, so the one thing that must clear it is the only moment a listener would hear the seam.
     *
     * On **one** scheduler, stopped and started: a fresh one each time has an empty map whatever the
     * code does, which is a test that cannot fail and therefore is not one. It was written that way
     * first, and deleting the clear left it green.
     */
    const patch: Patch = {
      version: 1,
      bpm: 120,
      loop: true,
      nodes: [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
        sender('top', 3),
        // A run of three rather than two, because a play consuming an even number of triggers would
        // leave a carried-over count on the same parity and the second play would agree by luck.
        // Deleting the clear left exactly that test green.
        hold('g', { every: 3, offset: 1, counts: 'triggers' }),
        voice('v'),
      ],
      edges: [edge('s', 'top'), edge('top', 'g'), edge('g', 'v')],
    }
    const scheduler = build(patch)

    const play = () => {
      const before = engine.notes.length
      scheduler.start()
      scheduler.drain(2)
      scheduler.stop()
      const notes = engine.notes.slice(before)
      const first = notes.find((note) => note.nodeId === 'top')!.time
      return notes
        .filter((note) => note.nodeId === 'v')
        .map((note) => Math.round((note.time - first) / STEP) + 1)
    }

    const once = play()
    const again = play()
    expect(once).toEqual([1, 4, 7])
    expect(again).toEqual(once)
  })

  it('counts again from the start when the patch is edited under it', () => {
    /*
     * An edit rebuilds every chain, so the pass count goes back to one; this has to go back with it or
     * the two disagree about how far along the piece is, and a HOLD would answer differently after a
     * change that had nothing to do with it.
     */
    const patch: Patch = {
      version: 1,
      bpm: 120,
      loop: true,
      nodes: [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
        sender('top', 3),
        hold('g', { every: 3, offset: 1, counts: 'triggers' }),
        voice('v'),
      ],
      edges: [edge('s', 'top'), edge('top', 'g'), edge('g', 'v')],
    }
    const scheduler = build(patch)
    scheduler.start()
    scheduler.drain(2)

    const before = engine.notes.length
    scheduler.restart()
    scheduler.drain(2)
    scheduler.stop()

    const notes = engine.notes.slice(before)
    const first = notes.find((note) => note.nodeId === 'top')!.time
    const after = notes
      .filter((note) => note.nodeId === 'v')
      .map((note) => Math.round((note.time - first) / STEP) + 1)
    expect(after).toEqual([1, 4, 7])
  })
})

describe('a hold inside a loop, where a pass has stopped meaning anything', () => {
  /**
   * A cycle: the hold feeds an oscillator that feeds it back. The cascade cuts at `MAX_DEPTH`, so the
   * node is reached many times in one pass and `lap` is the same number for every one of them.
   */
  function cycled(params: Partial<HoldParams>): number {
    const patch: Patch = {
      version: 1,
      bpm: 120,
      loop: false,
      nodes: [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
        hold('g', params),
        voice('v'),
      ],
      edges: [edge('s', 'g'), edge('g', 'v'), edge('v', 'g')],
    }
    const scheduler = build(patch)
    scheduler.start()
    scheduler.drain(20)
    scheduler.stop()
    return engine.notes.filter((note) => note.nodeId === 'v').length
  }

  it('thins the loop, which counting passes cannot do', () => {
    /*
     * Every arrival inside one pass carries the same lap, so a hold counting passes is all-or-nothing
     * in a cycle: it either lets the loop run to the depth cap or stops it dead. Counting arrivals is a
     * real division of it — which is the difference between a setting that works in a loop and one that
     * happens not to crash there.
     */
    const all = cycled({ counts: 'passes' })
    const byPass = cycled({ every: 2, offset: 1, counts: 'passes' })
    const byTrigger = cycled({ every: 2, offset: 1, counts: 'triggers' })

    expect(all).toBeGreaterThan(4)
    // The pass the loop starts on is the hold's own, so counting passes changes nothing whatever.
    expect(byPass).toBe(all)
    expect(byTrigger).toBeLessThan(all)
    expect(byTrigger).toBeGreaterThan(0)
  })

  it('still ends, because counting waits for nothing', () => {
    // The failure a JOIN would have had. A node that counts can be starved of triggers but never held
    // by one, so the pass ends on the depth cap exactly as it does without a hold in the loop.
    expect(cycled({ every: 3, offset: 1, counts: 'triggers' })).toBeGreaterThan(0)
    expect(cycled({ every: 3, offset: 1, counts: 'triggers' })).toBeLessThan(20)
  })
})
