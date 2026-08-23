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

/**
 * Why a transform may be doing nothing, or null if it is doing something.
 *
 * It has two ways of failing in silence, and one of them is worse than useless. Left with nothing below
 * it, it simply does not apply — that much is at least quiet in an honest way. But wired *beside* the
 * cable it was meant to replace, the node underneath is triggered twice: once through the transform and
 * once around it, and the untransposed one masks the other. The patch sounds exactly as it did, and
 * everything on screen says the transform is working.
 *
 * A delay has the same failure and gets away with it, because a doubled delay is heard as an echo. A
 * doubled transposition is heard as nothing at all, which is why this exists — the same habit the MOD
 * panel already has of saying why a cable is not doing what its owner expects.
 */
export function transformDoingNothing(
  nodes: PatchNode[],
  edges: PatchEdge[],
  id: string,
): string | null {
  const children = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.kind !== 'event') continue
    const list = children.get(edge.source)
    if (list) list.push(edge.target)
    else children.set(edge.source, [edge.target])
  }

  if (!children.get(id)?.length) return 'nothing is wired below it'

  /** Everything the transform reaches, which is what it is meant to be moving. */
  const below = new Set<string>()
  let frontier = children.get(id) ?? []
  for (let depth = 0; depth < 64 && frontier.length > 0; depth++) {
    const next: string[] = []
    for (const at of frontier) {
      if (below.has(at)) continue
      below.add(at)
      next.push(...(children.get(at) ?? []))
    }
    frontier = next
  }

  /** And everything a trigger can reach without going through it, which is what it is not. */
  const around = new Set<string>()
  frontier = nodes.filter((node) => node.type === 'start').map((node) => node.id)
  for (let depth = 0; depth < 64 && frontier.length > 0; depth++) {
    const next: string[] = []
    for (const at of frontier) {
      if (around.has(at) || at === id) continue
      around.add(at)
      next.push(...(children.get(at) ?? []))
    }
    frontier = next
  }

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const doubled = [...below].filter((one) => around.has(one) && byId.get(one)?.type === 'osc')
  if (doubled.length > 0) {
    return 'an oscillator below it is also triggered without passing through it, so it plays twice — once moved and once not'
  }

  return null
}
