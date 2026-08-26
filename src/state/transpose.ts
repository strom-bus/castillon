/**
 * What every WARP above a node adds up to (PLAN §18.18).
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

import type { PatchEdge, PatchNode, WarpParams } from '../types/patch'

/** How many steps each node is being moved by, for every node a trigger can reach. */
export function transposeByNode(nodes: PatchNode[], edges: PatchEdge[]): Map<string, number> {
  /*
   * Where a trigger goes next, **in the direction it is actually travelling**.
   *
   * Two maps rather than one, because a cascade has two directions now. A descending trigger crosses an
   * event cable from its source to its target, as it always did. A climbing one crosses the same cable
   * the other way — so the node it reaches next is the cable's *source*, and following the map for the
   * other direction walks it backwards.
   *
   * This walked source to target only, which was right for as long as the fire could only fall. On a
   * patch wired from the IGNITE's upward port it credited a warp to the branch hanging **below** the
   * node it is attached to, which the fire never visits, and to nothing above, which it does. The notes
   * were bent correctly the whole time — the engine carries a warp along the trigger — and the canvas
   * said they were not, which is the quiet half of a disagreement between two computations of one fact.
   */
  const down = new Map<string, string[]>()
  const up = new Map<string, string[]>()
  const attached = new Map<string, string[]>()
  const add = (into: Map<string, string[]>, from: string, to: string) => {
    const list = into.get(from)
    if (list) list.push(to)
    else into.set(from, [to])
  }

  for (const edge of edges) {
    if (edge.kind === 'event') {
      add(down, edge.source, edge.target)
      add(up, edge.target, edge.source)
    } else if (edge.kind === 'warp') {
      add(attached, edge.target, edge.source)
    }
  }

  /** The cables that *start* a climb, which are crossed the ordinary way and turn the walk around. */
  const climbs = new Set(
    edges.filter((edge) => edge.kind === 'event' && edge.up === true).map((e) => e.id),
  )

  /*
   * Which transforms reach each node, rather than what they come to.
   *
   * A set and not a running total, because a patch may loop back on itself and a total would add the
   * same transform again on every lap — a two-node cycle read as thirty-two steps of a transform set to
   * one. What is being asked is which transforms apply, and a transform applies to a node or it does
   * not; going round twice does not make it apply twice.
   */
  const reaching = new Map<string, Set<string>>()
  const spread = (id: string, from: Set<string>): boolean => {
    const here = reaching.get(id) ?? new Set<string>()
    const before = here.size
    for (const one of from) here.add(one)
    for (const one of attached.get(id) ?? []) here.add(one)
    reaching.set(id, here)
    return here.size !== before
  }

  /*
   * A walk that carries its direction with it, since which way a trigger is going is a fact about the
   * trigger and not about the node it is at — the same thing the scheduler and the depth colours both
   * say, and the third place that has to agree with them.
   */
  type Step = { id: string; climbing: boolean }
  let frontier: Step[] = nodes
    .filter((node) => node.type === 'start')
    .map((node) => ({ id: node.id, climbing: false }))
  for (const step of frontier) spread(step.id, new Set())

  for (let depth = 0; depth < 64 && frontier.length > 0; depth++) {
    const next: Step[] = []
    for (const step of frontier) {
      const here = reaching.get(step.id) ?? new Set<string>()
      for (const edge of edges) {
        if (edge.kind !== 'event') continue
        /*
         * Which cable is next, and which way the fire is going after it.
         *
         * Descending, a trigger crosses a cable from its source to its target — and a cable drawn from
         * the IGNITE's upward port is crossed the ordinary way too. What that cable changes is
         * everything *after* it: from there on the fire climbs, and climbing means crossing ordinary
         * cables the other way round, from target to source.
         */
        const onward = step.climbing
          ? edge.target === step.id
            ? edge.source
            : null
          : edge.source === step.id
            ? edge.target
            : null
        if (onward === null) continue
        const climbing = step.climbing || climbs.has(edge.id)
        if (spread(onward, here)) next.push({ id: onward, climbing })
      }
    }
    frontier = next
  }

  const steps = new Map(
    nodes
      .filter((node) => node.type === 'warp')
      .map((node) => [node.id, Math.round((node.params as WarpParams).transpose ?? 0)]),
  )

  const carried = new Map<string, number>()
  for (const [id, applies] of reaching) {
    let total = 0
    for (const one of applies) total += steps.get(one) ?? 0
    carried.set(id, total)
  }
  return carried
}

/**
 * Why a transform may be doing nothing, or null if it is doing something.
 *
 * A much shorter question than it used to be. Standing in the cascade, a transform could be wired beside
 * the cable it was meant to replace instead of in place of it, and then the node below fired twice —
 * once through it and once around it — with the untransposed pass masking the moved one. Attached to a
 * node instead, that failure cannot be built: there is no cable to go around.
 *
 * What is left is the honest kind of nothing. It is attached to nothing, or what it is attached to has
 * no oscillator at or below it, so there are no notes for it to move.
 */
export function warpDoingNothing(
  nodes: PatchNode[],
  edges: PatchEdge[],
  id: string,
): string | null {
  const attached = edges.filter((edge) => edge.kind === 'warp' && edge.source === id)
  if (attached.length === 0) return 'it is not attached to anything'

  const children = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.kind !== 'event') continue
    const list = children.get(edge.source)
    if (list) list.push(edge.target)
    else children.set(edge.source, [edge.target])
  }

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const reached = new Set<string>()
  let frontier = attached.map((edge) => edge.target)
  for (let depth = 0; depth < 64 && frontier.length > 0; depth++) {
    const next: string[] = []
    for (const at of frontier) {
      if (reached.has(at)) continue
      reached.add(at)
      next.push(...(children.get(at) ?? []))
    }
    frontier = next
  }

  const sounds = [...reached].some((one) => byId.get(one)?.type === 'osc')
  return sounds ? null : 'nothing below what it is attached to makes a note'
}
