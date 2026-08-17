import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { usePatchStore } from '../state/patchStore'
import { MAX_DELAY_MS, MIN_DELAY_MS, type DelayParams } from '../types/patch'
import { Inspector } from './Inspector'

function selectDelay(): string {
  const delay = usePatchStore.getState().nodes.find((n) => n.type === 'delay')!
  usePatchStore.getState().select(delay.id)
  return delay.id
}

function wait(id: string): number {
  const node = usePatchStore.getState().nodes.find((n) => n.id === id)!
  return (node.data.params as DelayParams).delayMs
}

beforeEach(() => {
  usePatchStore.getState().resetPatch()
})

describe('the delay wait', () => {
  it('can be typed instead of dragged', () => {
    const id = selectDelay()
    render(<Inspector />)

    fireEvent.change(screen.getByLabelText('Wait'), { target: { value: '1250' } })
    expect(wait(id)).toBe(1250)
  })

  it('can be typed digit by digit without the field fighting back', () => {
    const id = selectDelay()
    const before = wait(id)
    render(<Inspector />)
    const input = screen.getByLabelText('Wait') as HTMLInputElement

    // "1" is below the minimum wait, so it must be held rather than clamped mid-word.
    fireEvent.change(input, { target: { value: '1' } })
    expect(input.value).toBe('1')
    expect(wait(id)).toBe(before)

    fireEvent.change(input, { target: { value: '18' } })
    fireEvent.change(input, { target: { value: '180' } })
    expect(wait(id)).toBe(180)
  })

  it('clamps out-of-range typing on blur', () => {
    const id = selectDelay()
    render(<Inspector />)
    const input = screen.getByLabelText('Wait')

    fireEvent.change(input, { target: { value: '99999' } })
    fireEvent.blur(input, { target: { value: '99999' } })
    expect(wait(id)).toBe(MAX_DELAY_MS)

    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.blur(input, { target: { value: '1' } })
    expect(wait(id)).toBe(MIN_DELAY_MS)
  })

  it('still has a working slider beside the field', () => {
    const id = selectDelay()
    render(<Inspector />)
    fireEvent.change(screen.getByLabelText('Wait slider'), { target: { value: '2000' } })
    expect(wait(id)).toBe(2000)
  })

  it('keeps the current wait if the field is emptied', () => {
    const id = selectDelay()
    const before = wait(id)
    render(<Inspector />)
    const input = screen.getByLabelText('Wait')

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input, { target: { value: '' } })
    expect(wait(id)).toBe(before)
  })
})
