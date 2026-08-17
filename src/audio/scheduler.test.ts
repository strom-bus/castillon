import { beforeEach, describe, expect, it } from 'vitest'
import { defaultOsc4Params } from '../nodes/registry'
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
  busy = new Map<NodeId, number>()

  now() {
    return 0
  }
  playNote(req: NoteRequest) {
    this.notes.push(req)
  }
  voicesAt() {
    return this.voices
  }
  nodeBusyUntil(nodeId: NodeId) {
    return this.busy.get(nodeId) ?? 0
  }
  releaseNodeVoices(nodeId: NodeId, at: number) {
    this.released.push({ nodeId, at })
  }
}

function osc(id: string): PatchNode {
  return { id, type: 'osc4', position: { x: 0, y: 0 }, params: defaultOsc4Params() }
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
    ;(a.params as ReturnType<typeof defaultOsc4Params>).propagateMode = 'onStart'
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
    // Degenerate chain: bounded by MIN_CHAIN_DURATION (0.25 s), it does not fire endlessly.
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
  function retrigger(voices: number) {
    const patch = patchOf(
      [{ id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }, osc('a')],
      [edge('s', 'a'), edge('a', 'a')],
    )
    const scheduler = build(patch)
    engine.voices = voices
    engine.busy.set('a', 1000) // the node is always still sounding
    scheduler.start()
    scheduler.drain(10)
    scheduler.stop()
    return engine.released
  }

  it('layers while there is voice budget left', () => {
    expect(retrigger(10)).toHaveLength(0)
  })

  it('degrades to a restart past 75 % of the budget', () => {
    expect(retrigger(60).length).toBeGreaterThan(0)
  })
})
