import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CSSProperties } from 'react'
import { WAVEFORM_LABELS } from '../audio/waveforms'
import type { FlowNode } from '../state/patchStore'
import type { Osc4Params } from '../types/patch'
import { useNodeColors, type NodeColors } from '../viz/depth'
import { useNodeActivity } from '../viz/useActivity'
import { StepBars } from './StepBars'

/**
 * The depth hues go in as local custom properties. `--accent` drives everything the node paints
 * with the accent colour, while `--depth-top` and `--depth-bottom` feed the gradient border,
 * so the hue flows through the node and continues into its outgoing cable.
 */
function depthStyle(colors: NodeColors): CSSProperties {
  return {
    '--accent': colors.mid,
    '--depth-top': colors.top,
    '--depth-bottom': colors.bottom,
  } as CSSProperties
}

export function StartNode({ id, selected }: NodeProps<FlowNode>) {
  const { pulsing } = useNodeActivity(id)
  const colors = useNodeColors(id)

  return (
    <div
      className={`node node-start${pulsing ? ' pulsing' : ''}${selected ? ' selected' : ''}`}
      style={depthStyle(colors)}
      data-testid="start-node"
    >
      <div className="node-title">START</div>
      <Handle type="source" position={Position.Bottom} className="port port-out" />
    </div>
  )
}

export function Osc4Node({ id, data, selected }: NodeProps<FlowNode>) {
  const { pulsing, currentStep } = useNodeActivity(id)
  const colors = useNodeColors(id)
  const params = data.params as Osc4Params
  const waveform = params.waveform ?? 'square'

  return (
    <div
      className={`node node-osc4${pulsing ? ' pulsing' : ''}${selected ? ' selected' : ''}`}
      style={depthStyle(colors)}
    >
      <Handle type="target" position={Position.Top} className="port port-in" />
      <div className="node-header">
        <span className="node-title">OSC 4</span>
        <span className="node-meta">
          {WAVEFORM_LABELS[waveform]} · {params.division}
        </span>
      </div>
      <StepBars nodeId={id} steps={params.steps} currentStep={currentStep} />
      <Handle type="source" position={Position.Bottom} className="port port-out" />
    </div>
  )
}
