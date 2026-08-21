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
  ModParams,
  NodeParams,
  OscParams,
  Patch,
  StartParams,
  Step,
} from '../types/patch'
import { connectionFor, EVENT_IN, EVENT_OUT, SIGNAL_LEFT, SIGNAL_RIGHT } from './connections'
import { decodePatch } from './patchCode'
import { randomPatch } from './randomPatch'

export type FlowNodeData = { params: NodeParams }
export type FlowNode = Node<FlowNodeData>
export type FlowEdge = Edge<{ kind: EdgeKind }>

/** Which component draws each kind of cable. One map, so the two cannot drift apart. */
const EDGE_COMPONENT: Record<EdgeKind, string> = {
  event: 'cascade',
  audio: 'signal',
  mod: 'modulation',
}

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * What a copy holds. Its own nodes and only the cables with both ends inside it, so pasting can
 * never produce a cable reaching for something that was left behind.
 */
interface Clipboard {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

interface PatchState {
  bpm: number
  loop: boolean
  masterGain: number
  nodes: FlowNode[]
  edges: FlowEdge[]
  selectedId: string | null
  /**
   * Deliberately outlives loading another patch: roll the dice, find an oscillator worth keeping,
   * roll again, paste it in.
   */
  clipboard: Clipboard | null
  /** How many times the current copy has been pasted, so each one lands clear of the last. */
  pasteRun: number
  /**
   * Bumped whenever the whole patch is replaced rather than edited. The audio side watches it to
   * start the cascade over, since chains in flight belong to nodes that no longer exist.
   */
  patchRun: number

  onNodesChange(changes: NodeChange<FlowNode>[]): void
  onEdgesChange(changes: EdgeChange<FlowEdge>[]): void
  onConnect(connection: Connection): void
  addNode(type: string, position: { x: number; y: number }): void
  removeEdge(id: string): void
  select(id: string | null): void
  updateParams(
    id: string,
    partial: Partial<OscParams & FxParams & DelayParams & StartParams & ModParams>,
  ): void
  setEffect(id: string, effect: EffectKind): void
  updateStep(id: string, index: number, partial: Partial<Step>): void
  setStepCount(id: string, count: number): void
  setBpm(bpm: number): void
  setLoop(loop: boolean): void
  setMasterGain(gain: number): void
  loadPatch(patch: Patch): void
  resetPatch(): void
  randomisePatch(): void
  copySelection(): void
  pasteClipboard(): void
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
export const INITIAL_PATCH_CODE =
  'FGJaABAJBSMEAoUjiuuaDszNV6oJ5QAMfjd-slBjwdPLH11jpANAA0AGGZTmUSggKGAhkPEBdwFAw64ZsQNOALICMRkgIuicJqtoJ5sYL9gGAihZxK3A'

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
        const sideways = e.kind !== 'event'
        // Which side is cosmetic, so it is chosen from the layout rather than stored: the neighbour
        // attaches on the side it already sits on, and the cable stays short.
        const rightwards = (positionOf.get(e.target)?.x ?? 0) >= (positionOf.get(e.source)?.x ?? 0)

        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: sideways ? (rightwards ? SIGNAL_RIGHT : SIGNAL_LEFT) : EVENT_OUT,
          targetHandle: sideways ? (rightwards ? SIGNAL_LEFT : SIGNAL_RIGHT) : EVENT_IN,
          type: EDGE_COMPONENT[e.kind],
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

/** Offset per paste, enough that the copy is obviously a second node rather than a redraw. */
const PASTE_OFFSET = 44

export const usePatchStore = create<PatchState>((set, get) => ({
  masterGain: 0.8,
  ...initialPatch(),
  selectedId: null,
  clipboard: null,
  pasteRun: 0,
  patchRun: 0,

  onNodesChange(changes) {
    set({ nodes: applyNodeChanges(changes, get().nodes) })
  },

  onEdgesChange(changes) {
    set({ edges: applyEdgeChanges(changes, get().edges) })
  },

  onConnect(connection) {
    const { nodes, edges } = get()
    const decided = connectionFor({ nodes, edges }, connection)
    if (!decided) return

    // `decided` rather than `connection`: a cable drawn backwards has already been turned round, so
    // what gets stored is the direction the audio graph needs rather than the direction of the drag.
    const { kind, ...ends } = decided
    set({
      edges: addEdge({ ...ends, type: EDGE_COMPONENT[kind], data: { kind } }, edges) as FlowEdge[],
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
    set({ ...fromPatch(patch), selectedId: null, patchRun: get().patchRun + 1 })
  },

  resetPatch() {
    set({ ...initialPatch(), selectedId: null, patchRun: get().patchRun + 1 })
  },

  randomisePatch() {
    set({
      ...fromPatch(randomPatch()),
      selectedId: null,
      pasteRun: 0,
      patchRun: get().patchRun + 1,
    })
  },

  /**
   * Copies whatever is selected on the canvas, or the node in the inspector if the canvas has no
   * selection of its own.
   *
   * Parameters are cloned rather than referenced: a sequence is an array, so a shallow copy would
   * leave the pasted oscillator sharing steps with the one it came from, and editing either would
   * change both.
   */
  copySelection() {
    const { nodes, edges, selectedId } = get()
    const marked = nodes.filter((n) => n.selected)
    const chosen = marked.length > 0 ? marked : nodes.filter((n) => n.id === selectedId)
    if (chosen.length === 0) return

    const inside = new Set(chosen.map((n) => n.id))
    set({
      clipboard: {
        nodes: chosen.map((n) => ({ ...n, data: { params: structuredClone(n.data.params) } })),
        edges: edges.filter((e) => inside.has(e.source) && inside.has(e.target)),
      },
      pasteRun: 0,
    })
  },

  pasteClipboard() {
    const { clipboard, nodes, edges, pasteRun } = get()
    if (!clipboard || clipboard.nodes.length === 0) return

    const offset = PASTE_OFFSET * (pasteRun + 1)
    const renamed = new Map<string, string>()

    const pasted = clipboard.nodes.map((node) => {
      const id = newId(node.type ?? 'node')
      renamed.set(node.id, id)
      return {
        ...node,
        id,
        position: { x: node.position.x + offset, y: node.position.y + offset },
        // Cloned again on the way out, so pasting twice does not hand both copies one object.
        data: { params: structuredClone(node.data.params) },
        selected: true,
      }
    })

    const rewired = clipboard.edges.map((edge) => ({
      ...edge,
      id: newId('e'),
      source: renamed.get(edge.source) as string,
      target: renamed.get(edge.target) as string,
    }))

    set({
      // The paste becomes the selection, so it can be dragged into place straight away.
      nodes: [...nodes.map((n) => ({ ...n, selected: false })), ...pasted],
      edges: [...edges, ...rewired],
      selectedId: pasted[0].id,
      pasteRun: pasteRun + 1,
    })
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
