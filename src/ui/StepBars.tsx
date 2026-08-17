import { useCallback, useRef } from 'react'
import { noteName } from '../audio/clock'
import { usePatchStore } from '../state/patchStore'
import { MAX_NOTE, MIN_NOTE, type Step } from '../types/patch'

/** Píxeles de arrastre vertical por semitono. */
const PIXELS_PER_SEMITONE = 4

interface Props {
  nodeId: string
  steps: Step[]
  currentStep: number
}

/**
 * Los 4 pasos como barras verticales, estilo secuenciador hardware: la altura es la nota,
 * así que la silueta de la melodía se lee de un vistazo sin ocupar más que el texto.
 * Se arrastra en vertical para afinar; el cuadrado de abajo activa o silencia el paso.
 */
export function StepBars({ nodeId, steps, currentStep }: Props) {
  const updateStep = usePatchStore((s) => s.updateStep)
  const drag = useRef<{ startY: number; startNote: number } | null>(null)

  const onPointerDown = useCallback((event: React.PointerEvent, step: Step) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { startY: event.clientY, startNote: step.note }
  }, [])

  const onPointerMove = useCallback(
    (event: React.PointerEvent, index: number) => {
      if (!drag.current) return
      event.stopPropagation()
      const delta = Math.round((drag.current.startY - event.clientY) / PIXELS_PER_SEMITONE)
      const note = Math.min(MAX_NOTE, Math.max(MIN_NOTE, drag.current.startNote + delta))
      updateStep(nodeId, index, { note })
    },
    [nodeId, updateStep],
  )

  const endDrag = useCallback((event: React.PointerEvent) => {
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  return (
    <div className="steps nodrag">
      {steps.map((step, index) => {
        const ratio = (step.note - MIN_NOTE) / (MAX_NOTE - MIN_NOTE)
        return (
          <div className="step" key={index}>
            <div
              className={`step-track${index === currentStep ? ' playing' : ''}${
                step.active ? '' : ' muted'
              }`}
              onPointerDown={(e) => onPointerDown(e, step)}
              onPointerMove={(e) => onPointerMove(e, index)}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              title={`Paso ${index + 1} · ${noteName(step.note)} · arrastra para afinar`}
            >
              <div className="step-bar" style={{ height: `${Math.round(ratio * 100)}%` }} />
            </div>
            <button
              type="button"
              className={`step-toggle${step.active ? ' on' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                updateStep(nodeId, index, { active: !step.active })
              }}
              title={step.active ? 'Silenciar paso' : 'Activar paso'}
            />
            <span className="step-note">{noteName(step.note)}</span>
          </div>
        )
      })}
    </div>
  )
}
