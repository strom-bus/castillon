import { CascadeEdge } from './CascadeEdge'
import { Osc4Node, StartNode } from './nodes'

/**
 * The maps React Flow uses to resolve `node.type` and `edge.type`.
 * They live in their own file so component modules only export components and hot reload
 * keeps working.
 */
export const nodeTypes = {
  start: StartNode,
  osc4: Osc4Node,
}

export const edgeTypes = {
  cascade: CascadeEdge,
}
