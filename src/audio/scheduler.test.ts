import { beforeEach, describe, expect, it } from 'vitest'
import { defaultOsc4Params } from '../nodes/registry'
import type { NodeId, Patch, PatchEdge, PatchNode } from '../types/patch'
import { ActivityBus, type ActivityEvent } from '../viz/activity'
import type { Engine, NoteRequest } from './engine'
import { CascadeScheduler, MAX_DEPTH } from './scheduler'

/** Motor falso: registra lo que se le pide sin tocar Web Audio. */
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

/** A 120 BPM con división 1/8, un paso dura 0.25 s y una secuencia de 4 pasos, 1 s. */
const STEP = 0.25
const SEQUENCE = STEP * 4

describe('CascadeScheduler', () => {
  it('propaga en cascada: el hijo empieza cuando el padre termina su secuencia', () => {
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
    // El primer paso de B cae exactamente donde termina la secuencia de A.
    expect(second[0] - first[0]).toBeCloseTo(SEQUENCE, 6)
    scheduler.stop()
  })

  it('ramifica: dos hijos del mismo nodo arrancan a la vez', () => {
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

  it('respeta el modo de propagación onStart', () => {
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

  it('corta los ciclos en MAX_DEPTH en vez de colgarse', () => {
    const patch = patchOf(
      [{ id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }, osc('a'), osc('b')],
      [edge('s', 'a'), edge('a', 'b'), edge('b', 'a')],
    )
    const scheduler = build(patch)
    scheduler.start()
    scheduler.drain(1000)

    // Cada nodo del ciclo programa 4 notas por vuelta, y hay MAX_DEPTH vueltas como mucho.
    expect(engine.notes.length).toBeLessThanOrEqual((MAX_DEPTH + 1) * 4)
    expect(engine.notes.length).toBeGreaterThan(0)
    scheduler.stop()
  })

  it('relanza la cascada cuando todas las ramas han terminado', () => {
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

    // Sin loop sólo habría 4 notas de A; con loop hay varias vueltas.
    expect(aTimes.length).toBeGreaterThan(4)
    // Una vuelta completa dura lo que la rama más larga: A (1 s) + B (1 s).
    expect(aTimes[4] - aTimes[0]).toBeCloseTo(SEQUENCE * 2, 6)
    scheduler.stop()
  })

  it('el reinicio del loop se decide por delante del reloj de audio', () => {
    const patch = patchOf(
      [{ id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }, osc('a')],
      [edge('s', 'a')],
      true,
    )
    const scheduler = build(patch)
    scheduler.start()
    // El reloj falso está en 0; drenamos sólo el horizonte de look-ahead.
    scheduler.drain(0.1)

    // Con la primera vuelta programada, la siguiente ya debe estar en cola aunque no haya sonado.
    scheduler.drain(1.2)
    const times = engine.notes.map((n) => n.time).sort((x, y) => x - y)
    expect(times.length).toBeGreaterThan(4)
    scheduler.stop()
  })

  it('no relanza si el loop está apagado', () => {
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

  it('un Start sin hijos no produce un bucle infinito', () => {
    const patch = patchOf(
      [{ id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }],
      [],
      true,
    )
    const scheduler = build(patch)
    scheduler.start()
    scheduler.drain(2)
    // Cadena degenerada: se limita por MIN_CHAIN_DURATION (0.25 s), no se dispara sin fin.
    const flashes = events.filter((e) => e.kind === 'node')
    expect(flashes.length).toBeLessThanOrEqual(12)
    expect(flashes.length).toBeGreaterThan(0)
    scheduler.stop()
  })

  it('varios nodos Start lanzan cascadas independientes', () => {
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

describe('política de solapamiento', () => {
  function retrigger(voices: number) {
    const patch = patchOf(
      [{ id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }, osc('a')],
      [edge('s', 'a'), edge('a', 'a')],
    )
    const scheduler = build(patch)
    engine.voices = voices
    engine.busy.set('a', 1000) // el nodo sigue sonando siempre
    scheduler.start()
    scheduler.drain(10)
    scheduler.stop()
    return engine.released
  }

  it('se superpone mientras hay presupuesto de voces', () => {
    expect(retrigger(10)).toHaveLength(0)
  })

  it('degrada a reinicio al pasar del 75 % del presupuesto', () => {
    expect(retrigger(60).length).toBeGreaterThan(0)
  })
})
