import { beforeEach, describe, expect, it } from 'vitest'
import { defaultOscParams } from '../nodes/registry'
import {
  MAX_DELAY_MS,
  MAX_RATCHET,
  type NodeId,
  type OscParams,
  type Patch,
  type PatchEdge,
  type PatchNode,
  type Step,
} from '../types/patch'
import { ActivityBus, type ActivityEvent } from '../viz/activity'
import type { Engine, NoteRequest } from './engine'
import { MAX_LOAD } from './load'
import { CascadeScheduler, MAX_DEPTH } from './scheduler'

/** Fake engine: records what it is asked for without touching Web Audio. */
class FakeEngine implements Engine {
  envelopes: Array<{ nodeId: NodeId; at: number }> = []
  notes: NoteRequest[] = []
  released: { nodeId: NodeId; at: number }[] = []
  voices = 0
  effects = 0
  busy = new Map<NodeId, number>()

  now() {
    return 0
  }
  /** Fixed, so a test that leans on chance decides its own outcome rather than being surprised. */
  chanceValue = 0
  chance() {
    return this.chanceValue
  }

  playNote(req: NoteRequest) {
    this.notes.push(req)
  }
  /** The budget is in points now; the tests set it directly rather than through voice costs. */
  voiceLoadAt() {
    return this.voices
  }
  effectLoad() {
    return this.effects
  }
  nodeBusyUntil(nodeId: NodeId) {
    return this.busy.get(nodeId) ?? 0
  }
  releaseNodeVoices(nodeId: NodeId, at: number) {
    this.released.push({ nodeId, at })
  }

  /** Recorded rather than ignored: which envelope fired when is exactly what a MOD in a chain does. */
  fireEnvelope(nodeId: NodeId, at: number) {
    this.envelopes.push({ nodeId, at })
  }
}

function osc(id: string): PatchNode {
  return { id, type: 'osc', position: { x: 0, y: 0 }, params: defaultOscParams() }
}

function delayNode(id: string, delayMs: number): PatchNode {
  return { id, type: 'delay', position: { x: 0, y: 0 }, params: { delayMs } }
}

function edge(source: string, target: string): PatchEdge {
  return { id: `${source}->${target}`, kind: 'event', source, target }
}

function patchOf(nodes: PatchNode[], edges: PatchEdge[], loop = false): Patch {
  return { version: 1, bpm: 120, loop, nodes, edges }
}

let engine: FakeEngine
let activity: ActivityBus
let events: ActivityEvent[]

function build(patch: Patch) {
  engine = new FakeEngine()
  events = []
  activity = new ActivityBus(() => 0)
  activity.push = (e: ActivityEvent) => {
    events.push(e)
  }
  return new CascadeScheduler({ engine, activity, getPatch: () => patch })
}

beforeEach(() => {
  events = []
})

/** At 120 BPM with a 1/8 division a step lasts 0.25 s, and a 4-step sequence lasts 1 s. */
const STEP = 0.25
const SEQUENCE = STEP * 4

