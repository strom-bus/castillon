import { useCallback, useRef } from 'react'
import { noteName } from '../audio/clock'
import { usePatchStore } from '../state/patchStore'
import { pitchesOf, snapToScale, type ScaleName } from '../audio/scales'
import { MAX_NOTE, MIN_NOTE, type Step } from '../types/patch'

/** Pixels of vertical drag per semitone. */
const PIXELS_PER_SEMITONE = 4

interface Props {
  nodeId: string
  steps: Step[]
  currentStep: number
  /** Whether this sequencer is using chance and ratchets, which decides what the bars can mean. */
  useChance?: boolean
  useRatchet?: boolean
  /** What dragging is allowed to land on, and what the guides on the track show. */
  scale?: ScaleName
  scaleRoot?: number
}

/**
 * The steps as vertical bars, hardware-sequencer style: height is pitch, so the shape of the
 * melody reads at a glance while taking no more room than text would.
 * Drag vertically to tune; the square underneath arms or mutes the step.
 *
 * Every bar is the same width whatever the sequence length, so a step is the same target to hit
 * in a 2-step node as in a 16-step one. A 16-step node is wide as a result, which is the honest
 * trade: it is showing eight times as much.
 */
export function StepBars({
  nodeId,
  steps,
  currentStep,
  useChance,
  useRatchet,
  scale = 'free',
  scaleRoot = 0,
}: Props) {
  const updateStep = usePatchStore((s) => s.updateStep)
  const selectStep = usePatchStore((s) => s.selectStep)
  const selectedStep = usePatchStore((s) => s.selectedStep)
  const selectedId = usePatchStore((s) => s.selectedId)
  const drag = useRef<{ startY: number; startNote: number } | null>(null)

  const onPointerDown = useCallback(
    (event: React.PointerEvent, step: Step, index: number) => {
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { startY: event.clientY, startNote: step.note }
      // Touching a bar is what opens it in the panel. No new gesture: tuning a step and asking to see
      // the rest of it are the same reach, so they are the same act.
      selectStep(nodeId, index)
    },
    [nodeId, selectStep],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent, index: number) => {
      if (!drag.current) return
      event.stopPropagation()
      const delta = Math.round((drag.current.startY - event.clientY) / PIXELS_PER_SEMITONE)
      const raw = Math.min(MAX_NOTE, Math.max(MIN_NOTE, drag.current.startNote + delta))
      // Snapped as it is dragged and nowhere else. Changing the scale afterwards leaves the sequence
      // alone, because what is on the screen has to be what plays.
      const note = Math.min(MAX_NOTE, Math.max(MIN_NOTE, snapToScale(raw, scale, scaleRoot)))
      updateStep(nodeId, index, { note })
    },
    [nodeId, scale, scaleRoot, updateStep],
  )

  const endDrag = useCallback((event: React.PointerEvent) => {
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  /*
   * The scale drawn on the track, an octave's worth repeated up it.
   *
   * So the grid is visible before a bar is let go of rather than felt afterwards. Built once for the
   * whole sequencer, since every bar in it shares a scale.
   */
  const allowed = pitchesOf(scale, scaleRoot)
  const guides = allowed
    ? Array.from({ length: MAX_NOTE - MIN_NOTE + 1 }, (_, i) => MIN_NOTE + i)
        .filter((note) => allowed.has(((note % 12) + 12) % 12))
        .map((note) => ((note - MIN_NOTE) / (MAX_NOTE - MIN_NOTE)) * 100)
    : []

  return (
    <div className="steps nodrag">
      {steps.map((step, index) => {
        const ratio = (step.note - MIN_NOTE) / (MAX_NOTE - MIN_NOTE)
        const hits = useRatchet ? Math.max(1, Math.round(step.ratchet ?? 1)) : 1
        const chance = useChance ? (step.chance ?? 1) : 1
        const open = selectedId === nodeId && selectedStep === index
        return (
          <div className={`step${open ? ' open' : ''}`} key={index}>
            <div
              className={`step-track${index === currentStep ? ' playing' : ''}${
                step.active ? '' : ' muted'
              }`}
              onPointerDown={(e) => onPointerDown(e, step, index)}
              onPointerMove={(e) => onPointerMove(e, index)}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              title={
                `Step ${index + 1} · ${noteName(step.note)} · drag to tune` +
                (chance < 1 ? ` · ${Math.round(chance * 100)}% of the time` : '') +
                (hits > 1 ? ` · ${hits} hits` : '') +
                (step.slide ? ' · slides in' : '')
              }
            >
              {/* A roll draws as that many stacked pieces, which is what a roll is: the step divided.
                Read at a glance without reading a number, and only where the sequencer uses them. */}
              {guides.map((at) => (
                <span key={at} className="step-guide" style={{ bottom: `${at}%` }} />
              ))}
              <div className="step-bar" style={{ height: `${Math.round(ratio * 100)}%` }}>
                {hits > 1 &&
                  Array.from({ length: hits - 1 }, (_, line) => (
                    <span
                      key={line}
                      className="step-hit"
                      style={{ bottom: `${((line + 1) / hits) * 100}%` }}
                    />
                  ))}
              </div>
            </div>
            {/* The square keeps meaning armed or muted, and fills to say how likely the step is —
                which only reads as one thing because the sequencer is either using chance or not. */}
            <button
              type="button"
              className={`step-toggle${step.active ? ' on' : ''}`}
              style={
                chance < 1 ? { ['--chance' as string]: `${Math.round(chance * 100)}%` } : undefined
              }
              onClick={(e) => {
                e.stopPropagation()
                updateStep(nodeId, index, { active: !step.active })
              }}
              title={step.active ? 'Mute step' : 'Arm step'}
            />
            <span className="step-note">{noteName(step.note)}</span>
          </div>
        )
      })}
    </div>
  )
}
