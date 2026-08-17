import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CSSProperties } from 'react'
import { FILTER_LABELS } from '../audio/filter'
import { WAVEFORM_LABELS } from '../audio/waveforms'
import type { FlowNode } from '../state/patchStore'
import { DEFAULT_DELAY_MS } from '../nodes/registry'
import type { DelayParams, OscParams } from '../types/patch'
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
      <div className="node-title">IGNITE</div>
      <Handle type="source" position={Position.Bottom} className="port port-out" />
    </div>
  )
}

export function OscNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { pulsing, currentStep } = useNodeActivity(id)
  const colors = useNodeColors(id)
  const params = data.params as OscParams
  const waveform = params.waveform ?? 'square'
  const filter = FILTER_LABELS[params.filterType ?? 'off']

  return (
    <div
      className={`node node-osc${pulsing ? ' pulsing' : ''}${selected ? ' selected' : ''}`}
      style={depthStyle(colors)}
    >
      <Handle type="target" position={Position.Top} className="port port-in" />
      <div className="node-header">
        <span className="node-title">OSC</span>
        <span className="node-meta">
          {WAVEFORM_LABELS[waveform]}
          {filter && ` ${filter}`} · {params.division}
        </span>
      </div>
      <StepBars nodeId={id} steps={params.steps} currentStep={currentStep} />
      <Handle type="source" position={Position.Bottom} className="port port-out" />
    </div>
  )
}

export function DelayNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { pulsing, runId, duration } = useNodeActivity(id)
  const colors = useNodeColors(id)
  const params = data.params as DelayParams
  const ms = params.delayMs ?? DEFAULT_DELAY_MS

  return (
    <div
      className={`node node-delay${pulsing ? ' pulsing' : ''}${selected ? ' selected' : ''}`}
      style={depthStyle(colors)}
    >
      <Handle type="target" position={Position.Top} className="port port-in" />
      <div className="node-header">
        <span className="node-title">DELAY</span>
        <span className="node-meta">ms</span>
      </div>
      <div className="delay-body">
        <span className="delay-value">{ms}</span>
        {/* Keyed by runId so the fill animation restarts from zero on every trigger. */}
        <div className="delay-track">
          {pulsing && (
            <div key={runId} className="delay-fill" style={{ animationDuration: `${duration}s` }} />
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="port port-out" />
    </div>
  )
}
