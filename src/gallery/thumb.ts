/**
 * A patch's cascade, small enough for a card.
 *
 * A grid of names is a list; what makes it a gallery is that each card draws its own patch (PLAN
 * §12.8). The code already carries every node and cable, so this needs no server, no audio and no
 * stored image — and it shows at a glance whether something is three nodes or sixty before anyone
 * clicks.
 *
 * Pure geometry, so it can be tested without rendering anything.
 */
import type { Patch } from '../types/patch'
import { colorAt, computeDepths } from '../viz/depth'

/** Node side length in viewBox units. Squares, matching the isotype. */
const NODE_SIZE = 7
/** Kept clear of the edges so a node on the boundary is not clipped in half. */
const PADDING = NODE_SIZE

export interface ThumbNode {
  x: number
  y: number
  color: string
}

export interface ThumbCable {
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  /** Audio cables are drawn differently: they are not part of the descent. */
  audio: boolean
}

export interface Thumb {
  size: number
  nodes: ThumbNode[]
  cables: ThumbCable[]
}

/**
 * Lays the patch out inside a square of `size`.
 *
 * The patch's own coordinates are whatever the canvas happened to leave them at, so they are
 * normalised into the box. **One scale for both axes**, taken from the wider span: scaling each axis
 * to fill would stretch a tall cascade into a squat one and lose the shape that is the whole point of
 * showing it.
 */
export function layoutThumb(patch: Patch, size = 100): Thumb {
  const { depths, max } = computeDepths(patch.nodes, patch.edges)
  const nodes = patch.nodes
  if (nodes.length === 0) return { size, nodes: [], cables: [] }

  const xs = nodes.map((node) => node.position.x)
  const ys = nodes.map((node) => node.position.y)
  const spanX = Math.max(...xs) - Math.min(...xs)
  const spanY = Math.max(...ys) - Math.min(...ys)
  const span = Math.max(spanX, spanY)
  const inner = size - PADDING * 2
  const scale = span > 0 ? inner / span : 0

  // Centred, so a wide-but-short patch is not pinned to one edge.
  const offsetX = (inner - spanX * scale) / 2
  const offsetY = (inner - spanY * scale) / 2
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)

  const placed = new Map<string, { x: number; y: number }>()
  for (const node of nodes) {
    placed.set(node.id, {
      x: PADDING + offsetX + (node.position.x - minX) * scale,
      y: PADDING + offsetY + (node.position.y - minY) * scale,
    })
  }

  const hueOf = (id: string): string => {
    const depth = depths.get(id)
    // Unreachable nodes get the deepest hue's opposite end rather than a grey, so a card never has a
    // colour the canvas would not use.
    return depth === undefined ? colorAt(0) : colorAt(max <= 0 ? 0 : depth / max)
  }

  return {
    size,
    nodes: nodes.map((node) => ({
      x: placed.get(node.id)!.x,
      y: placed.get(node.id)!.y,
      color: hueOf(node.id),
    })),
    cables: patch.edges.flatMap((edge) => {
      const from = placed.get(edge.source)
      const to = placed.get(edge.target)
      if (!from || !to) return []
      return [
        {
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          color: hueOf(edge.source),
          audio: edge.kind === 'audio',
        },
      ]
    }),
  }
}

export const THUMB_NODE_SIZE = NODE_SIZE