describe('CascadeScheduler', () => {
  it('cascades: the child starts when the parent finishes its sequence', () => {
    const patch = patchOf(
      [{ id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }, osc('a'), osc('b')],
      [edge('s', 'a'), edge('a', 'b')],
    )
    const scheduler = build(patch)
    scheduler.start()
    scheduler.drain(10)

    const first = engine.notes.filter((n) => n.nodeId === 'a').map((n) => n.time)
    const second = engine.notes.filter((n) => n.nodeId === 'b').map((n) => n.time)

    expect(first).toHaveLength(4)
    expect(second).toHaveLength(4)
    // B's first step lands exactly where A's sequence ends.
    expect(second[0] - first[0]).toBeCloseTo(SEQUENCE, 6)
    scheduler.stop()
  })

  it('branches: two children of the same node start together', () => {
    const patch = patchOf(
      [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
        osc('a'),
        osc('b'),
        osc('c'),
      ],
      [edge('s', 'a'), edge('a', 'b'), edge('a', 'c')],
    )
    const scheduler = build(patch)
    scheduler.start()
    scheduler.drain(10)

    const b = engine.notes.find((n) => n.nodeId === 'b')
    const c = engine.notes.find((n) => n.nodeId === 'c')
    expect(b).toBeDefined()
    expect(c).toBeDefined()
    expect(b!.time).toBeCloseTo(c!.time, 6)
    scheduler.stop()
  })

  it('honours the onStart propagation mode', () => {
    const a = osc('a')
    ;(a.params as ReturnType<typeof defaultOscParams>).propagateMode = 'onStart'
    const patch = patchOf(
      [{ id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }, a, osc('b')],
      [edge('s', 'a'), edge('a', 'b')],
    )
    const scheduler = build(patch)
    scheduler.start()
    scheduler.drain(10)

    const first = engine.notes.find((n) => n.nodeId === 'a')!
    const second = engine.notes.find((n) => n.nodeId === 'b')!
    expect(second.time).toBeCloseTo(first.time, 6)
    scheduler.stop()
  })

  it('cuts cycles at MAX_DEPTH instead of hanging', () => {
    const patch = patchOf(
      [{ id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }, osc('a'), osc('b')],
      [edge('s', 'a'), edge('a', 'b'), edge('b', 'a')],
    )
    const scheduler = build(patch)
    scheduler.start()
    scheduler.drain(1000)

    // Each node in the cycle schedules 4 notes per pass, and there are at most MAX_DEPTH passes.
    expect(engine.notes.length).toBeLessThanOrEqual((MAX_DEPTH + 1) * 4)
    expect(engine.notes.length).toBeGreaterThan(0)
    scheduler.stop()
  })

  it('relaunches the cascade once every branch has finished', () => {
    const patch = patchOf(
      [{ id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }, osc('a'), osc('b')],
      [edge('s', 'a'), edge('a', 'b')],
      true,
    )
    const scheduler = build(patch)
    scheduler.start()
    scheduler.drain(10)

    const aTimes = engine.notes
      .filter((n) => n.nodeId === 'a')
      .map((n) => n.time)
      .sort((x, y) => x - y)

    // Without loop there would only be 4 notes from A; with loop there are several passes.
    expect(aTimes.length).toBeGreaterThan(4)
    // A full pass lasts as long as the longest branch: A (1 s) + B (1 s).
    expect(aTimes[4] - aTimes[0]).toBeCloseTo(SEQUENCE * 2, 6)
    scheduler.stop()
  })

  it('the loop restart is decided ahead of the audio clock', () => {
    const patch = patchOf(
      [{ id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }, osc('a')],
      [edge('s', 'a')],
      true,
    )
    const scheduler = build(patch)
    scheduler.start()
    // The fake clock sits at 0; drain only the look-ahead horizon.
    scheduler.drain(0.1)

    // With the first pass scheduled, the next must already be queued though nothing has sounded.
    scheduler.drain(1.2)
    const times = engine.notes.map((n) => n.time).sort((x, y) => x - y)
    expect(times.length).toBeGreaterThan(4)
    scheduler.stop()
  })

  it('restarts a fast loop exactly when it ends, without padding it out', () => {
    // Four 1/16 steps at 300 BPM last 200 ms. A blanket quarter-second floor used to stretch
    // every loop shorter than that, which quietly slowed down fast patches.
    const a = osc('a')
    ;(a.params as ReturnType<typeof defaultOscParams>).division = '1/16'
    const patch: Patch = {
      version: 1,
      bpm: 300,
      loop: true,
      nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }, a],
      edges: [edge('s', 'a')],
    }
    const scheduler = build(patch)
    scheduler.start()
    scheduler.drain(4)

    const times = engine.notes.map((n) => n.time).sort((x, y) => x - y)
    expect(times.length).toBeGreaterThan(8)
    // One turn is exactly four steps of 50 ms, not the 250 ms the old floor forced.
    expect(times[4] - times[0]).toBeCloseTo(0.2, 6)
    scheduler.stop()
  })

  it('does not relaunch when loop is off', () => {
    const patch = patchOf(
      [{ id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }, osc('a')],
      [edge('s', 'a')],
      false,
    )
    const scheduler = build(patch)
    scheduler.start()
    scheduler.drain(100)
    expect(engine.notes).toHaveLength(4)
    scheduler.stop()
  })

  it('a Start with no children does not spin forever', () => {
    const patch = patchOf(
      [{ id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }],
      [],
      true,
    )
    const scheduler = build(patch)
    scheduler.start()
    scheduler.drain(2)
    // Degenerate chain: bounded by EMPTY_CHAIN_DELAY (0.25 s), it does not fire endlessly.
    const flashes = events.filter((e) => e.kind === 'node')
    expect(flashes.length).toBeLessThanOrEqual(12)
    expect(flashes.length).toBeGreaterThan(0)
    scheduler.stop()
  })

  it('several Start nodes launch independent cascades', () => {
    const patch = patchOf(
      [
        { id: 's1', type: 'start', position: { x: 0, y: 0 }, params: {} },
        { id: 's2', type: 'start', position: { x: 0, y: 0 }, params: {} },
        osc('a'),
        osc('b'),
      ],
      [edge('s1', 'a'), edge('s2', 'b')],
    )
    const scheduler = build(patch)
    scheduler.start()
    scheduler.drain(10)
    expect(engine.notes.filter((n) => n.nodeId === 'a')).toHaveLength(4)
    expect(engine.notes.filter((n) => n.nodeId === 'b')).toHaveLength(4)
    scheduler.stop()
  })
})

