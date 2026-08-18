interface NodeLike {
  id: string
  type?: string
}

/**
 * The node's number within its own kind: the first oscillator is 1, the second 2, and effects and
 * delays each count from 1 again.
 *
 * Derived from the order nodes are held in rather than stored on the node. That order is creation
 * order and the patch code preserves it, so the numbers survive a round trip without costing the
 * format anything and without a counter to keep consistent.
 *
 * The trade-off: deleting a node renumbers the ones after it. In exchange the numbers stay dense,
 * with no gaps to explain.
 */
export function nodeOrdinal(nodes: NodeLike[], id: string): number {
  const kind = nodes.find((n) => n.id === id)?.type
  if (kind === undefined) return 0

  let seen = 0
  for (const node of nodes) {
    if (node.type !== kind) continue
    seen++
    if (node.id === id) return seen
  }
  return 0
}

/** Two digits, so a column of nodes reads as a column. */
export function formatOrdinal(ordinal: number): string {
  return String(ordinal).padStart(2, '0')
}
