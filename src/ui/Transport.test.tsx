import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { usePatchStore } from '../state/patchStore'
import { MAX_BPM, MIN_BPM } from '../types/patch'
import { Transport } from './Transport'

function bpmField(): HTMLInputElement {
  render(<Transport />)
  return screen.getByLabelText('BPM', { selector: 'input' })
}

beforeEach(() => {
  usePatchStore.getState().resetPatch()
  usePatchStore.getState().setBpm(120)
})

describe('the BPM field', () => {
  it('lets a number be typed digit by digit', () => {
    const input = bpmField()

    // Typing 144 goes through "1", which is below the minimum. Clamping there is what used to
    // turn the field into 20 mid-word and make it impossible to finish the number.
    fireEvent.change(input, { target: { value: '1' } })
    expect(input.value).toBe('1')
    expect(usePatchStore.getState().bpm).toBe(120)

    fireEvent.change(input, { target: { value: '14' } })
    fireEvent.change(input, { target: { value: '144' } })
    expect(input.value).toBe('144')
    expect(usePatchStore.getState().bpm).toBe(144)
  })

  it('can be cleared to start over without snapping to the minimum', () => {
    const input = bpmField()
    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('')
    expect(usePatchStore.getState().bpm).toBe(120)
  })

  it('keeps the previous tempo if it is left empty', () => {
    const input = bpmField()
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input, { target: { value: '' } })
    expect(usePatchStore.getState().bpm).toBe(120)
  })

  it('takes an in-range value straight away, so the arrows still feel live', () => {
    const input = bpmField()
    fireEvent.change(input, { target: { value: '121' } })
    expect(usePatchStore.getState().bpm).toBe(121)
  })

  it('clamps out-of-range input on blur rather than while typing', () => {
    const input = bpmField()

    fireEvent.change(input, { target: { value: '4000' } })
    // Still shows what was typed, and the tempo has not lurched to the ceiling yet.
    expect(input.value).toBe('4000')
    expect(usePatchStore.getState().bpm).toBe(120)

    fireEvent.blur(input, { target: { value: '4000' } })
    expect(usePatchStore.getState().bpm).toBe(MAX_BPM)
  })

  it('clamps upward on blur too', () => {
    const input = bpmField()
    fireEvent.change(input, { target: { value: '3' } })
    fireEvent.blur(input, { target: { value: '3' } })
    expect(usePatchStore.getState().bpm).toBe(MIN_BPM)
  })

  it('commits on Enter without waiting for focus to leave', () => {
    const input = bpmField()
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(usePatchStore.getState().bpm).toBe(MIN_BPM)
  })
})