describe('delay node', () => {
  it('pushes the branch below it back by its wait', () => {
    const patch = patchOf(
      [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
        delayNode('d', 750),
        osc('a'),
      ],
      [edge('s', 'd'), edge('d', 'a')],
    )
    const scheduler = build(patch)
    scheduler.start()
    scheduler.drain(10)

    const first = engine.notes.find((n) => n.nodeId === 'a')
    expect(first).toBeDefined()
    // The Start fires at START_OFFSET; the oscillator waits 750 ms beyond that.
    const startTime = events.find((e) => e.kind === 'node' && e.id === 's')!.time
    expect(first!.time - startTime).toBeCloseTo(0.75, 6)
    scheduler.stop()
  })

  it('makes no sound of its own', () => {
    const patch = patchOf(
      [{ id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }, delayNode('d', 200)],
      [edge('s', 'd')],
    )
    const scheduler = build(patch)
    scheduler.start()
    scheduler.drain(10)
    expect(engine.notes).toHaveLength(0)
    scheduler.stop()
  })

  it('flashes for exactly as long as it waits, which is what drives the progress bar', () => {
    const patch = patchOf(
      [{ id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }, delayNode('d', 1200)],
      [edge('s', 'd')],
    )
    const scheduler = build(patch)
    scheduler.start()
    scheduler.drain(10)
    const flash = events.find((e) => e.kind === 'node' && e.id === 'd')
    expect(flash?.duration).toBeCloseTo(1.2, 6)
    scheduler.stop()
  })

  it('the loop waits for the delay before restarting', () => {
    const patch = patchOf(
      [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
        osc('a'),
        delayNode('d', 500),
      ],
      [edge('s', 'a'), edge('a', 'd')],
      true,
    )
    const scheduler = build(patch)
    scheduler.start()
    scheduler.drain(10)

    const aTimes = engine.notes
      .filter((n) => n.nodeId === 'a')
      .map((n) => n.time)
      .sort((x, y) => x - y)

    // One pass is A's sequence (1 s) plus the delay's wait (0.5 s).
    expect(aTimes.length).toBeGreaterThan(4)
    expect(aTimes[4] - aTimes[0]).toBeCloseTo(1.5, 6)
    scheduler.stop()
  })

  it('clamps an out-of-range wait instead of trusting the patch', () => {
    const patch = patchOf(
      [{ id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }, delayNode('d', 999999)],
      [edge('s', 'd')],
    )
    const scheduler = build(patch)
    scheduler.start()
    scheduler.drain(100)
    const flash = events.find((e) => e.kind === 'node' && e.id === 'd')
    expect(flash?.duration).toBeCloseTo(MAX_DELAY_MS / 1000, 6)
    scheduler.stop()
  })
})

