import { DIVISIONS } from '../audio/clock'
import { MAX_PULSE_WIDTH, MIN_PULSE_WIDTH, WAVEFORM_NAMES, WAVEFORMS } from '../audio/waveforms'
import { DEFAULT_DELAY_MS, DEFAULT_STEP_COUNT, STEP_COUNTS } from '../nodes/registry'
import { usePatchStore } from '../state/patchStore'
import {
  MAX_DELAY_MS,
  MIN_DELAY_MS,
  type DelayParams,
  type Division,
  type OscParams,
  type PropagateMode,
  type Waveform,
} from '../types/patch'

const PROPAGATE_LABELS: Record<PropagateMode, string> = {
  onEnd: 'When it ends (cascade)',
  onStart: 'When it starts (parallel)',
  onStep: 'On every step (dense)',
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <label className="inspector-field">
      <span className="inspector-label">
        {label}
        <em>
          {value}
          {suffix}
        </em>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

export function Inspector() {
  const node = usePatchStore((s) => s.nodes.find((n) => n.id === s.selectedId))
  const updateParams = usePatchStore((s) => s.updateParams)
  const setStepCount = usePatchStore((s) => s.setStepCount)

  if (!node) {
    return (
      <aside className="inspector">
        <p className="inspector-empty">
          Select a node to edit it.
          <br />
          <br />
          Drag vertically on a bar to tune that step; the square underneath mutes it. Drag from one
          port to another to connect nodes.
        </p>
      </aside>
    )
  }

  if (node.type === 'start') {
    return (
      <aside className="inspector">
        <h2 className="inspector-title">IGNITE</h2>
        <p className="inspector-empty">
          Fires the cascade on Play. A patch can hold several: each one is an independent cascade.
        </p>
      </aside>
    )
  }

  if (node.type === 'delay') {
    const delayParams = node.data.params as DelayParams
    return (
      <aside className="inspector">
        <h2 className="inspector-title">DELAY</h2>
        <Slider
          label="Wait"
          value={delayParams.delayMs ?? DEFAULT_DELAY_MS}
          min={MIN_DELAY_MS}
          max={MAX_DELAY_MS}
          step={10}
          suffix=" ms"
          onChange={(delayMs) => updateParams(node.id, { delayMs })}
        />
        <p className="inspector-empty">
          Holds the trigger and passes it on later. It makes no sound of its own — it shifts when
          the branch below it starts, so it is how two branches are pulled out of step.
        </p>
      </aside>
    )
  }

  const params = node.data.params as OscParams
  const waveform = params.waveform ?? 'square'
  const set = (partial: Partial<OscParams>) => updateParams(node.id, partial)

  return (
    <aside className="inspector">
      <h2 className="inspector-title">OSC</h2>

      <label className="inspector-field">
        <span className="inspector-label">Waveform</span>
        <select value={waveform} onChange={(e) => set({ waveform: e.target.value as Waveform })}>
          {WAVEFORMS.map((w) => (
            <option key={w} value={w}>
              {WAVEFORM_NAMES[w]}
            </option>
          ))}
        </select>
      </label>

      {waveform === 'pulse' && (
        <Slider
          label="Pulse width"
          value={params.pulseWidth ?? 0.5}
          min={MIN_PULSE_WIDTH}
          max={MAX_PULSE_WIDTH}
          step={0.01}
          onChange={(pulseWidth) => set({ pulseWidth })}
        />
      )}

      <label className="inspector-field">
        <span className="inspector-label">Steps</span>
        <select
          value={params.steps?.length ?? DEFAULT_STEP_COUNT}
          onChange={(e) => setStepCount(node.id, Number(e.target.value))}
        >
          {STEP_COUNTS.map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>
      </label>

      <label className="inspector-field">
        <span className="inspector-label">Division</span>
        <select
          value={params.division}
          onChange={(e) => set({ division: e.target.value as Division })}
        >
          {DIVISIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>

      <label className="inspector-field">
        <span className="inspector-label">Propagation</span>
        <select
          value={params.propagateMode}
          onChange={(e) => set({ propagateMode: e.target.value as PropagateMode })}
        >
          {(Object.keys(PROPAGATE_LABELS) as PropagateMode[]).map((mode) => (
            <option key={mode} value={mode}>
              {PROPAGATE_LABELS[mode]}
            </option>
          ))}
        </select>
      </label>

      <Slider
        label="Gain"
        value={params.gain}
        min={0}
        max={1}
        step={0.01}
        onChange={(gain) => set({ gain })}
      />
      <Slider
        label="Gate"
        value={params.gate}
        min={0.05}
        max={1}
        step={0.05}
        onChange={(gate) => set({ gate })}
      />
      <Slider
        label="Attack"
        value={params.attack}
        min={1}
        max={500}
        step={1}
        suffix=" ms"
        onChange={(attack) => set({ attack })}
      />
      <Slider
        label="Release"
        value={params.release}
        min={5}
        max={2000}
        step={5}
        suffix=" ms"
        onChange={(release) => set({ release })}
      />
    </aside>
  )
}
