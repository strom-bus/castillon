import { CascadeEdge } from './CascadeEdge'
import { Osc4Node, StartNode } from './nodes'

/**
 * Los mapas que React Flow usa para resolver `node.type` y `edge.type`.
 * Viven en su propio archivo para que los módulos de componentes sólo exporten componentes
 * y el hot reload siga funcionando.
 */
export const nodeTypes = {
  start: StartNode,
  osc4: Osc4Node,
}

export const edgeTypes = {
  cascade: CascadeEdge,
}