describe('layering policy', () => {
  /**
   * Loads are shares of the ceiling rather than point counts.
   *
   * They were absolute, and broke the day the ceiling was measured rather than assumed — which is the
   * argument for writing them this way: what these tests are about is the *threshold*, and a threshold
   * is a fraction. `MAX_LOAD` moving by a factor of fifty should not touch them.
   */
  const share = (fraction: number) => MAX_LOAD * fraction

  function retrigger(voices: number, effects = 0) {
    const patch = patchOf(
      [{ id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }, osc('a')],
      [edge('s', 'a'), edge('a', 'a')],
    )
    const scheduler = build(patch)
    engine.voices = voices
    engine.effects = effects
    engine.busy.set('a', 1000) // the node is always still sounding
    scheduler.start()
    scheduler.drain(10)
    scheduler.stop()
    return engine.released
  }

  it('layers while there is budget left', () => {
    expect(retrigger(share(0.1))).toHaveLength(0)
  })

  it('degrades to a restart past 75 % of the budget', () => {
    expect(retrigger(share(0.9)).length).toBeGreaterThan(0)
  })

  it('counts effects towards the same budget, so a rack costs you layering', () => {
    // The same voices either way; a heavy rack alongside them is what tips it. This is the whole
    // reason the budget stopped counting voices and started counting work.
    expect(retrigger(share(0.4))).toHaveLength(0)
    expect(retrigger(share(0.4), share(0.45)).length).toBeGreaterThan(0)
  })
})

describe('replacing the whole patch', () => {
  const start = (id: string): PatchNode => ({
    id,
    type: 'start',
    position: { x: 0, y: 0 },
    params: {},
  })

  /** A scheduler over a patch that can be swapped underneath it, as the die does. */
  function buildSwappable(initial: Patch) {
    engine = new FakeEngine()
    events = []
    activity = new ActivityBus(() => 0)
    activity.push = (e: ActivityEvent) => {
      events.push(e)
    }
    const holder = { patch: initial }
    const scheduler = new CascadeScheduler({
      engine,
      activity,
      getPatch: () => holder.patch,
    })
    return { scheduler, holder }
  }

  const before = () => patchOf([start('s1'), osc('a')], [edge('s1', 'a')], true)
  const after = () =>
    patchOf(
      [start('s2'), start('s3'), osc('b'), osc('c')],
      [edge('s2', 'b'), edge('s3', 'c')],
      true,
    )

  it('leaves the new Starts unplayed until the cascade is seeded again', () => {
    // The bug behind this: rolling the die swaps every node for one with a fresh id, and `settle`
    // rightly refuses to re-loop a chain whose Start has gone. Nothing was seeding the new Starts,
    // so the patch fell silent while the transport still claimed to be playing.
    const { scheduler, holder } = buildSwappable(before())
    scheduler.start()
    scheduler.drain(10)
    expect(engine.notes.length).toBeGreaterThan(0)
    expect(engine.notes.every((note) => note.nodeId === 'a')).toBe(true)

    holder.patch = after()
    engine.notes.length = 0
    scheduler.drain(20)
    expect(engine.notes).toHaveLength(0)
  })

  it('seeds every Start of the patch that replaced it', () => {
    const { scheduler, holder } = buildSwappable(before())
    scheduler.start()
    scheduler.drain(10)

    holder.patch = after()
    engine.notes.length = 0
    scheduler.restart()
    scheduler.drain(30)

    expect(new Set(engine.notes.map((note) => note.nodeId))).toEqual(new Set(['b', 'c']))
  })

  it('drops what the old patch had in flight instead of letting it finish', () => {
    // A stale trigger whose node has vanished dies on its own, so the queue has to be emptied for a
    // different reason: ids can survive a replacement. A pasted code carries the ids it was written
    // with, so a trigger in flight can land on a node that exists in the new patch and sound a note
    // nobody asked for. The long delay parks exactly such a trigger beyond the horizon.
    const held = patchOf(
      [start('s1'), delayNode('d', 2000), osc('a')],
      [edge('s1', 'd'), edge('d', 'a')],
    )
    const { scheduler, holder } = buildSwappable(held)
    scheduler.start()
    scheduler.drain(0.5)
    expect(engine.notes).toHaveLength(0)

    // `a` is still here; only what leads to it changed.
    holder.patch = patchOf([start('s9'), osc('a')], [edge('s9', 'a')])
    scheduler.restart()
    engine.notes.length = 0
    scheduler.drain(30)

    // The new Start sounds `a` from 0.06, so its sequence is over inside a second and a half. The
    // stale trigger was parked at two seconds: any note for `a` after that came from a patch that
    // no longer exists.
    const fresh = engine.notes.filter((note) => note.nodeId === 'a')
    expect(fresh.length).toBeGreaterThan(0)
    expect(fresh.filter((note) => note.time > 1.5)).toHaveLength(0)
  })

  it('does not start anything while the transport is stopped', () => {
    const { scheduler, holder } = buildSwappable(before())
    holder.patch = after()
    scheduler.restart()
    scheduler.drain(30)
    expect(engine.notes).toHaveLength(0)
  })
})

