import { DIVISIONS } from '../audio/clock'
import { MAX_PULSE_WIDTH, MIN_PULSE_WIDTH, WAVEFORM_NAMES, WAVEFORMS } from '../audio/waveforms'
import { usePatchStore } from '../state/patchStore'
import type { Division, Osc4Params, PropagateMode, Waveform } from '../types/patch'

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
        <h2 className="inspector-title">START</h2>
        <p className="inspector-empty">
          Fires the cascade on Play. A patch can hold several: each one is an independent cascade.
        </p>
      </aside>
    )
  }

  const params = node.data.params as Osc4Params
  const waveform = params.waveform ?? 'square'
  const set = (partial: Partial<Osc4Params>) => updateParams(node.id, partial)

  return (
    <aside className="inspector">
      <h2 className="inspector-title">OSC 4</h2>

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
