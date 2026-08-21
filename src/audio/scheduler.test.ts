import { beforeEach, describe, expect, it } from 'vitest'
import { defaultOscParams } from '../nodes/registry'
import {
  MAX_DELAY_MS,
  type NodeId,
  type Patch,
  type PatchEdge,
  type PatchNode,
} from '../types/patch'
import { ActivityBus, type ActivityEvent } from '../viz/activity'
import type { Engine, NoteRequest } from './engine'
import { CascadeScheduler, MAX_DEPTH } from './scheduler'

/** Fake engine: records what it is asked for without touching Web Audio. */
class FakeEngine implements Engine {
  notes: NoteRequest[] = []
  released: { nodeId: NodeId; at: number }[] = []
  voices = 0
  effects = 0
  busy = new Map<NodeId, number>()

  now() {
    return 0
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
    expect(retrigger(10)).toHaveLength(0)
  })

  it('degrades to a restart past 75 % of the budget', () => {
    expect(retrigger(90).length).toBeGreaterThan(0)
  })

  it('counts effects towards the same budget, so a rack costs you layering', () => {
    // The same voices either way; a heavy rack alongside them is what tips it. This is the whole
    // reason the budget stopped counting voices and started counting work.
    expect(retrigger(40)).toHaveLength(0)
    expect(retrigger(40, 45).length).toBeGreaterThan(0)
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
