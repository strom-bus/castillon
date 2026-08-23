/**
 * The bars, which are where a sequence is actually written.
 *
 * Everything below is integration rather than arithmetic: the snapping and the transposing have their own
 * tests and pass them whether or not anything calls them. A correct function nothing reaches leaves the
 * feature exactly as absent as never having written it, and that is the failure this file exists for.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { pitchesOf } from '../audio/scales'
import { usePatchStore } from '../state/patchStore'
import type { OscParams } from '../types/patch'
import { StepBars } from './StepBars'

function oscId(): string {
  return usePatchStore.getState().nodes.find((n) => n.type === 'osc')!.id
}

const paramsOf = (id: string) =>
  usePatchStore.getState().nodes.find((n) => n.id === id)!.data.params as OscParams

function showBars(id: string) {
  const params = paramsOf(id)
  return render(
    <StepBars
      nodeId={id}
      steps={params.steps}
      currentStep={-1}
      useChance={params.useChance}
      useRatchet={params.useRatchet}
      scale={params.scale}
      scaleRoot={params.scaleRoot}
    />,
  )
}

/** A drag on one bar, far enough to be worth several semitones. */
function dragBar(index: number, pixels: number) {
  const track = screen.getAllByTitle(/^Step /)[index]!
  // jsdom has no pointer capture, and the component asks for it on the way in.
  Object.assign(track, {
    setPointerCapture: () => {},
    hasPointerCapture: () => false,
    releasePointerCapture: () => {},
  })
  fireEvent.pointerDown(track, { pointerId: 1, clientY: 200 })
  fireEvent.pointerMove(track, { pointerId: 1, clientY: 200 - pixels })
  fireEvent.pointerUp(track, { pointerId: 1 })
}

beforeEach(() => {
  usePatchStore.getState().resetPatch()
})

describe('dragging a bar', () => {
  it('tunes that step', () => {
    const id = oscId()
    const before = paramsOf(id).steps[0]!.note
    showBars(id)
    dragBar(0, 20)

    expect(paramsOf(id).steps[0]!.note).toBeGreaterThan(before)
  })

  it('opens it in the panel, without a second gesture', () => {
    // Tuning a step and asking to see the rest of it are the same reach, so they are the same act.
    const id = oscId()
    showBars(id)
    dragBar(2, 8)

    expect(usePatchStore.getState().selectedId).toBe(id)
    expect(usePatchStore.getState().selectedStep).toBe(2)
  })

  it('lands on the scale when the sequencer has one', () => {
    /*
     * The integration the arithmetic cannot vouch for. `snapToScale` passes its own tests whether or not
     * a drag ever calls it, and a scale nothing consults is a scale that does not exist.
     */
    const id = oscId()
    usePatchStore.getState().updateParams(id, { scale: 'minorPentatonic', scaleRoot: 0 })
    showBars(id)

    const allowed = pitchesOf('minorPentatonic', 0)!
    for (const pixels of [4, 9, 13, 22, 31]) {
      dragBar(0, pixels)
      const note = paramsOf(id).steps[0]!.note
      expect(allowed.has(((note % 12) + 12) % 12), `${pixels}px → ${note}`).toBe(true)
    }
  })

  it('lands anywhere at all when it does not', () => {
    // Free is not a scale switched off but the way everything played before there were any, and a
    // semitone has to remain reachable.
    const id = oscId()
    const start = paramsOf(id).steps[0]!.note
    showBars(id)
    dragBar(0, 4)

    expect(paramsOf(id).steps[0]!.note).toBe(start + 1)
  })
})
