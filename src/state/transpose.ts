/**
 * What every TRANSFORM above a node adds up to (PLAN §18.18).
 *
 * A transform changes what its whole branch plays, which is the point of it being a node — and it is
 * also the danger. An oscillator three levels down sounds moved with nothing on it saying why, and a
 * delay has the same property while being obvious about it, since a shift in time is heard from where it
 * came. A shift in pitch is silent about its cause.
 *
 * So the canvas answers the question before it is asked: an oscillator under one shows what it is being
 * moved by. This is the arithmetic behind that, kept out of the engine because the engine already knows —
 * it accumulates the same number as the trigger travels — and this is for the reader instead.
 */

import type { Patch, PatchEdge, PatchNode, TransformParams } from '../types/patch'

/** How many steps each node is being moved by, for every node a trigger can reach. */
export function transposeByNode(nodes: PatchNode[], edges: PatchEdge[]): Map<string, number> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const children = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.kind !== 'event') continue
    const list = children.get(edge.source)
    if (list) list.push(edge.target)
    else children.set(edge.source, [edge.target])
  }

  const carried = new Map<string, number>()
  let frontier = nodes
    .filter((node) => node.type === 'start')
    .map((node) => ({ id: node.id, at: 0 }))
  for (const one of frontier) carried.set(one.id, 0)

  /*
   * Walked breadth-first with a depth cap rather than recursively, for the same reason the scheduler
   * does it: a patch may contain a cycle, and a reader of a cycle should get a drawing rather than a
   * hung tab. Where two branches meet at different offsets the larger wins, which is the honest thing to
   * show — it says the note may be moved that far without claiming to know which pass you are hearing.
   */
  for (let depth = 0; depth < 64 && frontier.length > 0; depth++) {
    const next: Array<{ id: string; at: number }> = []
    for (const { id, at } of frontier) {
      const node = byId.get(id)
      const adds =
        node?.type === 'transform' ? Math.round((node.params as TransformParams).transpose ?? 0) : 0
      for (const child of children.get(id) ?? []) {
        const total = at + adds
        const known = carried.get(child)
        if (known !== undefined && Math.abs(known) >= Math.abs(total)) continue
        carried.set(child, total)
        next.push({ id: child, at: total })
      }
    }
    frontier = next
  }

  return carried
}

/** The same, from a whole patch. */
export function transposeIn(patch: Patch): Map<string, number> {
  return transposeByNode(patch.nodes, patch.edges)
}
