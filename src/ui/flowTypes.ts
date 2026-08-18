import { CascadeEdge } from './CascadeEdge'
import { DelayNode, FxNode, OscNode, StartNode } from './nodes'
import { SignalEdge } from './SignalEdge'

/**
 * The maps React Flow uses to resolve `node.type` and `edge.type`.
 * They live in their own file so component modules only export components and hot reload
 * keeps working.
 */
export const nodeTypes = {
  start: StartNode,
  osc: OscNode,
  fx: FxNode,
  delay: DelayNode,
}

export const edgeTypes = {
  cascade: CascadeEdge,
  signal: SignalEdge,
}
