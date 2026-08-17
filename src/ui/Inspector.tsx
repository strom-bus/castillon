import { DIVISIONS } from '../audio/clock'
import { usePatchStore } from '../state/patchStore'
import type { Division, Osc4Params, PropagateMode } from '../types/patch'

const PROPAGATE_LABELS: Record<PropagateMode, string> = {
  onEnd: 'Al terminar (cascada)',
  onStart: 'Al empezar (paralelo)',
  onStep: 'En cada paso (denso)',
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
          Selecciona un nodo para editarlo.
          <br />
          <br />
          Arrastra en vertical sobre una barra para afinar el paso; el cuadrado de debajo lo
          silencia. Arrastra de un puerto a otro para conectar nodos.
        </p>
      </aside>
    )
  }

  if (node.type === 'start') {
    return (
      <aside className="inspector">
        <h2 className="inspector-title">START</h2>
        <p className="inspector-empty">
          Dispara la cascada al pulsar Play. Puede haber varios en un mismo patch: cada uno es una
          cascada independiente.
        </p>
      </aside>
    )
  }

  const params = node.data.params as Osc4Params
  const set = (partial: Partial<Osc4Params>) => updateParams(node.id, partial)

  return (
    <aside className="inspector">
      <h2 className="inspector-title">OSC 4</h2>

      <label className="inspector-field">
        <span className="inspector-label">División</span>
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
        <span className="inspector-label">Propagación</span>
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
        label="Ganancia"
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
        label="Ataque"
        value={params.attack}
        min={1}
        max={500}
        step={1}
        suffix=" ms"
        onChange={(attack) => set({ attack })}
      />
      <Slider
        label="Liberación"
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
