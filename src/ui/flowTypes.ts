import { CascadeEdge } from './CascadeEdge'
import { ModEdge } from './ModEdge'
import { FmNode, FxNode, HoldNode, ModNode, OscNode, SenseNode, StartNode, WarpNode } from './nodes'
import { SignalEdge } from './SignalEdge'
import { WarpEdge } from './WarpEdge'

/**
 * The maps React Flow uses to resolve `node.type` and `edge.type`.
 * They live in their own file so component modules only export components and hot reload
 * keeps working.
 */
export const nodeTypes = {
  start: StartNode,
  osc: OscNode,
  fx: FxNode,
  mod: ModNode,
  hold: HoldNode,
  warp: WarpNode,
  sense: SenseNode,
  fm: FmNode,
}

export const edgeTypes = {
  cascade: CascadeEdge,
  signal: SignalEdge,
  modulation: ModEdge,
  warp: WarpEdge,
}
