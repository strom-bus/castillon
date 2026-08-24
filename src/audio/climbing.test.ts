import { describe, expect, it } from 'vitest'
import { defaultOscParams, NODE_DEFINITIONS } from '../nodes/registry'
import type { NodeId, Patch, PatchEdge, PatchNode } from '../types/patch'
import { ActivityBus, type ActivityEvent } from '../viz/activity'
import { CascadeScheduler, MAX_DEPTH } from './scheduler'
import type { Engine, NoteRequest } from './engine'

/**
 * A wave that climbs the cascade instead of descending it.
 *
 * The IGNITE has a second trigger output, at the top, and a cable from it starts a wave that follows
 * ordinary cables **backwards** — from a node to whatever points at it — until nothing is above. So one
 * trigger can play the same tree in both directions at once.
 *
 * What makes this cheap is that the direction is a property of the *trigger*, not of the node or of the
 * graph. Nothing computes a depth, nothing reverses a graph, and both waves live in one chain — so a pass
 * still ends when it has drained and is still as long as its longest branch, whichever way that branch
 * ran. The tests below are mostly about those three things not needing to be special.
 */

class Recorder implements Engine {
  order: NodeId[] = []
  notes: NoteRequest[] = []
  now() {
    return 0
  }
  chance() {
    return 0
  }
  playNote(req: NoteRequest) {
    this.notes.push(req)
    this.order.push(req.nodeId)
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

const osc = (id: string): PatchNode => ({
  id,
  type: 'osc',
  position: { x: 0, y: 0 },
  params: { ...defaultOscParams(), steps: [{ note: 60, active: true, velocity: 1 }] },
})

const ignite = (id: string): PatchNode => ({
  id,
  type: 'start',
  position: { x: 0, y: 0 },
  params: {},
})

const down = (source: string, target: string): PatchEdge => ({
  id: `${source}->${target}`,
  kind: 'event',
  source,
  target,
})

const climb = (source: string, target: string): PatchEdge => ({ ...down(source, target), up: true })

function run(nodes: PatchNode[], edges: PatchEdge[], seconds = 4, loop = false) {
  const engine = new Recorder()
  const events: ActivityEvent[] = []
  const activity = new ActivityBus(() => 0)
  activity.push = (event) => events.push(event)
  const patch: Patch = { version: 1, bpm: 120, loop, nodes, edges }
  const scheduler = new CascadeScheduler({ engine, activity, getPatch: () => patch })
  scheduler.start()
  scheduler.drain(seconds)
  scheduler.stop()
  return { engine, events }
}

/** The order distinct nodes first sounded in, which is what "which way did it go" means audibly. */
function entered(engine: Recorder): NodeId[] {
  const seen: NodeId[] = []
  for (const id of engine.order) if (!seen.includes(id)) seen.push(id)
  return seen
}

/** A chain of three oscillators under one Ignite, which is the plainest cascade there is. */
const CHAIN = {
  nodes: [ignite('i'), osc('a'), osc('b'), osc('c')],
  edges: [down('i', 'a'), down('a', 'b'), down('b', 'c')],
}

describe('the Ignite’s upward port', () => {
  it('is declared on the Ignite and on nothing else', () => {
    /*
     * Asked of the registry rather than listed, and the asymmetry is the point: a pass *begins* at an
     * Ignite, so that is the only place it means anything to say which way it begins. A delay or an
     * oscillator with an upward output would be a second way of saying the same thing, in a place where
     * the wave has already been given a direction.
     */
    const withUp = NODE_DEFINITIONS.filter((definition) => definition.ports.up).map((d) => d.type)
    expect(withUp).toEqual(['start'])
  })

  it('runs the same tree the other way round', () => {
    /*
     * The whole feature in one comparison. Wired downward, the chain enters a, b, c. Wired to the deepest
     * node from the upward port, it enters c, b, a — the same three nodes, the same cables, read backwards.
     */
    const downward = run(CHAIN.nodes, CHAIN.edges)
    expect(entered(downward.engine)).toEqual(['a', 'b', 'c'])

    const upward = run(CHAIN.nodes, [...CHAIN.edges.slice(1), climb('i', 'c')])
    expect(entered(upward.engine)).toEqual(['c', 'b', 'a'])
  })

  it('plays both directions at once from one trigger', () => {
    /*
     * What the second port is *for*. The same tree, wired downward from the bottom port and upward from
     * the top one: every node is reached twice in a pass, once by each wave, and the two meet in the
     * middle. A cascade that grows both ways from one point is a gesture nothing else here can make.
     */
    const { engine } = run(CHAIN.nodes, [...CHAIN.edges, climb('i', 'c')])
    const counts = new Map<NodeId, number>()
    for (const id of engine.order) counts.set(id, (counts.get(id) ?? 0) + 1)

    for (const id of ['a', 'b', 'c']) {
      expect(counts.get(id), `${id} was not reached both ways`).toBe(2)
    }
  })

  it('needs no JOIN where the two waves meet', () => {
    /*
     * A node reached by both waves fires twice, which is exactly what already happens to a node with two
     * parents. That consistency is why this feature needed no new rule about convergence — and a rule is
     * the thing that could not have been written, since a node that *waits* cannot exist in a graph that
     * permits cycles (PLAN §34).
     */
    const both = run(CHAIN.nodes, [...CHAIN.edges, climb('i', 'c')])
    const twoParents = run([ignite('i'), ignite('j'), osc('a')], [down('i', 'a'), down('j', 'a')])
    const timesOf = (order: NodeId[]) => order.filter((id) => id === 'a').length
    expect(timesOf(twoParents.engine.order)).toBe(2)
    expect(timesOf(both.engine.order)).toBe(2)
  })

  it('does not let a climbing wave use an upward cable to get home', () => {
    /*
     * The one thing that had to be excluded. An upward cable is an event cable from the Ignite, so a wave
     * climbing from its target would find it and follow it straight back — firing the Ignite again and
     * flashing that cable in the wrong direction. It is the entry to a climb, not a rung of one.
     */
    const { engine, events } = run(CHAIN.nodes, [...CHAIN.edges.slice(1), climb('i', 'c')])
    expect(entered(engine)).toEqual(['c', 'b', 'a'])

    /*
     * Asserted on the **activity**, not on the notes, because an Ignite makes no sound: a wave that bounced
     * back to it would fire it a second time and nothing audible would change. Written against the notes
     * first, and indexing the upward cables backwards left it green.
     *
     * So: the Ignite happens once in the pass, and the upward cable lights once — not twice, once
     * outbound and once on the way home.
     */
    const igniteFired = events.filter((e) => e.kind === 'node' && e.id === 'i')
    expect(igniteFired).toHaveLength(1)
    const upwardLit = events.filter((e) => e.kind === 'edge' && e.id === 'i->c')
    expect(upwardLit).toHaveLength(1)
  })

  it('stops when it runs out of anything above, without the Ignite needing to know', () => {
    // The climb terminates because nothing points at `a` except the Ignite's downward cable, which is not
    // in this patch. No special case anywhere: the index simply has nothing for it.
    const { engine } = run([ignite('i'), osc('a'), osc('b')], [down('a', 'b'), climb('i', 'b')])
    expect(entered(engine)).toEqual(['b', 'a'])
  })

  it('makes a pass as long as its longest branch, whichever way that branch ran', () => {
    /*
     * Both waves share one chain, so `settle` needs no notion of direction at all — and the pass length
     * is the longer of the two. Checked by looping: the second pass has to start after the *climb* has
     * finished, not after the descent.
     */
    const long = { nodes: CHAIN.nodes, edges: [...CHAIN.edges.slice(1), climb('i', 'c')] }
    const { engine } = run(long.nodes, long.edges, 6, true)

    const firsts = engine.notes.filter((note) => note.nodeId === 'c').map((note) => note.time)
    expect(firsts.length).toBeGreaterThan(1)
    // Three oscillators of four steps at 1/8 and 120 BPM: one second each, three per pass.
    expect(firsts[1] - firsts[0]).toBeCloseTo(0.75, 2)
  })

  it('flashes the cables it actually travelled', () => {
    // The canvas is how a patch is read, and a wave nobody can see going up is a wave that looks like a
    // fault. Every cable a trigger crossed has to light, upward ones included.
    const { events } = run(CHAIN.nodes, [...CHAIN.edges.slice(1), climb('i', 'c')])
    const lit = new Set(events.filter((e) => e.kind === 'edge').map((e) => e.id))
    expect(lit.has('i->c')).toBe(true)
    expect(lit.has('b->c')).toBe(true)
    expect(lit.has('a->b')).toBe(true)
  })

  it('cuts a loop between the two waves at the depth cap, as it does any other', () => {
    /*
     * A climb meeting a descent can close a loop in the traversal. This is the *event* graph, so that is a
     * finite re-triggering bounded by `MAX_DEPTH` rather than a gain running away — the distinction that
     * makes cycles a feature here and would make them a fault in the audio graph.
     */
    const { engine } = run(
      [ignite('i'), osc('a'), osc('b')],
      [down('i', 'a'), down('a', 'b'), down('b', 'a'), climb('i', 'b')],
    )
    // It terminated at all, which is the claim, and did not run for ever.
    expect(engine.order.length).toBeGreaterThan(2)
    expect(engine.order.length).toBeLessThan(MAX_DEPTH * 4)
  })

  it('says which way each pulse ran, so the canvas can animate it', () => {
    /*
     * The direction belongs to the **trigger**, not to the cable. In a patch wired from both ports the
     * same cable carries a descent and a climb, and a pulse that always ran source to target would be
     * telling the opposite of the truth half the time — on a canvas that is how a patch is read.
     *
     * The upward cable itself is crossed the ordinary way, source to target, because it is where a climb
     * *starts*. Only the cables a climb then uses are crossed backwards.
     */
    const { events } = run(CHAIN.nodes, [...CHAIN.edges, climb('i', 'c')])
    const crossings = events.filter((e) => e.kind === 'edge')
    const ways = new Map<string, Set<boolean>>()
    for (const one of crossings) {
      const seen = ways.get(one.id) ?? new Set<boolean>()
      seen.add(one.kind === 'edge' && one.up === true)
      ways.set(one.id, seen)
    }

    // The cable that starts the climb: forward, and only ever forward. It is the entrance, not a rung.
    expect([...(ways.get('i->c') ?? [])]).toEqual([false])
    /*
     * Every other cable in this patch is crossed both ways in one pass, the Ignite's own descending one
     * included — the climb finishes by arriving at the Ignite *through* it, which is what "the wave runs
     * out of anything above" looks like from the cable's side. Asserted rather than assumed: the first
     * version of this test expected that one to be forward only, and the code was right.
     */
    for (const id of ['i->a', 'a->b', 'b->c']) {
      expect([...(ways.get(id) ?? [])].sort(), id).toEqual([false, true])
    }
  })

  it('runs one direction each way when the Ignite sits in the middle', () => {
    /*
     * The arrangement this is for, said as Wilhelm put it: with the Ignite in the middle of a cascade,
     * everything off the bottom port flows down and everything off the top port flows up. Two separate
     * branches, one wave each, no cable shared.
     */
    const nodes = [ignite('i'), osc('below'), osc('deeper'), osc('above'), osc('higher')]
    const { engine, events } = run(nodes, [
      // Down from the bottom port.
      down('i', 'below'),
      down('below', 'deeper'),
      // And up from the top one: the chain above is drawn downward, as every chain is, and the wave
      // climbs it — so the Ignite fires its *bottom* and the trigger travels to `higher`.
      down('higher', 'above'),
      climb('i', 'above'),
    ])

    expect(entered(engine)).toEqual(['below', 'above', 'deeper', 'higher'])

    const wayOf = (id: string) =>
      events
        .filter((e) => e.kind === 'edge' && e.id === id)
        .map((e) => e.kind === 'edge' && e.up === true)
    // The descending branch never carries a climb, and the climbing branch never carries a descent.
    expect(wayOf('i->below')).toEqual([false])
    expect(wayOf('below->deeper')).toEqual([false])
    expect(wayOf('i->above')).toEqual([false])
    expect(wayOf('higher->above')).toEqual([true])
  })

  it('changes nothing about a patch that has no upward cable in it', () => {
    // The whole of the old behaviour, unmoved. Worth its own test because the traversal now branches on a
    // flag, and a default read the wrong way would invert every cascade in the instrument at once.
    const { engine } = run(CHAIN.nodes, CHAIN.edges)
    expect(entered(engine)).toEqual(['a', 'b', 'c'])
  })
})
