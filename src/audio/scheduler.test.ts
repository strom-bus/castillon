import { beforeEach, describe, expect, it } from 'vitest'
import { defaultOscParams } from '../nodes/registry'
import {
  MAX_DELAY_MS,
  MAX_RATCHET,
  MAX_SLOP,
  type NodeId,
  type OscParams,
  type Patch,
  type PatchEdge,
  type WarpParams,
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
  /**
   * Or a run of rolls, handed out in turn and repeating.
   *
   * A single fixed value is enough for anything that asks once per step, and useless for slop, which asks
   * once per note and turns *differences* between rolls into displacement. Held fixed, every note moved
   * by the same amount — so the check that two notes can never cross could not fail, and did not when the
   * displacement was deliberately doubled. Alternating extremes is the worst case for crossing, which is
   * the case worth testing.
   */
  chanceRolls: number[] | null = null
  private rolled = 0
  chance() {
    if (!this.chanceRolls || this.chanceRolls.length === 0) return this.chanceValue
    return this.chanceRolls[this.rolled++ % this.chanceRolls.length]!
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

    /*
     * How much each hit of a roll changes in level.
     *
     * Level rather than pitch, of the two things a roll could ramp in: a real roll decays, and that
     * decay is what makes four hits read as one gesture instead of four notes stuck together. A climb
     * in pitch is an arpeggio inside a step, which is a different thing to want.
     */
    const levels = (over: Partial<Step>) =>
      withSteps(plain(over), { useRatchet: true }).map((n) => n.velocity)

    it('are flat unless a ramp asks otherwise', () => {
      // So the off position lives inside the number, rather than being a second control whose only job
      // is to say "not the usual thing".
      expect(levels({ ratchet: 4 })).toEqual([1, 1, 1, 1])
      expect(levels({ ratchet: 4, ratchetRamp: 0 })).toEqual([1, 1, 1, 1])
    })

    it('fade away across the step as the ramp goes up', () => {
      const fading = levels({ ratchet: 4, ratchetRamp: 1 })
      expect(fading[0]).toBeCloseTo(1, 6)
      expect(fading.at(-1)).toBeCloseTo(0, 6)
      for (let i = 1; i < fading.length; i++) expect(fading[i]!).toBeLessThan(fading[i - 1]!)
    })

    it('swell instead when it goes the other way', () => {
      const swelling = levels({ ratchet: 4, ratchetRamp: -1 })
      expect(swelling[0]).toBeCloseTo(0, 6)
      expect(swelling.at(-1)).toBeCloseTo(1, 6)
      for (let i = 1; i < swelling.length; i++)
        expect(swelling[i]!).toBeGreaterThan(swelling[i - 1]!)
    })

    it('ramp from whatever the step is worth, not from full', () => {
      // The step's own velocity is still the ceiling of its roll: a quiet step ramps quietly.
      const half = withSteps(plain({ velocity: 0.5, ratchet: 2, ratchetRamp: 1 }), {
        useRatchet: true,
      })
      expect(half[0]!.velocity).toBeCloseTo(0.5, 6)
    })

    it('say nothing about a step that has one hit', () => {
      // There being no second hit for it to be louder or quieter than.
      expect(levels({ ratchet: 1, ratchetRamp: 1 })).toEqual([1])
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
 * A WARP moving a whole branch (PLAN §18.18).
 *
 * The same shape as a delay, which is the argument for it being a node at all: one moves a branch in
 * time and the other in pitch. On an oscillator it would not be per-branch — ten oscillators down a
 * branch would be ten edits — and two stacked would mean nothing.
 */
describe('a warp attached to a node', () => {
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
      nodes.push({ id, type: 'warp', position: { x: 0, y: 0 }, params: { transpose } })
      links.push({ id: `${id}~`, kind: 'warp', source: id, target: to === 'start' ? 's' : 'o' })
    })

    const scheduler = build(patchOf(nodes, links))
    scheduler.start()
    scheduler.drain(10)
    scheduler.stop()
    return engine.notes
  }

  /** Two steps rather than one, so a change of pace is visible as the gap between them. */
  function attachedWith(
    first: WarpParams,
    second?: WarpParams,
    roll = 0,
    over: Partial<OscParams> = {},
  ) {
    const nodes: PatchNode[] = [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
      {
        id: 'o',
        type: 'osc',
        position: { x: 0, y: 0 },
        params: {
          ...defaultOscParams(),
          steps: [
            { note: 60, active: true, velocity: 1 },
            { note: 60, active: true, velocity: 1 },
          ],
          ...over,
        },
      },
      { id: 'w1', type: 'warp', position: { x: 0, y: 0 }, params: first },
    ]
    const links: PatchEdge[] = [
      edge('s', 'o'),
      { id: 'a', kind: 'warp', source: 'w1', target: 's' },
    ]
    if (second) {
      nodes.push({ id: 'w2', type: 'warp', position: { x: 0, y: 0 }, params: second })
      links.push({ id: 'b', kind: 'warp', source: 'w2', target: 's' })
    }

    const scheduler = build(patchOf(nodes, links))
    engine.chanceValue = roll
    scheduler.start()
    scheduler.drain(20)
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
      { id: 'up', type: 'warp', position: { x: 0, y: 0 }, params: { transpose: 2 } },
      { id: 'down', type: 'warp', position: { x: 0, y: 0 }, params: { transpose: 3 } },
    ]
    const scheduler = build(
      patchOf(nodes, [
        edge('s', 'o'),
        { id: 'a', kind: 'warp', source: 'up', target: 's' },
        { id: 'b', kind: 'warp', source: 'down', target: 'o' },
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

  it('stretches every step below it when it is slowed', () => {
    /*
     * The one thing a cascade could not do before: two branches at different speeds. A delay sets them
     * a fixed distance apart and they stay that far apart for ever; a ratio makes them drift and keep
     * drifting, which is what the machine is for.
     */
    const gapOf = (notes: NoteRequest[]) => notes[1]!.time - notes[0]!.time
    const plain = gapOf(attachedWith({ transpose: 0, speed: 1 }))

    expect(gapOf(attachedWith({ transpose: 0, speed: 0.5 }))).toBeCloseTo(plain * 2, 6)
  })

  it('shortens them when it is sped up, and stacks with another', () => {
    const gap = (notes: NoteRequest[]) => notes[1]!.time - notes[0]!.time
    const plain = gap(attachedWith({ transpose: 0, speed: 1 }))
    expect(gap(attachedWith({ transpose: 0, speed: 2 }))).toBeCloseTo(plain / 2, 6)
    // Two halves come to a quarter, which is the operation applied twice rather than one of them winning.
    expect(
      gap(attachedWith({ transpose: 0, speed: 0.5 }, { transpose: 0, speed: 0.5 })),
    ).toBeCloseTo(plain * 4, 6)
  })

  it('scales what every note below it is worth', () => {
    // And it does two things at once, velocity being a modulation source: quieter, and wherever a
    // per-note envelope takes its depth from velocity, less open as well.
    const [note] = attachedWith({ transpose: 0, velocity: 0.5 })
    expect(note!.velocity).toBeCloseTo(0.5, 6)
  })

  it('never asks for a velocity past what one can be', () => {
    // Because it feeds loudness and envelope depth together: past one the first would only clip while
    // the second went on climbing, and the two would part company.
    const [note] = attachedWith({ transpose: 0, velocity: 4 })
    expect(note!.velocity).toBeLessThanOrEqual(1)
  })

  it('thins a branch out by chance, whether or not the steps carry one', () => {
    /*
     * The branch scaling applies even where the oscillator does not use per-step chance, which is the
     * useful reading: "this branch happens half the time" is worth wanting without having set a chance
     * on sixteen steps first.
     */
    expect(attachedWith({ transpose: 0, chance: 0.5 }, undefined, 0.9)).toHaveLength(0)
    expect(attachedWith({ transpose: 0, chance: 0.5 }, undefined, 0.1)).not.toHaveLength(0)
  })

  describe('swing', () => {
    /*
     * A pair of steps sharing their two step-lengths unevenly, and the property that matters most is the
     * one about what does *not* change: a pair keeps its total, so a sequence takes exactly as long swung
     * as straight and hands the cascade on at the same moment. Without that, swinging one branch would
     * pull the whole patch out of shape and it would be a Speed with extra rules.
     */
    const starts = (params: WarpParams) => attachedWith(params).map((note) => note.time)
    const gaps = (params: WarpParams) => {
      const times = starts(params)
      return times.slice(1).map((time, i) => time - times[i]!)
    }

    it('does nothing at all until the switch is on', () => {
      // The ratio is remembered while unused, which is the whole reason it is a switch and not a value.
      expect(gaps({ transpose: 0, swing: 2 })).toEqual(gaps({ transpose: 0 }))
    })

    it('lengthens the first of a pair and shortens the second', () => {
      const swung = attachedWith({ transpose: 0, swing: 2, useSwing: true })
      const plain = attachedWith({ transpose: 0 })
      // Two steps, so the first note's own slot is the long half and it starts where it always did.
      expect(swung[0]!.time).toBeCloseTo(plain[0]!.time, 6)
      expect(swung[1]!.time).toBeGreaterThan(plain[1]!.time)
    })

    it('leaves every pair boundary exactly where it was, however hard it swings', () => {
      /*
       * The invariant that matters most, and the cleanest way to state it: only the *inside* of a pair
       * moves. With four steps, the third starts at two step-lengths whatever the swing, because the pair
       * before it kept its total. That is what makes a sequence take exactly as long swung as straight,
       * and therefore hand the cascade on at the same moment — without it, swinging one branch would pull
       * everything below it out of place and this would be a Speed with extra rules.
       */
      const four = [
        { note: 60, active: true, velocity: 1 },
        { note: 62, active: true, velocity: 1 },
        { note: 64, active: true, velocity: 1 },
        { note: 65, active: true, velocity: 1 },
      ]
      const at = (params: WarpParams) =>
        attachedWith(params, undefined, 0, { steps: four }).map((note) => note.time)

      const straight = at({ transpose: 0 })
      for (const ratio of [1.5, 2, 3]) {
        const swung = at({ transpose: 0, swing: ratio, useSwing: true })
        expect(swung[0], `${ratio}:1`).toBeCloseTo(straight[0]!, 6)
        expect(swung[2], `${ratio}:1`).toBeCloseTo(straight[2]!, 6)
        // And the inside of each pair really did move, or the check above proves nothing.
        expect(swung[1]!).toBeGreaterThan(straight[1]!)
        expect(swung[3]!).toBeGreaterThan(straight[3]!)
      }
    })

    it('makes the long half exactly that many times the short', () => {
      /*
       * The assertion that pins the split, and the reason it is this one: my first attempt checked that
       * the short half *ends* on the pair boundary, which is a tautology of the arithmetic — `long` plus
       * `pair − long` is `pair` whatever `long` is, so it passed with `long` set to three times the pair
       * and a step of negative length. A test that cannot fail for the thing it names is worse than none.
       *
       * The ratio is what the control claims to be, and it fixes the split uniquely. Gate at one so a
       * note's duration is its whole slot.
       */
      const four = Array.from({ length: 4 }, () => ({ note: 60, active: true, velocity: 1 }))
      for (const ratio of [1.5, 2, 3]) {
        const notes = attachedWith({ transpose: 0, swing: ratio, useSwing: true }, undefined, 0, {
          steps: four,
          gate: 1,
        })
        expect(notes[0]!.duration / notes[1]!.duration, `${ratio}:1`).toBeCloseTo(ratio, 5)
        // Both halves real, and in order — which is what the tautology above could not see.
        for (const note of notes) expect(note.duration, `${ratio}:1`).toBeGreaterThan(0)
        for (let i = 1; i < notes.length; i++) {
          expect(notes[i]!.time, `${ratio}:1`).toBeGreaterThan(notes[i - 1]!.time)
        }
      }
    })

    it('is straight at a ratio of one, even with the switch on', () => {
      expect(gaps({ transpose: 0, swing: 1, useSwing: true })).toEqual(gaps({ transpose: 0 }))
    })

    it('multiplies when two of them reach the same notes', () => {
      // Which is the property that lets any number stack without deciding which wins — the same reason
      // the other ratios multiply and the pitch adds.
      const once = gaps({ transpose: 0, swing: 1.5, useSwing: true })[0]!
      const twice = attachedWith(
        { transpose: 0, swing: 1.5, useSwing: true },
        { transpose: 0, swing: 1.5, useSwing: true },
      )
      const harder = twice[1]!.time - twice[0]!.time
      expect(harder).toBeGreaterThan(once)
    })

    it('makes a roll on the long half slower than the same roll on the short', () => {
      // A roll divides the step it is in, and the step is now uneven — which is what a roll played with a
      // groove does rather than something that needed a rule of its own.
      const notes = attachedWith({ transpose: 0, swing: 2, useSwing: true }, undefined, 0, {
        useRatchet: true,
        steps: [
          { note: 60, active: true, velocity: 1, ratchet: 2 },
          { note: 60, active: true, velocity: 1, ratchet: 2 },
        ],
      })
      const longRoll = notes[1]!.time - notes[0]!.time
      const shortRoll = notes[3]!.time - notes[2]!.time
      expect(longRoll).toBeGreaterThan(shortRoll)
    })
  })

  it('does not let a loud branch flatten a roll that swells', () => {
    /*
     * Why the branch scaling is clamped before the roll is shaped rather than after.
     *
     * Unclamped, a branch pushed to four times level would take a swelling roll straight to the top on
     * its second hit and hold it there: the ramp would still be set, and would be doing nothing. The
     * shape a step was given survives how loud the branch asks for it to be.
     */
    const nodes: PatchNode[] = [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
      {
        id: 'o',
        type: 'osc',
        position: { x: 0, y: 0 },
        params: {
          ...defaultOscParams(),
          useRatchet: true,
          steps: [{ note: 60, active: true, velocity: 1, ratchet: 4, ratchetRamp: -1 }],
        },
      },
      { id: 'w', type: 'warp', position: { x: 0, y: 0 }, params: { transpose: 0, velocity: 4 } },
    ]
    const scheduler = build(
      patchOf(nodes, [edge('s', 'o'), { id: 'a', kind: 'warp', source: 'w', target: 's' }]),
    )
    scheduler.start()
    scheduler.drain(10)
    scheduler.stop()

    const swelling = engine.notes.map((n) => n.velocity)
    for (let i = 1; i < swelling.length; i++) expect(swelling[i]!).toBeGreaterThan(swelling[i - 1]!)
  })

  it('leaves a branch alone at a chance of one', () => {
    expect(attachedWith({ transpose: 0, chance: 1 }, undefined, 0.99)).not.toHaveLength(0)
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
      { id: 't', type: 'warp', position: { x: 0, y: 0 }, params: { transpose: 1 } },
    ]
    const scheduler = build(
      patchOf(nodes, [
        edge('s', 'a'),
        edge('a', 'b'),
        edge('b', 'a'),
        { id: 'x', kind: 'warp', source: 't', target: 'a' },
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
      { id: 't', type: 'warp', position: { x: 0, y: 0 }, params: { transpose: 7 } },
    ]
    const scheduler = build(
      patchOf(nodes, [
        edge('s', 'under'),
        edge('s', 'beside'),
        { id: 'a', kind: 'warp', source: 't', target: 'under' },
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

/**
 * Slop: how loosely a branch is played.
 *
 * Measured as a share of the shortest gap in the sequence rather than in milliseconds, and that is the
 * whole design rather than a detail. Thirty milliseconds is five per cent of the gap in a slow straight
 * bass and two hundred and forty per cent of it in a fast branch at heavy swing — inaudible in one and
 * the groove destroyed in the other, from one setting. A fixed time cannot mean the same thing in two
 * branches of a machine whose branches run at different speeds on purpose.
 */
describe('a warp that plays a branch loosely', () => {
  /** Four steps under one warp, with the dice held at a fixed roll so the wobble is repeatable. */
  function loose(params: WarpParams, roll: number) {
    const steps = Array.from({ length: 4 }, (_, i) => ({
      note: 60 + i,
      active: true,
      velocity: 1,
    }))
    const nodes: PatchNode[] = [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
      {
        id: 'o',
        type: 'osc',
        position: { x: 0, y: 0 },
        params: { ...defaultOscParams(), steps, gate: 1 },
      },
      { id: 'w', type: 'warp', position: { x: 0, y: 0 }, params },
    ]
    const scheduler = build(
      patchOf(nodes, [edge('s', 'o'), { id: 'a', kind: 'warp', source: 'w', target: 's' }]),
    )
    engine.chanceValue = roll
    scheduler.start()
    scheduler.drain(20)
    scheduler.stop()
    return engine.notes.map((note) => note.time)
  }

  const straight = () => loose({ transpose: 0 }, 0.5)

  it('does nothing until the switch is on', () => {
    // The amount is remembered while unused, which is what a bypass is for.
    expect(loose({ transpose: 0, slop: 0.4 }, 0)).toEqual(straight())
  })

  it('moves notes off the grid once it is', () => {
    const moved = loose({ transpose: 0, slop: 0.4, useSlop: true }, 0)
    const grid = straight()
    // Roll 0 is the bottom of the range, so every note is pushed as early as it may go.
    expect(moved.slice(1)).not.toEqual(grid.slice(1))
  })

  it('is centred, so a branch is loose rather than late', () => {
    /*
     * Always-late is a different feel and would be a different control. A roll at the bottom of the range
     * pushes early and one at the top pushes late, by the same amount either way.
     */
    const grid = straight()
    const early = loose({ transpose: 0, slop: 0.4, useSlop: true }, 0)
    const late = loose({ transpose: 0, slop: 0.4, useSlop: true }, 0.999)
    expect(early[2]!).toBeLessThan(grid[2]!)
    expect(late[2]!).toBeGreaterThan(grid[2]!)
    expect(grid[2]! - early[2]!).toBeCloseTo(late[2]! - grid[2]!, 3)
  })

  it('never starts a branch before the thing that triggered it', () => {
    /*
     * The one note close enough to the present for this to matter. Its nominal time *is* the trigger
     * instant, and the scheduler floors everything at now — a note pushed earlier would pile up on that
     * floor, which is the divergence that hung the first load sweeps. Everything after it is far enough
     * ahead to move either way.
     */
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      const times = loose({ transpose: 0, slop: MAX_SLOP, useSlop: true }, roll)
      expect(times[0], `roll ${roll}`).toBeGreaterThanOrEqual(straight()[0]!)
    }
  })

  it('scales with the sequence, so one setting means one thing everywhere', () => {
    /*
     * The reason it is a share and not a time. The same slop on a branch running at double speed has to
     * displace by half as much, or a setting that is a groove in one branch is noise in another.
     */
    const spread = (params: WarpParams) => {
      const grid = loose({ ...params, slop: 0, useSlop: false }, 0.5)
      const wobbled = loose({ ...params, slop: 0.4, useSlop: true }, 0)
      return Math.abs(wobbled[2]! - grid[2]!)
    }
    const atSpeed = spread({ transpose: 0, speed: 2 })
    const plain = spread({ transpose: 0 })
    expect(atSpeed).toBeCloseTo(plain / 2, 4)
  })

  /** The same, with the dice alternating between its extremes — the worst case for two notes meeting. */
  function loosest(params: WarpParams, rolls: number[]) {
    const nodes: PatchNode[] = [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
      {
        id: 'o',
        type: 'osc',
        position: { x: 0, y: 0 },
        params: {
          ...defaultOscParams(),
          gate: 1,
          steps: Array.from({ length: 8 }, (_, i) => ({
            note: 60 + i,
            active: true,
            velocity: 1,
          })),
        },
      },
      { id: 'w', type: 'warp', position: { x: 0, y: 0 }, params },
    ]
    const scheduler = build(
      patchOf(nodes, [edge('s', 'o'), { id: 'a', kind: 'warp', source: 'w', target: 's' }]),
    )
    engine.chanceRolls = rolls
    scheduler.start()
    scheduler.drain(20)
    scheduler.stop()
    return engine.notes.map((note) => note.time)
  }

  it('keeps notes from crossing even at its most, and under a heavy swing', () => {
    /*
     * The guarantee the cap exists for, tested the only way it can be: with the dice alternating between
     * its extremes, so one note is thrown as late as it may go and the next as early. Held at a single
     * value every note moves together and nothing can ever cross, which is how a doubled displacement
     * passed this check on the first attempt.
     *
     * Two notes each free to move by X close on each other by 2X, so the share is capped at a half of the
     * *short* half — which is why it is measured against the short half and not the step. Loose is a
     * feel; out of order is a fault.
     */
    /*
     * Both phases of the alternation, and that is not thoroughness for its own sake. With late-then-early
     * the *long* gap closes and the short one opens; only early-then-late closes the short one, which is
     * the gap the cap is sized against. Testing one phase let a displacement measured on the whole step
     * instead of the short half pass — twice the size it should be, and invisible.
     */
    for (const swing of [1, 2, 3]) {
      for (const rolls of [
        [0.999, 0],
        [0, 0.999],
      ]) {
        const times = loosest(
          { transpose: 0, slop: MAX_SLOP, useSlop: true, swing, useSwing: swing > 1 },
          rolls,
        )
        for (let i = 1; i < times.length; i++) {
          expect(
            times[i],
            `swing ${swing}, rolls ${rolls.join()}, note ${i}`,
          ).toBeGreaterThanOrEqual(times[i - 1]!)
        }
      }
    }
  })

  it('caps the sum, so two warps cannot ask for more than notes can survive', () => {
    // Each on its own is under the cap and together they are over it. Uncapped, the pair would displace
    // by more than the gap allows and the sequence would come out shuffled rather than loose.
    const both = { transpose: 0, slop: 0.4, useSlop: true }
    const times = loosest(both, [0.999, 0])
    const capped = loosest({ ...both, slop: MAX_SLOP }, [0.999, 0])
    // Two of 0.4 is 0.8, which has to land on the cap and so match a single warp already at it.
    const twice = loosestPair(0.4, [0.999, 0])
    expect(twice).toEqual(capped)
    expect(times.length).toBe(capped.length)
  })

  /** Two warps on one branch, each asking for the same looseness. */
  function loosestPair(slop: number, rolls: number[]) {
    const nodes: PatchNode[] = [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
      {
        id: 'o',
        type: 'osc',
        position: { x: 0, y: 0 },
        params: {
          ...defaultOscParams(),
          gate: 1,
          steps: Array.from({ length: 8 }, (_, i) => ({
            note: 60 + i,
            active: true,
            velocity: 1,
          })),
        },
      },
      {
        id: 'w1',
        type: 'warp',
        position: { x: 0, y: 0 },
        params: { transpose: 0, slop, useSlop: true },
      },
      {
        id: 'w2',
        type: 'warp',
        position: { x: 0, y: 0 },
        params: { transpose: 0, slop, useSlop: true },
      },
    ]
    const scheduler = build(
      patchOf(nodes, [
        edge('s', 'o'),
        { id: 'a', kind: 'warp', source: 'w1', target: 's' },
        { id: 'b', kind: 'warp', source: 'w2', target: 's' },
      ]),
    )
    engine.chanceRolls = rolls
    scheduler.start()
    scheduler.drain(20)
    scheduler.stop()
    return engine.notes.map((note) => note.time)
  }

  it('adds when two warps ask for it, unlike the ratios', () => {
    // Following the pitch rather than the ratios: two warps asking for looseness make a branch looser.
    const grid = straight()
    const one = Math.abs(loose({ transpose: 0, slop: 0.1, useSlop: true }, 0)[2]! - grid[2]!)
    const nodes: PatchNode[] = [
      { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
      {
        id: 'o',
        type: 'osc',
        position: { x: 0, y: 0 },
        params: {
          ...defaultOscParams(),
          gate: 1,
          steps: Array.from({ length: 4 }, (_, i) => ({
            note: 60 + i,
            active: true,
            velocity: 1,
          })),
        },
      },
      {
        id: 'w1',
        type: 'warp',
        position: { x: 0, y: 0 },
        params: { transpose: 0, slop: 0.1, useSlop: true },
      },
      {
        id: 'w2',
        type: 'warp',
        position: { x: 0, y: 0 },
        params: { transpose: 0, slop: 0.1, useSlop: true },
      },
    ]
    const scheduler = build(
      patchOf(nodes, [
        edge('s', 'o'),
        { id: 'a', kind: 'warp', source: 'w1', target: 's' },
        { id: 'b', kind: 'warp', source: 'w2', target: 's' },
      ]),
    )
    engine.chanceValue = 0
    scheduler.start()
    scheduler.drain(20)
    scheduler.stop()
    const both = Math.abs(engine.notes.map((n) => n.time)[2]! - grid[2]!)
    expect(both).toBeCloseTo(one * 2, 4)
  })
})
