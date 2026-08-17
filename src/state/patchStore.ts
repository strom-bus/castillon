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
import type { DelayParams, EdgeKind, NodeParams, Osc4Params, Patch, Step } from '../types/patch'
import { decodePatch } from './patchCode'

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
  removeEdge(id: string): void
  select(id: string | null): void
  updateParams(id: string, partial: Partial<Osc4Params & DelayParams>): void
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
 * The starting patch, held as its own patch code rather than built by hand: two cascades, five
 * oscillators across four waveforms and a delay, so Play does something interesting immediately.
 *
 * To change it, build the patch in the app, copy the PATCH CODE field and paste it here.
 */
const INITIAL_PATCH_CODE =
  'GMQgJRSYIBQqyXQEBQ8Jn6vvfU8nlAA5kmfBWmqcvx_1_X50gGgAWyDIEBQ8Jn0_mfR9QQFDAQyPEBdwF2SZAgKHhY-B-n8HiyAjEyQEXJkmWsCh4WPwff-x4MUW5KDu'

/** Store shape of a patch. Shared by the initial state, RESET and loading a code. */
function fromPatch(patch: Patch): {
  bpm: number
  loop: boolean
  nodes: FlowNode[]
  edges: FlowEdge[]
} {
  return {
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
  }
}

function initialPatch(): ReturnType<typeof fromPatch> {
  const patch = decodePatch(INITIAL_PATCH_CODE)
  // An empty canvas is a poor default, but a broken constant must not stop the app booting.
  return patch ? fromPatch(patch) : { bpm: 120, loop: true, nodes: [], edges: [] }
}

export const usePatchStore = create<PatchState>((set, get) => ({
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

  removeEdge(id) {
    set({ edges: get().edges.filter((e) => e.id !== id) })
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
    set({ ...fromPatch(patch), selectedId: null })
  },

  resetPatch() {
    set({ ...initialPatch(), selectedId: null })
  },

  clear() {
    set({ nodes: [], edges: [], selectedId: null })
  },
}))

/** The only parts of the store a patch is made of. */
export type PatchSnapshot = Pick<PatchState, 'bpm' | 'loop' | 'nodes' | 'edges'>

/** Serialisable view of the store: what the scheduler, the patch code and autosave consume. */
export function toPatch(state: PatchSnapshot = usePatchStore.getState()): Patch {
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
