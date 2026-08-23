import { snapToScale, type ScaleName } from '../audio/scales'
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
  WarpParams,
} from '../types/patch'
import { connectionFor, EVENT_IN, EVENT_OUT, SIGNAL_LEFT, SIGNAL_RIGHT } from './connections'
import { decodePatch } from './patchCode'
import { randomPatch } from './randomPatch'

export type FlowNodeData = { params: NodeParams }
export type FlowNode = Node<FlowNodeData>
export type FlowEdge = Edge<{ kind: EdgeKind }>

/** Which component draws each kind of cable. One map, so the two cannot drift apart. */
export const EDGE_COMPONENT: Record<EdgeKind, string> = {
  event: 'cascade',
  audio: 'signal',
  mod: 'modulation',
  // Drawn as modulation is: to the side, quietly, as something attached rather than something passing
  // through. What it carries is different; where it sits and what it means to the eye is the same.
  warp: 'modulation',
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
   * Which step of the selected oscillator is being looked at, if any.
   *
   * A second, finer selection rather than a mode. Everything else here is inspected by selecting it, and
   * a step is a smaller thing to select — so the panel shows a step the way it shows a node, and going
   * back up is choosing the node again.
   */
  selectedStep: number | null
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
  /** Looks at one step of a node, selecting the node too if it was not already selected. */
  selectStep(id: string, index: number | null): void
  /** Moves every note of a sequence onto the nearest one its scale allows. */
  fitToScale(id: string, scale: ScaleName, root: number): void
  /**
   * Puts an unwired node into the middle of a cable, if it was dropped on one.
   *
   * Returns whether it did, so the caller can tell a splice from an ordinary move.
   */
  spliceIntoCable(id: string): boolean
  updateParams(
    id: string,
    partial: Partial<OscParams & FxParams & DelayParams & StartParams & ModParams & WarpParams>,
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
 *
 * It also has to be regenerated whenever the format changes, and nothing shouts when it is not: a code
 * the reader cannot make sense of returns null, and the app boots to an empty canvas rather than to an
 * error. The test beside this one is what notices.
 */
export const INITIAL_PATCH_CODE =
  'FGKKIBAJBSMEAoUjgCuuaDszNV6oAnlAAx-AN36yUGPB08sfXWA6QDQANAABhmU5lECggKGAhkPEBdwFAwA64ZsQNOAAsgIxGSAi6JwAmq2gnmxgv2ABgIoWcStw'

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

/** A trigger cable in the shape the canvas wants it. */
function flowEdge(id: string, source: string, target: string): FlowEdge {
  return {
    id,
    source,
    target,
    sourceHandle: EVENT_OUT,
    targetHandle: EVENT_IN,
    type: EDGE_COMPONENT.event,
    data: { kind: 'event' },
  } as FlowEdge
}

/** Roughly a node, for deciding whether one was dropped on a cable. */
const NODE_WIDTH = 200
const NODE_HEIGHT = 120
/** How near a cable a node has to land to be taken as being put into it. */
const SPLICE_REACH = 90

/** How far a point is from a line between two others, which is what "dropped on that cable" means. */
function distanceToSegment(
  point: { x: number; y: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = dx * dx + dy * dy
  if (length === 0) return Math.hypot(point.x - from.x, point.y - from.y)

  // Clamped, so a node far past either end of a short cable is not counted as being on it.
  const along = Math.max(
    0,
    Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length),
  )
  return Math.hypot(point.x - (from.x + along * dx), point.y - (from.y + along * dy))
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
  selectedStep: null,
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
    // Choosing a node drops the step, since a step of another node is not a thing to be looking at —
    // and choosing the same node again is how you climb back out of one.
    set({ selectedId: id, selectedStep: null })
  },

  selectStep(id, index) {
    set({ selectedId: id, selectedStep: index })
  },

  spliceIntoCable(id) {
    /*
     * The gesture that was missing, and what its absence cost.
     *
     * To put a WARP between two nodes you had to delete the cable joining them first, and nothing
     * said so — so it got wired *beside* that cable instead, and then the node underneath fired twice,
     * once through the transform and once around it. A doubled delay is heard as an echo and a doubled
     * transposition is heard as nothing, so it looked like a node that did not work. It was reported as
     * exactly that.
     *
     * Only a node with nothing wired to it at all, which is the rule that makes this safe: dragging a
     * node that is already part of the cascade never rearranges the patch under your hand, and a node
     * you have just added is the only kind that can land in a cable.
     */
    const { nodes, edges } = get()
    const node = nodes.find((n) => n.id === id)
    if (!node) return false

    const wired = edges.some((e) => e.source === id || e.target === id)
    if (wired) return false

    const definition = getDefinition(node.type ?? '')
    // Something with no way in and no way out of the cascade cannot stand in the middle of one.
    if (!definition?.schedule || node.type === 'start') return false

    const centre = (one: FlowNode) => ({
      x: one.position.x + (one.measured?.width ?? NODE_WIDTH) / 2,
      y: one.position.y + (one.measured?.height ?? NODE_HEIGHT) / 2,
    })
    const here = centre(node)

    let best: { id: string; source: string; target: string; away: number } | null = null
    for (const edge of edges) {
      if ((edge.data?.kind ?? 'event') !== 'event') continue
      const from = nodes.find((n) => n.id === edge.source)
      const to = nodes.find((n) => n.id === edge.target)
      if (!from || !to) continue

      const away = distanceToSegment(here, centre(from), centre(to))
      if (away > SPLICE_REACH) continue
      if (!best || away < best.away)
        best = { id: edge.id, source: edge.source, target: edge.target, away }
    }
    if (!best) return false

    set({
      edges: [
        ...edges.filter((e) => e.id !== best.id),
        flowEdge(`${best.source}->${id}`, best.source, id),
        flowEdge(`${id}->${best.target}`, id, best.target),
      ],
    })
    return true
  },

  fitToScale(id, scale, root) {
    /*
     * The one place a scale is allowed to change notes already written.
     *
     * Because it was asked for. A scale that quantised on playback would be the same arithmetic and a
     * quite different thing: the bars would show one sequence and the speakers would play another, and
     * this instrument's whole bargain is that you see what you hear. Done here it happens once, visibly,
     * and undo covers it like any other gesture.
     */
    set({
      nodes: get().nodes.map((n) => {
        if (n.id !== id) return n
        const params = n.data.params as OscParams
        const steps = params.steps.map((step) => ({
          ...step,
          note: snapToScale(step.note, scale, root),
        }))
        return { ...n, data: { params: { ...params, steps } } }
      }),
    })
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
    set({ ...fromPatch(patch), selectedId: null, selectedStep: null, patchRun: get().patchRun + 1 })
  },

  resetPatch() {
    set({ ...initialPatch(), selectedId: null, selectedStep: null, patchRun: get().patchRun + 1 })
  },

  randomisePatch() {
    set({
      ...fromPatch(randomPatch()),
      selectedId: null,
      selectedStep: null,
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
