import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'
import { useEdgeActivity } from '../viz/useActivity'

/**
 * Cable de evento. Dibuja dos trazos superpuestos: uno estático y otro que se ilumina y
 * recorre el cable cuando pasa un trigger por él.
 */
export function CascadeEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const active = useEdgeActivity(id)
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
      <path d={path} className={`edge-pulse${active ? ' active' : ''}`} fill="none" />
    </>
  )
}
