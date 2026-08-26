import { describe, expect, it, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { StepBars } from './StepBars'
import { usePatchStore } from '../state/patchStore'
import type { OscParams } from '../types/patch'

/**
 * The mark that says a step has taken settings of its own, and hands them back.
 *
 * It lived inside the bar, where it could not be pressed: the bar is a drag target and the mark was
 * three pixels of `pointer-events: none` sitting on it. So the one thing on screen that said a step was
 * different was the one thing about it you could not act on.
 */
describe('the lock mark over a step', () => {
  const osc = () => usePatchStore.getState().nodes.find((n) => n.type === 'osc')!
  const stepsOf = () => (osc().data.params as OscParams).steps

  beforeEach(() => {
    usePatchStore.getState().resetPatch()
  })

  function bars() {
    const node = osc()
    const params = node.data.params as OscParams
    return render(<StepBars nodeId={node.id} steps={params.steps} currentStep={-1} />)
  }

  it('shows nothing on a step that follows its oscillator', () => {
    bars()
    expect(screen.queryByLabelText('Release step 1')).toBeNull()
  })

  it('appears the moment a step takes any one of the four', () => {
    // Any of them, not a particular one: it is one mark for four locks, so each has to raise it.
    for (const lock of [
      { waveform: 'white' },
      { cutoff: 5000 },
      { gate: 1 },
      { decay: 0 },
    ] as const) {
      usePatchStore.getState().resetPatch()
      usePatchStore.getState().updateStep(osc().id, 0, lock)
      const view = bars()
      expect(screen.getByLabelText('Release step 1'), JSON.stringify(lock)).toBeDefined()
      view.unmount()
    }
  })

  it('hands back all four when it is pressed', () => {
    const id = osc().id
    usePatchStore
      .getState()
      .updateStep(id, 0, { waveform: 'white', cutoff: 5000, gate: 1, decay: 0 })
    bars()

    fireEvent.click(screen.getByLabelText('Release step 1'))

    const step = stepsOf()[0]!
    expect(step.waveform).toBeUndefined()
    expect(step.cutoff).toBeUndefined()
    expect(step.gate).toBeUndefined()
    expect(step.decay).toBeUndefined()
  })

  it('leaves the step itself alone, and every other step with it', () => {
    /*
     * Releasing is about what the oscillator lends out and nothing else. A handler reaching for the
     * whole step would take the note, the velocity and the mute with it — silently, and only on the
     * steps somebody had bothered to make different.
     */
    const id = osc().id
    usePatchStore
      .getState()
      .updateStep(id, 0, { cutoff: 5000, note: 71, velocity: 0.4, active: false })
    usePatchStore.getState().updateStep(id, 1, { cutoff: 900 })
    bars()

    fireEvent.click(screen.getByLabelText('Release step 1'))

    expect(stepsOf()[0]!.note).toBe(71)
    expect(stepsOf()[0]!.velocity).toBe(0.4)
    expect(stepsOf()[0]!.active).toBe(false)
    expect(stepsOf()[1]!.cutoff, 'released a lock on a step nobody clicked').toBe(900)
  })

  it('does not tune the note it sits over', () => {
    // It is directly above a bar that answers a drag, and a click that reached the bar would move the
    // note — which is the fault it was moved out of the bar to avoid, arriving from the other side.
    const id = osc().id
    usePatchStore.getState().updateStep(id, 0, { cutoff: 5000 })
    const before = stepsOf()[0]!.note
    bars()

    fireEvent.click(screen.getByLabelText('Release step 1'))
    expect(stepsOf()[0]!.note).toBe(before)
  })
})
