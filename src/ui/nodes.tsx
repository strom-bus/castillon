import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { FlowNode } from '../state/patchStore'
import type { Osc4Params } from '../types/patch'
import { useNodeActivity } from '../viz/useActivity'
import { StepBars } from './StepBars'

export function StartNode({ id, selected }: NodeProps<FlowNode>) {
  const { pulsing } = useNodeActivity(id)
  return (
    <div
      className={`node node-start${pulsing ? ' pulsing' : ''}${selected ? ' selected' : ''}`}
      data-testid="start-node"
    >
      <div className="node-title">START</div>
      <Handle type="source" position={Position.Bottom} className="port port-out" />
    </div>
  )
}

export function Osc4Node({ id, data, selected }: NodeProps<FlowNode>) {
  const { pulsing, currentStep } = useNodeActivity(id)
  const params = data.params as Osc4Params

  return (
    <div className={`node node-osc4${pulsing ? ' pulsing' : ''}${selected ? ' selected' : ''}`}>
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
