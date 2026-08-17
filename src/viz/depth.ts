import { createContext, useContext } from 'react'

/**
 * Color por profundidad: la cascada va del verde en el origen al rojo en las ramas más hondas.
 *
 * La profundidad es estructural, no de ejecución: se calcula recorriendo el grafo en anchura
 * desde los nodos Start. Así el color es estable —no parpadea de una vuelta a otra— y el patch
 * se lee como un mapa aunque esté parado.
 */

export interface DepthInfo {
  /** Distancia de cada nodo al Start más cercano. Los no alcanzables no están en el mapa. */
  depths: Map<string, number>
  max: number
}

export const EMPTY_DEPTHS: DepthInfo = { depths: new Map(), max: 0 }

export const DepthContext = createContext<DepthInfo>(EMPTY_DEPTHS)

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
        // El primer camino que llega manda: un nodo se pinta por su rama más corta.
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

/** Verde (145°) en el origen → rojo (0°) en la rama más honda, pasando por amarillo y naranja. */
export function depthColor(depth: number, max: number): string {
  const t = max <= 0 ? 0 : Math.min(1, depth / max)
  return `hsl(${Math.round(145 - 145 * t)} 70% 55%)`
}

/** Color de un nodo. Los nodos que ningún Start alcanza quedan en gris: nunca van a sonar. */
export function useDepthColor(id: string | undefined): string {
  const { depths, max } = useContext(DepthContext)
  if (id === undefined) return 'var(--muted)'
  const depth = depths.get(id)
  return depth === undefined ? 'var(--muted)' : depthColor(depth, max)
}