describe('bound Ignites', () => {
  const bound = (id: string, behaviour: 'hold' | 'toggle' = 'hold'): PatchNode => ({
    id,
    type: 'start',
    position: { x: 0, y: 0 },
    params: { trigger: 'bound', behaviour, binding: { source: 'key', code: 'KeyA' } },
  })

  const auto = (id: string): PatchNode => ({
    id,
    type: 'start',
    position: { x: 0, y: 0 },
    params: {},
  })

  it('is not seeded by the transport, which is the point of binding it', () => {
    const patch = patchOf([bound('b'), osc('a')], [edge('b', 'a')], true)
    const scheduler = build(patch)
    scheduler.start()
    scheduler.drain(10)
    expect(engine.notes).toHaveLength(0)
  })

  it('leaves an automatic Ignite alongside it working as before', () => {
    const patch = patchOf(
      [bound('b'), osc('x'), auto('s'), osc('y')],
      [edge('b', 'x'), edge('s', 'y')],
      true,
    )
    const scheduler = build(patch)
    scheduler.start()
    scheduler.drain(10)

    const sounded = new Set(engine.notes.map((note) => note.nodeId))
    expect(sounded.has('y')).toBe(true)
    expect(sounded.has('x')).toBe(false)
  })

  it('sounds when fired', () => {
    const patch = patchOf([bound('b'), osc('a')], [edge('b', 'a')], true)
    const scheduler = build(patch)
    scheduler.start()
    scheduler.fire('b')
    scheduler.drain(10)
    expect(engine.notes.length).toBeGreaterThan(0)
  })

  it('ignores a second press while it is already sounding, so auto-repeat cannot stack it', () => {
    const patch = patchOf([bound('b'), osc('a')], [edge('b', 'a')], true)
    const scheduler = build(patch)
    scheduler.start()
    scheduler.fire('b')
    scheduler.drain(1)
    const once = engine.notes.length

    scheduler.fire('b')
    scheduler.drain(1)
    expect(engine.notes).toHaveLength(once)
  })

  it('stops sounding anything new once released', () => {
    const patch = patchOf([bound('b'), osc('a')], [edge('b', 'a')], true)
    const scheduler = build(patch)
    scheduler.start()
    scheduler.fire('b')
    scheduler.drain(0.5)

    scheduler.release('b')
    engine.notes.length = 0
    scheduler.drain(30)
    expect(engine.notes).toHaveLength(0)
  })

  it('releases the voices it was holding rather than cutting them', () => {
    // A stopped cascade should fade by its own release time, not click.
    const patch = patchOf([bound('b'), osc('a')], [edge('b', 'a')], true)
    const scheduler = build(patch)
    scheduler.start()
    scheduler.fire('b')
    scheduler.drain(0.5)

    scheduler.release('b')
    expect(engine.released.map((r) => r.nodeId)).toContain('a')
  })

  it('does not touch another cascade when one is released', () => {
    const patch = patchOf(
      [bound('b'), osc('x'), auto('s'), osc('y')],
      [edge('b', 'x'), edge('s', 'y')],
      true,
    )
    const scheduler = build(patch)
    scheduler.start()
    scheduler.fire('b')
    scheduler.drain(0.5)

    scheduler.release('b')
    engine.notes.length = 0
    scheduler.drain(10)

    const sounded = new Set(engine.notes.map((note) => note.nodeId))
    expect(sounded.has('y')).toBe(true)
    expect(sounded.has('x')).toBe(false)
  })

  it('loops while held', () => {
    const patch = patchOf([bound('b'), osc('a')], [edge('b', 'a')], true)
    const scheduler = build(patch)
    scheduler.start()
    scheduler.fire('b')
    scheduler.drain(10)
    // Ten seconds of a one-second sequence is many passes, not one.
    expect(engine.notes.length).toBeGreaterThan(8)
  })

  it('reports whether it is firing, which is what a toggle asks', () => {
    const patch = patchOf([bound('b', 'toggle'), osc('a')], [edge('b', 'a')], true)
    const scheduler = build(patch)
    scheduler.start()
    expect(scheduler.isFiring('b')).toBe(false)
    scheduler.fire('b')
    expect(scheduler.isFiring('b')).toBe(true)
    scheduler.release('b')
    expect(scheduler.isFiring('b')).toBe(false)
  })

  it('forgets what it was holding when the transport stops', () => {
    const patch = patchOf([bound('b'), osc('a')], [edge('b', 'a')], true)
    const scheduler = build(patch)
    scheduler.start()
    scheduler.fire('b')
    scheduler.stop()
    expect(scheduler.isFiring('b')).toBe(false)
  })
})

