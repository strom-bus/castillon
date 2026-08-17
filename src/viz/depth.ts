import { createContext, useContext } from 'react'

/**
 * Cascade colouring: green at the source, red at the deepest branch.
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

export const UNREACHABLE_COLOR = 'var(--muted)'

/** How much of a level the node body covers; the cable covers the rest. */
const NODE_SPAN = 0.55

interface NodeLike {
  id: string
  type?: string
}

interface EdgeLike {
  source: string
  target: string
}

export function computeDepths(nodes: NodeLike[], edges: EdgeLike[]): DepthInfo {
  const children = new Map<string, string[]>()
  for (const edge of edges) {
    const list = children.get(edge.source)
    if (list) list.push(edge.target)
    else children.set(edge.source, [edge.target])
  }

  const depths = new Map<string, number>()
  let queue = nodes.filter((n) => n.type === 'start').map((n) => n.id)
  for (const id of queue) depths.set(id, 0)

  let depth = 0
  while (queue.length > 0) {
    depth++
    const next: string[] = []
    for (const id of queue) {
      for (const child of children.get(id) ?? []) {
        // First path to arrive wins: a node is coloured by its shortest branch.
        if (depths.has(child)) continue
        depths.set(child, depth)
        next.push(child)
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

/**
 * Continuous position along the cascade → colour. `t` runs 0 (source) to 1 (deepest),
 * sweeping hue from green through yellow and orange to red.
 */
export function colorAt(t: number): string {
  const clamped = Math.min(1, Math.max(0, t))
  return `hsl(${(145 - 145 * clamped).toFixed(1)} 72% 55%)`
}

/** Kept for the depth scale legend and for tests. */
export function depthColor(depth: number, max: number): string {
  return colorAt(max <= 0 ? 0 : depth / max)
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
