/**
 * Undo and redo for the patch, wired to the store without touching a single action.
 *
 * The label of a step is **derived** rather than declared. `record` needs to know which consecutive
 * changes belong to one gesture (§16.1), and the obvious way to supply that is a name passed by each
 * of the sixteen actions — sixteen edits, and one of them eventually forgotten. Comparing the state
 * before and after says the same thing without anyone having to remember: positions moved is a move,
 * one node's parameters changed is that node's parameters, anything else is structure.
 *
 * A gesture ends where the user said it does — on release. A document-level `pointerup` seals the
 * history, which is literally "from pressing the mouse to letting go" and needs no per-control
 * wiring. `keyup` does the same for the arrow keys on a field.
 */
import { create } from 'zustand'
import type { EdgeKind, NodeParams } from '../types/patch'
import { usePatchStore, type FlowEdge, type FlowNode } from '../state/patchStore'
import { canRedo, canUndo, createHistory, record, redo, seal, undo, type History } from './history'

/**
 * The part of the store a step is about.
 *
 * Not `Patch`, which would mean a `toPatch`/`fromPatch` round trip on every undo; and deliberately
 * not the store's nodes as they are, because React Flow keeps `selected` and `dragging` on them and
 * both change constantly. Comparing those would record an entry for every click on the canvas.
 */
export interface PatchSnap {
  nodes: { id: string; type?: string; x: number; y: number; params: NodeParams }[]
  edges: {
    id: string
    kind?: EdgeKind
    source: string
    target: string
    from?: string
    to?: string
  }[]
  bpm: number
  loop: boolean
}

function snapOf(nodes: FlowNode[], edges: FlowEdge[], bpm: number, loop: boolean): PatchSnap {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      x: node.position.x,
      y: node.position.y,
      params: node.data.params,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      kind: edge.data?.kind,
      source: edge.source,
      target: edge.target,
      from: edge.sourceHandle ?? undefined,
      to: edge.targetHandle ?? undefined,
    })),
    bpm,
    loop,
  }
}

function currentSnap(): PatchSnap {
  const state = usePatchStore.getState()
  return snapOf(state.nodes, state.edges, state.bpm, state.loop)
}

/** Structural comparison. Cheap enough at this size, and it cannot miss a field the way a hand-written comparison would. */
function same(a: PatchSnap, b: PatchSnap): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * What kind of change this was, in just enough detail to tell one gesture from another.
 *
 * The distinctions that matter: a drag of a node is one thing however many frames it takes, a slider
 * on *this* node is a different gesture from a slider on that one, and anything that adds, removes or
 * rewires is a step on its own.
 */
export function labelFor(before: PatchSnap, after: PatchSnap): string {
  if (before.bpm !== after.bpm) return 'bpm'
  if (before.loop !== after.loop) return 'loop'

  const structural =
    before.nodes.length !== after.nodes.length ||
    before.edges.length !== after.edges.length ||
    JSON.stringify(before.edges) !== JSON.stringify(after.edges) ||
    before.nodes.some((node, i) => node.id !== after.nodes[i]?.id)
  if (structural) {
    // The shape itself, not the word "structure". Structural acts are always discrete — one add, one
    // delete, one paste, one patch loaded — so two in a row must never merge, and a shared label is
    // exactly what would merge them. Adding a node and then resetting did, and the reset became
    // unreachable by undo.
    const shape = [...after.nodes.map((node) => node.id), '|', ...after.edges.map((e) => e.id)]
    return `structure:${shape.join(',')}`
  }

  const moved = before.nodes.some(
    (node, i) => node.x !== after.nodes[i].x || node.y !== after.nodes[i].y,
  )
  if (moved) return 'move'

  const changed = before.nodes.find(
    (node, i) => JSON.stringify(node.params) !== JSON.stringify(after.nodes[i].params),
  )
  return changed ? `params:${changed.id}` : 'other'
}

interface HistoryState {
  history: History<PatchSnap>
  canUndo: boolean
  canRedo: boolean
  undo(): void
  redo(): void
}

/**
 * True while an undo is being applied, so the store change it causes is not recorded as a new step —
 * which would append the state just left and make undo unable to go any further back.
 */
let applying = false

function apply(snap: PatchSnap): void {
  applying = true
  try {
    const alive = new Set(snap.nodes.map((node) => node.id))
    const selectedId = usePatchStore.getState().selectedId
    usePatchStore.setState({
      nodes: snap.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: { x: node.x, y: node.y },
        data: { params: node.params },
      })) as FlowNode[],
      edges: snap.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.from,
        targetHandle: edge.to,
        data: edge.kind ? { kind: edge.kind } : undefined,
        type: 'cascade',
      })) as FlowEdge[],
      bpm: snap.bpm,
      loop: snap.loop,
      // A selection pointing at a node that no longer exists would leave the inspector describing
      // something that is not on the canvas.
      selectedId: selectedId && alive.has(selectedId) ? selectedId : null,
    })
  } finally {
    applying = false
  }
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  history: createHistory(currentSnap()),
  canUndo: false,
  canRedo: false,

  undo() {
    const next = undo(get().history)
    if (next === get().history) return
    apply(next.present.state)
    set({ history: next, canUndo: canUndo(next), canRedo: canRedo(next) })
  },

  redo() {
    const next = redo(get().history)
    if (next === get().history) return
    apply(next.present.state)
    set({ history: next, canUndo: canUndo(next), canRedo: canRedo(next) })
  },
}))

/**
 * Starts watching the patch. Called once; returns a teardown for tests.
 *
 * The history is reset to whatever the patch is at this moment rather than to an empty one, so the
 * first undo of a session steps back to how the patch was found and not to nothing.
 */
export function installHistory(): () => void {
  useHistoryStore.setState({
    history: createHistory(currentSnap()),
    canUndo: false,
    canRedo: false,
  })

  const unsubscribe = usePatchStore.subscribe(() => {
    if (applying) return
    const { history } = useHistoryStore.getState()
    const snap = currentSnap()
    const next = record(history, snap, labelFor(history.present.state, snap), same)
    if (next === history) return
    useHistoryStore.setState({ history: next, canUndo: canUndo(next), canRedo: canRedo(next) })
  })

  const close = () => {
    const { history } = useHistoryStore.getState()
    const sealed = seal(history)
    if (sealed !== history) useHistoryStore.setState({ history: sealed })
  }

  window.addEventListener('pointerup', close)
  window.addEventListener('keyup', close)

  return () => {
    unsubscribe()
    window.removeEventListener('pointerup', close)
    window.removeEventListener('keyup', close)
  }
}
