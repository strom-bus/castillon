import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import { create } from 'zustand'
import { getDefinition } from '../nodes/registry'
import type { EdgeKind, NodeParams, Osc4Params, Patch, Step } from '../types/patch'

export type FlowNodeData = { params: NodeParams }
export type FlowNode = Node<FlowNodeData>
export type FlowEdge = Edge<{ kind: EdgeKind }>

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

interface PatchState {
  bpm: number
  loop: boolean
  masterGain: number
  nodes: FlowNode[]
  edges: FlowEdge[]
  selectedId: string | null

  onNodesChange(changes: NodeChange<FlowNode>[]): void
  onEdgesChange(changes: EdgeChange<FlowEdge>[]): void
  onConnect(connection: Connection): void
  addNode(type: string, position: { x: number; y: number }): void
  select(id: string | null): void
  updateParams(id: string, partial: Partial<Osc4Params>): void
  updateStep(id: string, index: number, partial: Partial<Step>): void
  setBpm(bpm: number): void
  setLoop(loop: boolean): void
  setMasterGain(gain: number): void
  loadPatch(patch: Patch): void
  resetPatch(): void
  clear(): void
}

function makeNode(type: string, position: { x: number; y: number }, id = newId(type)): FlowNode {
  const definition = getDefinition(type)
  return {
    id,
    type,
    position,
    data: { params: definition ? definition.defaults() : {} },
  }
}

/**
 * Patch inicial: algo que ya suena al pulsar Play, en vez de un lienzo vacío.
 * Dispuesto en vertical, que es como fluye la cascada: de arriba hacia abajo.
 */
function initialPatch(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const start = makeNode('start', { x: 300, y: 20 })
  const a = makeNode('osc4', { x: 260, y: 130 })
  const b = makeNode('osc4', { x: 120, y: 320 })
  const c = makeNode('osc4', { x: 420, y: 320 })
  const bParams = b.data.params as Osc4Params
  bParams.steps = [55, 59, 62, 67].map((note) => ({ note, active: true, velocity: 1 }))
  const cParams = c.data.params as Osc4Params
  cParams.steps = [36, 43, 36, 41].map((note) => ({ note, active: true, velocity: 1 }))
  cParams.division = '1/4'
  return {
    nodes: [start, a, b, c],
    edges: [
      { id: newId('e'), source: start.id, target: a.id, type: 'cascade', data: { kind: 'event' } },
      { id: newId('e'), source: a.id, target: b.id, type: 'cascade', data: { kind: 'event' } },
      { id: newId('e'), source: a.id, target: c.id, type: 'cascade', data: { kind: 'event' } },
    ],
  }
}

export const usePatchStore = create<PatchState>((set, get) => ({
  bpm: 120,
  loop: true,
  masterGain: 0.8,
  ...initialPatch(),
  selectedId: null,

  onNodesChange(changes) {
    set({ nodes: applyNodeChanges(changes, get().nodes) })
  },

  onEdgesChange(changes) {
    set({ edges: applyEdgeChanges(changes, get().edges) })
  },

  onConnect(connection) {
    const { source, target } = connection
    if (!source || !target || source === target) return
    const edges = get().edges
    if (edges.some((e) => e.source === source && e.target === target)) return
    set({
      edges: addEdge(
        { ...connection, type: 'cascade', data: { kind: 'event' as EdgeKind } },
        edges,
      ) as FlowEdge[],
    })
  },

  addNode(type, position) {
    const node = makeNode(type, position)
    set({ nodes: [...get().nodes, node], selectedId: node.id })
  },

  select(id) {
    set({ selectedId: id })
  },

  updateParams(id, partial) {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id
          ? { ...n, data: { params: { ...(n.data.params as Osc4Params), ...partial } } }
          : n,
      ),
    })
  },

  updateStep(id, index, partial) {
    set({
      nodes: get().nodes.map((n) => {
        if (n.id !== id) return n
        const params = n.data.params as Osc4Params
        const steps = params.steps.map((s, i) => (i === index ? { ...s, ...partial } : s))
        return { ...n, data: { params: { ...params, steps } } }
      }),
    })
  },

  setBpm(bpm) {
    set({ bpm: Math.min(300, Math.max(20, Math.round(bpm))) })
  },

  setLoop(loop) {
    set({ loop })
  },

  setMasterGain(masterGain) {
    set({ masterGain })
  },

  loadPatch(patch) {
    set({
      bpm: patch.bpm,
      loop: patch.loop,
      nodes: patch.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: { params: n.params },
      })),
      edges: patch.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'cascade',
        data: { kind: e.kind },
      })),
      selectedId: null,
    })
  },

  resetPatch() {
    set({ ...initialPatch(), selectedId: null })
  },

  clear() {
    set({ nodes: [], edges: [], selectedId: null })
  },
}))

/** Vista serializable del store: lo que consumen el scheduler y la persistencia. */
export function toPatch(state: PatchState = usePatchStore.getState()): Patch {
  return {
    version: 1,
    bpm: state.bpm,
    loop: state.loop,
    nodes: state.nodes.map((n) => ({
      id: n.id,
      type: n.type ?? 'osc4',
      position: n.position,
      params: n.data.params,
    })),
    edges: state.edges.map((e) => ({
      id: e.id,
      kind: e.data?.kind ?? 'event',
      source: e.source,
      target: e.target,
    })),
  }
}