/**
 * What a step carries besides its note (PLAN §18.15).
 *
 * Three things that change when a step sounds, how often, and how many times — and each is switched off
 * until asked for, so a sequencer does what it always did until somebody wants more.
 */
describe('a step that does more than play', () => {
  function withSteps(steps: Step[], over: Partial<OscParams> = {}, roll = 0) {
    const node: PatchNode = {
      id: 'o',
      type: 'osc',
      position: { x: 0, y: 0 },
      params: { ...defaultOscParams(), division: '1/4', gate: 1, steps, ...over },
    }
    const patch = patchOf(
      [{ id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }, node],
      [edge('s', 'o')],
    )
    const scheduler = build(patch)
    // After building, because building makes a new engine and would drop anything set on the old one.
    engine.chanceValue = roll
    scheduler.start()
    scheduler.drain(10)
    scheduler.stop()
    return engine.notes
  }

  const plain = (over: Partial<Step> = {}): Step[] => [
    { note: 60, active: true, velocity: 1, ...over },
  ]

  describe('chance', () => {
    it('is ignored until the sequencer is asked for it', () => {
      // Off by default, so a step carrying a chance from somewhere else does not quietly start skipping.
      expect(withSteps(plain({ chance: 0.1 }), {}, 0.99)).toHaveLength(1)
    })

    it('skips the step when the roll comes in above it', () => {
      expect(withSteps(plain({ chance: 0.5 }), { useChance: true }, 0.9)).toHaveLength(0)
    })

    it('plays it when the roll comes in under', () => {
      expect(withSteps(plain({ chance: 0.5 }), { useChance: true }, 0.1)).toHaveLength(1)
    })

    it('always plays a step with no chance set', () => {
      expect(withSteps(plain(), { useChance: true }, 0.99)).toHaveLength(1)
    })

    it('is rolled once for the step, not once per hit', () => {
      /*
       * A step happens or it does not, and if it does, all of its hits do. Rolling per hit turns a
       * four-hit roll into a stutter — a fine sound to want, and a poor one to get without asking.
       */
      const notes = withSteps(
        plain({ chance: 0.5, ratchet: 4 }),
        { useChance: true, useRatchet: true },
        0.1,
      )
      expect(notes).toHaveLength(4)
    })
  })

  describe('ratchets', () => {
    it('are ignored until the sequencer is asked for them', () => {
      expect(withSteps(plain({ ratchet: 4 }))).toHaveLength(1)
    })

    it('fire that many hits inside the step', () => {
      expect(withSteps(plain({ ratchet: 3 }), { useRatchet: true })).toHaveLength(3)
    })

    it('share the step rather than running over the next one', () => {
      // Otherwise a roll on one step would trample the step after it, which is not a roll but a mistake.
      const [a, b, c] = withSteps(plain({ ratchet: 3 }), { useRatchet: true })
      const gap = b!.time - a!.time
      expect(c!.time - b!.time).toBeCloseTo(gap, 6)
      expect(a!.duration).toBeCloseTo(gap, 6)
    })

    it('never exceed what a roll can be', () => {
      // Past four it stops being a roll and starts being a faster sequence, which is what division is.
      expect(withSteps(plain({ ratchet: 99 }), { useRatchet: true })).toHaveLength(MAX_RATCHET)
    })
  })

  describe('slide', () => {
    it('carries the oscillator glide only on the note that asked for it', () => {
      /*
       * Which note slides belongs to the note; how long the slide lasts belongs to the oscillator. One
       * value for a whole sequence could only say that every note glides or none does, and the line
       * worth having is the one where some do.
       */
      const notes = withSteps(
        [
          { note: 60, active: true, velocity: 1, slide: true },
          { note: 64, active: true, velocity: 1 },
        ],
        { glide: 200 },
      )
      expect(notes.map((n) => n.glide)).toEqual([200, 0])
    })

    it('slides only the first hit of a roll, the rest being the same pitch', () => {
      const notes = withSteps(plain({ slide: true, ratchet: 3 }), {
        glide: 200,
        useRatchet: true,
      })
      expect(notes.map((n) => n.glide)).toEqual([200, 0, 0])
    })
  })
})

