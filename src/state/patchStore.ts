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
import { getEffect, labelOf } from '../audio/effects'
import { getDefinition, normaliseStepCount, resizeSteps } from '../nodes/registry'
import { MAX_BPM, MIN_BPM } from '../types/patch'
import type {
  DelayParams,
  EdgeKind,
  EffectKind,
  FxParams,
  NodeParams,
  OscParams,
  Patch,
  Step,
} from '../types/patch'
import {
  AUDIO_LEFT,
  AUDIO_RIGHT,
  canConnect,
  connectionKind,
  EVENT_IN,
  EVENT_OUT,
} from './connections'
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
  updateParams(id: string, partial: Partial<OscParams & FxParams & DelayParams>): void
  setEffect(id: string, effect: EffectKind): void
  updateStep(id: string, index: number, partial: Partial<Step>): void
  setStepCount(id: string, count: number): void
  setBpm(bpm: number): void
  setLoop(loop: boolean): void
  setMasterGain(gain: number): void
  loadPatch(patch: Patch): void
  resetPatch(): void
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
  'FGIQEgpMEAoSsl0BAUPDmg8Zn6vvfU8nlAAsyTPgrTVGPB55fj_r-vzpANAAmyDIEBQ8CtQpmfT-Z9H1BAUMBDI8QF3ATskyBAUPBcMKbHwP0_g8WQEYmSAi4mSZawKHg2goNj8H3_seDARQs4lbgA'

/** Types that have been renamed. A patch saved under the old name still loads. */
const RENAMED_TYPES: Record<string, string> = {
  osc4: 'osc',
}

/**
 * Store shape of a patch. Shared by the initial state, RESET and loading a code.
 *
 * Nodes of a type the registry does not know are dropped, along with their cables. React Flow
 * renders an unrecognised type as its own default node — a blank white box with no ports — and
 * a patch that silently turns into blank boxes is worse than one that arrives short.
 */
function fromPatch(patch: Patch): {
  bpm: number
  loop: boolean
  nodes: FlowNode[]
  edges: FlowEdge[]
} {
  const nodes: FlowNode[] = []
  const kept = new Set<string>()

  for (const node of patch.nodes) {
    const type = RENAMED_TYPES[node.type] ?? node.type
    const definition = getDefinition(type)
    if (!definition) continue
    kept.add(node.id)
    nodes.push({
      id: node.id,
      type,
      position: node.position,
      // Merged over the defaults, so a patch saved before a parameter existed still carries a
      // value for it instead of leaving holes for every reader to guard against.
      data: { params: { ...definition.defaults(), ...node.params } },
    })
  }

  const positionOf = new Map(nodes.map((n) => [n.id, n.position]))

  return {
    bpm: patch.bpm,
    loop: patch.loop,
    nodes,
    edges: patch.edges
      .filter((e) => kept.has(e.source) && kept.has(e.target))
      .map((e) => {
        // Handles have to be named explicitly. A patch code stores which nodes a cable joins but
        // not which port, and an oscillator has three source handles — so React Flow would bind
        // an unnamed cable to whichever it found first, which is how event cables started coming
        // out of the audio ports.
        const audio = e.kind === 'audio'
        // Which side is cosmetic, so it is chosen from the layout rather than stored: the effect
        // attaches on the side it already sits on, and the cable stays short.
        const rightwards = (positionOf.get(e.target)?.x ?? 0) >= (positionOf.get(e.source)?.x ?? 0)

        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: audio ? (rightwards ? AUDIO_RIGHT : AUDIO_LEFT) : EVENT_OUT,
          targetHandle: audio ? (rightwards ? AUDIO_LEFT : AUDIO_RIGHT) : EVENT_IN,
          type: audio ? 'signal' : 'cascade',
          data: { kind: e.kind },
        }
      }),
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
    const { nodes, edges } = get()
    if (!canConnect({ nodes, edges }, connection)) return

    const kind = connectionKind(connection) as EdgeKind
    set({
      edges: addEdge(
        { ...connection, type: kind === 'audio' ? 'signal' : 'cascade', data: { kind } },
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
          ? { ...n, data: { params: { ...(n.data.params as OscParams), ...partial } } }
          : n,
      ),
    })
  },

  /**
   * Switching effect adopts the new one's starting values, except for parameters that mean the same
   * thing in both — those carry over.
   *
   * "The same thing" is decided by the label, since that is where the meaning is recorded. Moving
   * from chorus to phaser keeps the rate you set, because both call it Rate. It does not keep the
   * cutoff, because the chorus means Tone by it and the phaser means Centre, and a phaser sweeping
   * around a reverb's tone setting is not a phaser. And moving from reverb to tremolo does not
   * leave a tremolo running at a reverb's depth, which is a wobble nobody notices.
   */
  setEffect(id, effect) {
    set({
      nodes: get().nodes.map((n) => {
        if (n.id !== id) return n
        const params = n.data.params as FxParams
        const previous = getEffect(params.effect)
        const next = getEffect(effect)

        const adopted: Partial<FxParams> = {}
        for (const [key, value] of Object.entries(next?.defaults ?? {})) {
          const field = key as keyof FxParams
          const shared =
            previous?.params.includes(field) && labelOf(previous, field) === labelOf(next, field)
          if (shared) continue
          Object.assign(adopted, { [field]: value })
        }

        return { ...n, data: { params: { ...params, ...adopted, effect } } }
      }),
    })
  },

  updateStep(id, index, partial) {
    set({
      nodes: get().nodes.map((n) => {
        if (n.id !== id) return n
        const params = n.data.params as OscParams
        const steps = params.steps.map((s, i) => (i === index ? { ...s, ...partial } : s))
        return { ...n, data: { params: { ...params, steps } } }
      }),
    })
  },

  setStepCount(id, count) {
    set({
      nodes: get().nodes.map((n) => {
        if (n.id !== id) return n
        const params = n.data.params as OscParams
        return {
          ...n,
          data: {
            params: { ...params, steps: resizeSteps(params.steps, normaliseStepCount(count)) },
          },
        }
      }),
    })
  },

  setBpm(bpm) {
    set({ bpm: Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm))) })
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
      type: n.type ?? 'osc',
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
