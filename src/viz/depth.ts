import { createContext, useContext } from 'react'

/**
 * Cascade colouring: fluorescent green at the source, hot orange at the deepest branch.
 *
 * Depth is structural, not runtime: a breadth-first walk from the Start nodes. That keeps the
 * colour stable between passes instead of flickering, and lets the patch read as a map even
 * when stopped.
 *
 * The scale is continuous rather than one flat colour per level. Each node spans the first half
 * of its level and the cable leaving it spans the second half, so the hue flows without seams
 * from one node, down its cable, and into the next.
 */

export interface DepthInfo {
  /** Distance from each node to the nearest Start. Unreachable nodes are absent. */
  depths: Map<string, number>
  max: number
}

export const EMPTY_DEPTHS: DepthInfo = { depths: new Map(), max: 0 }

export const DepthContext = createContext<DepthInfo>(EMPTY_DEPTHS)

const UNREACHABLE_COLOR = 'var(--muted)'

/** How much of a level the node body covers; the cable covers the rest. */
const NODE_SPAN = 0.55

interface NodeLike {
  id: string
  type?: string
}

interface EdgeLike {
  source: string
  target: string
  data?: { kind?: string; up?: boolean }
}

/**
 * Where a wave can go from a node, and which way it is going when it gets there.
 *
 * Depth is *distance from the Ignite along the wave*, and a wave can run either way — so this walks the
 * ordinary cables forward for a descent and backward for a climb. Written as one traversal carrying a
 * direction rather than two, because the two would have to agree about what a step is and there is only
 * one answer.
 *
 * The first version of this simply skipped upward cables, which was wrong twice over: an Ignite whose
 * only cable was an upward one had no children at all, so it fell out of the map and read as
 * *disconnected*; and the branch it fires had no path from any start, so a whole working cascade came
 * out grey.
 */
interface Reach {
  id: string
  up: boolean
}

export function computeDepths(nodes: NodeLike[], edges: EdgeLike[]): DepthInfo {
  const children = new Map<string, Reach[]>()
  const parents = new Map<string, Reach[]>()

  const add = (map: Map<string, Reach[]>, key: string, value: Reach) => {
    const list = map.get(key)
    if (list) list.push(value)
    else map.set(key, [value])
  }

  for (const edge of edges) {
    // Event cables only. Anything else would be read as another level of cascade, counting towards
    // `max` and compressing the ramp across the whole patch — which is exactly what an audio cable
    // did once before this line existed. A modulation cable is the same trap wearing a new name.
    if (edge.data?.kind === 'audio' || edge.data?.kind === 'mod') continue

    if (edge.data?.up) {
      // An upward cable is one step, into a wave that then climbs. It is not a rung of the climb, which
      // is the same exclusion the scheduler makes and for the same reason.
      add(children, edge.source, { id: edge.target, up: true })
    } else {
      add(children, edge.source, { id: edge.target, up: false })
      add(parents, edge.target, { id: edge.source, up: true })
    }
  }

  const depths = new Map<string, number>()
  // An Ignite with nothing wired to it either way is seeded as no root at all, so it falls out of the
  // map and reads as disconnected — the same way an orphaned oscillator already does.
  let queue: Reach[] = nodes
    .filter((n) => n.type === 'start' && children.has(n.id))
    .map((n) => ({ id: n.id, up: false }))
  for (const one of queue) depths.set(one.id, 0)

  let depth = 0
  while (queue.length > 0) {
    depth++
    const next: Reach[] = []
    for (const one of queue) {
      // Down the cascade or up it, which is a fact about the wave and not about the node.
      for (const onward of (one.up ? parents.get(one.id) : children.get(one.id)) ?? []) {
        // First path to arrive wins: a node is coloured by its shortest branch, whichever way it ran.
        if (depths.has(onward.id)) continue
        depths.set(onward.id, depth)
        // `onward.up` alone: every entry in `parents` carries true and every downward entry in `children`
        // carries false, so the direction a wave is already going is already in the step it takes. An
        // `||` here read as defensive and was dead — nothing could reach a downward child while climbing.
        next.push({ id: onward.id, up: onward.up })
      }
    }
    queue = next
  }

  let max = 0
  for (const value of depths.values()) if (value > max) max = value
  return { depths, max }
}

