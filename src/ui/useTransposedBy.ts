/**
 * How many steps a node is being moved by, from wherever the transforms above it are.
 *
 * Its own hook because it is a fact about the whole patch rather than about the node, and a node has no
 * way to know what is above it — the graph is edges, and a component only ever sees itself.
 */

import { useMemo } from 'react'
import { transposeByNode } from '../state/transpose'
import { usePatchStore } from '../state/patchStore'

export function useTransposedBy(id: string): number {
  const nodes = usePatchStore((s) => s.nodes)
  const edges = usePatchStore((s) => s.edges)

  // Walked once per change of the graph rather than once per node: with a transform at the top of a
  // wide patch, every oscillator asking separately would be the same walk repeated forty times.
  const table = useMemo(
    () =>
      transposeByNode(
        nodes.map((n) => ({
          id: n.id,
          type: n.type ?? '',
          position: n.position,
          params: n.data.params,
        })),
        edges.map((e) => ({
          id: e.id,
          kind: e.data?.kind ?? 'event',
          source: e.source,
          target: e.target,
        })),
      ),
    [nodes, edges],
  )

  return table.get(id) ?? 0
}
