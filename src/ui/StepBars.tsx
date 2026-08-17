import { useCallback, useRef } from 'react'
import { noteName } from '../audio/clock'
import { usePatchStore } from '../state/patchStore'
import { MAX_NOTE, MIN_NOTE, type Step } from '../types/patch'

/** Pixels of vertical drag per semitone. */
const PIXELS_PER_SEMITONE = 4

/** Note names stop fitting past this many bars, so they are dropped rather than squashed. */
const MAX_BARS_WITH_LABELS = 8

interface Props {
  nodeId: string
  steps: Step[]
  currentStep: number
}

/**
 * The steps as vertical bars, hardware-sequencer style: height is pitch, so the shape of the
 * melody reads at a glance while taking no more room than text would.
 * Drag vertically to tune; the square underneath arms or mutes the step.
 *
 * Bars get narrower as the sequence gets longer, so a 16-step node stays a reasonable width
 * instead of running off the canvas.
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

  const showLabels = steps.length <= MAX_BARS_WITH_LABELS

  return (
    <div className={`steps nodrag steps-${steps.length}`}>
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
              title={`Step ${index + 1} · ${noteName(step.note)} · drag to tune`}
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
              title={step.active ? 'Mute step' : 'Arm step'}
            />
            {showLabels && <span className="step-note">{noteName(step.note)}</span>}
          </div>
        )
      })}
    </div>
  )
}
