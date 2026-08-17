import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CSSProperties } from 'react'
import type { FlowNode } from '../state/patchStore'
import type { Osc4Params } from '../types/patch'
import { useDepthColor } from '../viz/depth'
import { useNodeActivity } from '../viz/useActivity'
import { StepBars } from './StepBars'

/**
 * El color de profundidad se inyecta como `--accent` local, así que todo lo que el nodo pinta
 * con el acento —borde, título, barra del paso que suena— se tiñe solo, sin reglas nuevas.
 */
function depthStyle(color: string): CSSProperties {
  return { '--accent': color } as CSSProperties
}

export function StartNode({ id, selected }: NodeProps<FlowNode>) {
  const { pulsing } = useNodeActivity(id)
  const color = useDepthColor(id)

  return (
    <div
      className={`node node-start${pulsing ? ' pulsing' : ''}${selected ? ' selected' : ''}`}
      style={depthStyle(color)}
      data-testid="start-node"
    >
      <div className="node-title">START</div>
      <Handle type="source" position={Position.Bottom} className="port port-out" />
    </div>
  )
}

export function Osc4Node({ id, data, selected }: NodeProps<FlowNode>) {
  const { pulsing, currentStep } = useNodeActivity(id)
  const color = useDepthColor(id)
  const params = data.params as Osc4Params

  return (
    <div
      className={`node node-osc4${pulsing ? ' pulsing' : ''}${selected ? ' selected' : ''}`}
      style={depthStyle(color)}
    >
      <Handle type="target" position={Position.Top} className="port port-in" />
      <div className="node-header">
        <span className="node-title">OSC 4</span>
        <span className="node-meta">{params.division}</span>
      </div>
      <StepBars nodeId={id} steps={params.steps} currentStep={currentStep} />
      <Handle type="source" position={Position.Bottom} className="port port-out" />
    </div>
  )
}
