import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'
import { useDepthColor } from '../viz/depth'
import { useEdgeActivity } from '../viz/useActivity'

/**
 * Cable de evento. Dibuja dos trazos superpuestos: uno estático y otro que se ilumina y
 * recorre el cable cuando pasa un trigger por él.
 *
 * El pulso toma el color del nodo de destino, no el del origen: así el degradado de la cascada
 * avanza con el trigger en lugar de saltar de golpe al llegar al nodo siguiente.
 */
export function CascadeEdge({
  id,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const active = useEdgeActivity(id)
  const color = useDepthColor(target)
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  return (
    <>
      <BaseEdge id={id} path={path} className="edge-base" />
      {/* En estilo inline, no como atributo: si no, la regla de la hoja de estilos ganaría. */}
      <path
        d={path}
        className={`edge-pulse${active ? ' active' : ''}`}
        style={{ stroke: color }}
        fill="none"
      />
    </>
  )
}