/**
 * A TRANSFORM moving a whole branch (PLAN §18.18).
 *
 * The same shape as a delay, which is the argument for it being a node at all: one moves a branch in
 * time and the other in pitch. On an oscillator it would not be per-branch — ten oscillators down a
 * branch would be ten edits — and two stacked would mean nothing.
 */
describe('a transform attached to a node', () => {
  /**
   * Wired to the side of a node, moving that node and everything the cascade reaches from it.
   *
   * It stood *in* the cascade first, between two nodes like a delay, and that was the mistake: getting
   * one between two nodes meant breaking the cable that joined them, which nothing said. Attached, it
   * needs no rewiring — onto an Ignite it takes the cascade, onto an oscillator just that branch.
   */
  function attached(
    steps: number[],
    to: 'start' | 'osc' = 'start',
    oscOver: Partial<OscParams> = {},
  ) {
    const nodes: PatchNode[] = [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
      {
        id: 'o',
        type: 'osc',
        position: { x: 0, y: 0 },
        params: {
          ...defaultOscParams(),
          steps: [{ note: 60, active: true, velocity: 1 }],
          ...oscOver,
        },
      },
    ]
    const links: PatchEdge[] = [edge('s', 'o')]
    steps.forEach((transpose, i) => {
      const id = `t${i}`
      nodes.push({ id, type: 'transform', position: { x: 0, y: 0 }, params: { transpose } })
      links.push({ id: `${id}~`, kind: 'shift', source: id, target: to === 'start' ? 's' : 'o' })
    })

    const scheduler = build(patchOf(nodes, links))
    scheduler.start()
    scheduler.drain(10)
    scheduler.stop()
    return engine.notes
  }

  const semitonesFrom = (freq: number) => Math.round(12 * Math.log2(freq / 440) + 69)

  it('leaves the branch alone when it is set to nothing', () => {
    expect(semitonesFrom(attached([0])[0]!.freq)).toBe(60)
  })

  it('moves everything below what it is attached to', () => {
    // Semitones, because this oscillator is free and there are no degrees to count.
    expect(semitonesFrom(attached([4])[0]!.freq)).toBe(64)
    expect(semitonesFrom(attached([-5])[0]!.freq)).toBe(55)
  })

  it('moves the node it is attached to as well', () => {
    // From where it is wired, downward — and that includes where it is wired.
    expect(semitonesFrom(attached([4], 'osc')[0]!.freq)).toBe(64)
  })

  it('adds up when two are on the same node, rather than one winning', () => {
    /*
     * Anything that replaced instead of adding would raise the question of which of the two applies,
     * and there is no good answer to that.
     */
    expect(semitonesFrom(attached([2, 3])[0]!.freq)).toBe(65)
    expect(semitonesFrom(attached([5, -5])[0]!.freq)).toBe(60)
  })

  it('adds one up the branch to one further down it', () => {
    const nodes: PatchNode[] = [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
      {
        id: 'o',
        type: 'osc',
        position: { x: 0, y: 0 },
        params: { ...defaultOscParams(), steps: [{ note: 60, active: true, velocity: 1 }] },
      },
      { id: 'up', type: 'transform', position: { x: 0, y: 0 }, params: { transpose: 2 } },
      { id: 'down', type: 'transform', position: { x: 0, y: 0 }, params: { transpose: 3 } },
    ]
    const scheduler = build(
      patchOf(nodes, [
        edge('s', 'o'),
        { id: 'a', kind: 'shift', source: 'up', target: 's' },
        { id: 'b', kind: 'shift', source: 'down', target: 'o' },
      ]),
    )
    scheduler.start()
    scheduler.drain(10)
    scheduler.stop()
    expect(semitonesFrom(engine.notes[0]!.freq)).toBe(65)
  })

  it('counts degrees where the oscillator has a scale', () => {
    // "A third up" is two steps. In minor that is three semitones and in major four, and the same
    // transform serves both — which is what lets one sit above oscillators in different keys.
    expect(semitonesFrom(attached([2], 'start', { scale: 'minor', scaleRoot: 0 })[0]!.freq)).toBe(
      63,
    )
    expect(semitonesFrom(attached([2], 'start', { scale: 'major', scaleRoot: 0 })[0]!.freq)).toBe(
      64,
    )
  })

  it('applies once to a branch that loops back on itself', () => {
    /*
     * A transform applies to a node or it does not, and going round twice does not make it apply twice.
     * Carried as a running total it did: a two-node cycle under a transform set to one step climbed a
     * semitone a lap until the depth cap stopped it, thirty-two of them. So what travels with a trigger
     * is which transforms are applying rather than what they come to.
     */
    const nodes: PatchNode[] = [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
      {
        id: 'a',
        type: 'osc',
        position: { x: 0, y: 0 },
        params: { ...defaultOscParams(), steps: [{ note: 60, active: true, velocity: 1 }] },
      },
      {
        id: 'b',
        type: 'osc',
        position: { x: 0, y: 0 },
        params: { ...defaultOscParams(), steps: [{ note: 60, active: true, velocity: 1 }] },
      },
      { id: 't', type: 'transform', position: { x: 0, y: 0 }, params: { transpose: 1 } },
    ]
    const scheduler = build(
      patchOf(nodes, [
        edge('s', 'a'),
        edge('a', 'b'),
        edge('b', 'a'),
        { id: 'x', kind: 'shift', source: 't', target: 'a' },
      ]),
    )
    scheduler.start()
    scheduler.drain(10)
    scheduler.stop()

    for (const note of engine.notes) expect(semitonesFrom(note.freq)).toBe(61)
  })

  it('does not reach what is not below what it is attached to', () => {
    // A branch is what hangs off the node it is on, not the patch.
    const nodes: PatchNode[] = [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
      {
        id: 'under',
        type: 'osc',
        position: { x: 0, y: 0 },
        params: { ...defaultOscParams(), steps: [{ note: 60, active: true, velocity: 1 }] },
      },
      {
        id: 'beside',
        type: 'osc',
        position: { x: 0, y: 0 },
        params: { ...defaultOscParams(), steps: [{ note: 60, active: true, velocity: 1 }] },
      },
      { id: 't', type: 'transform', position: { x: 0, y: 0 }, params: { transpose: 7 } },
    ]
    const scheduler = build(
      patchOf(nodes, [
        edge('s', 'under'),
        edge('s', 'beside'),
        { id: 'a', kind: 'shift', source: 't', target: 'under' },
      ]),
    )
    scheduler.start()
    scheduler.drain(10)
    scheduler.stop()

    const played = new Map(engine.notes.map((n) => [n.nodeId, semitonesFrom(n.freq)]))
    expect(played.get('under')).toBe(67)
    expect(played.get('beside')).toBe(60)
  })
})