export function sameDepths(a: DepthInfo, b: DepthInfo): boolean {
  if (a.max !== b.max || a.depths.size !== b.depths.size) return false
  for (const [id, depth] of a.depths) if (b.depths.get(id) !== depth) return false
  return true
}

interface Stop {
  at: number
  h: number
  s: number
  l: number
}

/**
 * Fluorescent marker ramp: the greens, highlighter yellow-greens and hot oranges of the
 * folk-art reference.
 *
 * It is a multi-stop ramp rather than a straight sweep between two endpoints because a plain
 * hue interpolation at fixed lightness goes muddy through the yellows — yellow needs to sit
 * lighter and orange more saturated to read as fluorescent against black.
 */
const FLUO_RAMP: Stop[] = [
  { at: 0, h: 148, s: 82, l: 44 }, // deep fluo green
  { at: 0.28, h: 104, s: 86, l: 47 }, // green going chartreuse
  { at: 0.52, h: 68, s: 92, l: 53 }, // highlighter yellow-green
  { at: 0.76, h: 38, s: 100, l: 55 }, // fluo amber
  { at: 1, h: 14, s: 100, l: 56 }, // hot fluo orange
]

/**
 * Continuous position along the cascade → colour. `t` runs 0 (source) to 1 (deepest).
 */
export function colorAt(t: number): string {
  const clamped = Math.min(1, Math.max(0, t))

  let lower = FLUO_RAMP[0]
  let upper = FLUO_RAMP[FLUO_RAMP.length - 1]
  for (let i = 0; i < FLUO_RAMP.length - 1; i++) {
    if (clamped >= FLUO_RAMP[i].at && clamped <= FLUO_RAMP[i + 1].at) {
      lower = FLUO_RAMP[i]
      upper = FLUO_RAMP[i + 1]
      break
    }
  }

  const span = upper.at - lower.at
  const k = span === 0 ? 0 : (clamped - lower.at) / span
  const mix = (a: number, b: number) => a + (b - a) * k

  const h = mix(lower.h, upper.h).toFixed(1)
  const s = mix(lower.s, upper.s).toFixed(1)
  const l = mix(lower.l, upper.l).toFixed(1)
  return `hsl(${h} ${s}% ${l}%)`
}

function positionOf(depth: number, max: number): number {
  return max <= 0 ? 0 : depth / max
}

export interface NodeColors {
  /** Hue entering at the top of the node. */
  top: string
  /** Hue used by the node's inner accents. */
  mid: string
  /** Hue leaving at the bottom, where its outgoing cable picks up. */
  bottom: string
  reachable: boolean
}

export function useNodeColors(id: string | undefined): NodeColors {
  const { depths, max } = useContext(DepthContext)
  const depth = id === undefined ? undefined : depths.get(id)

  if (depth === undefined) {
    return {
      top: UNREACHABLE_COLOR,
      mid: UNREACHABLE_COLOR,
      bottom: UNREACHABLE_COLOR,
      reachable: false,
    }
  }

  const start = positionOf(depth, max)
  const end = positionOf(depth + NODE_SPAN, max)
  return {
    top: colorAt(start),
    mid: colorAt((start + end) / 2),
    bottom: colorAt(end),
    reachable: true,
  }
}

/**
 * A cable continues where its source node left off and arrives exactly at the hue its target
 * begins with, so the descent reads as one unbroken sweep.
 */
export function useEdgeColors(source: string, target: string): { from: string; to: string } {
  const { depths, max } = useContext(DepthContext)
  const sourceDepth = depths.get(source)
  const targetDepth = depths.get(target)

  if (sourceDepth === undefined || targetDepth === undefined) {
    return { from: UNREACHABLE_COLOR, to: UNREACHABLE_COLOR }
  }

  return {
    from: colorAt(positionOf(sourceDepth + NODE_SPAN, max)),
    to: colorAt(positionOf(targetDepth, max)),
  }
}
