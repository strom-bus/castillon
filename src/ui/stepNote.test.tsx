import { describe, expect, it, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Inspector } from './Inspector'
import { usePatchStore } from '../state/patchStore'
import { MAX_NOTE, MIN_NOTE, type OscParams } from '../types/patch'

/**
 * Choosing a step's note by name.
 *
 * It was a slider across sixty-one semitones in a two-hundred-pixel panel — three pixels a note, in the
 * one place somebody comes to the panel *for a particular note* rather than to move by feel, which the
 * bar on the canvas already does better. A list names them, and can obey a scale by offering rather
 * than by correcting afterwards.
 */
describe('the note on a step', () => {
  const osc = () => usePatchStore.getState().nodes.find((n) => n.type === 'osc')!
  const params = () => osc().data.params as OscParams
  const stepOne = () => params().steps[0]!

  beforeEach(() => {
    usePatchStore.getState().resetPatch()
    usePatchStore.getState().select(osc().id)
    usePatchStore.getState().selectStep(osc().id, 0)
  })

  const options = () =>
    Array.from((screen.getByLabelText('Note') as HTMLSelectElement).options).map((one) =>
      Number(one.value),
    )

  it('is chosen from a list of named notes', () => {
    render(<Inspector />)
    const select = screen.getByLabelText('Note') as HTMLSelectElement
    expect(select.tagName).toBe('SELECT')
    expect(Number(select.value)).toBe(stepOne().note)
    // Named, not numbered: the whole reason for the change is being able to ask for D#3 by asking.
    expect(select.selectedOptions[0]!.textContent).toMatch(/^[A-G]#?-?\d$/)
  })

  it('offers every semitone when no scale is set', () => {
    usePatchStore.getState().updateParams(osc().id, { scale: 'free' })
    render(<Inspector />)
    expect(options()).toHaveLength(MAX_NOTE - MIN_NOTE + 1)
  })

  it('offers only what the scale allows, rather than correcting afterwards', () => {
    /*
     * Snapping is right on a drag, where the pointer lands between two notes and one has to win. A list
     * that held notes it would refuse the moment they were picked would be a list that lies.
     */
    usePatchStore.getState().updateParams(osc().id, { scale: 'minor', scaleRoot: 0 })
    render(<Inspector />)
    const degrees = new Set(options().map((note) => ((note % 12) + 12) % 12))
    expect([...degrees].sort((a, b) => a - b)).toEqual([0, 2, 3, 5, 7, 8, 10])
  })

  it('keeps the note this step is already on, even out of key', () => {
    /*
     * Changing a scale leaves the sequence alone on purpose, so a step can sit on a note its own scale
     * would not choose. Dropped from the list, the box shows nothing — and the first thing anybody does
     * to an empty box turns that note into whatever the browser happened to put first.
     */
    usePatchStore.getState().updateStep(osc().id, 0, { note: 61 })
    usePatchStore.getState().updateParams(osc().id, { scale: 'minor', scaleRoot: 0 })
    render(<Inspector />)

    expect(options()).toContain(61)
    expect(Number((screen.getByLabelText('Note') as HTMLSelectElement).value)).toBe(61)
  })

  it('sets exactly what was picked', () => {
    render(<Inspector />)
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: '67' } })
    expect(stepOne().note).toBe(67)
  })
})
