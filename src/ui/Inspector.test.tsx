import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { SIGNAL_LEFT, SIGNAL_RIGHT } from '../state/connections'
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

describe('a MOD pointed at something that cannot answer', () => {
  /** A MOD wired to the side of the patch's oscillator, which is where its targets come from. */
  function modOnOscillator(): { mod: string; osc: string } {
    const store = usePatchStore.getState()
    const osc = store.nodes.find((n) => n.type === 'osc')!
    store.addNode('mod', { x: 0, y: 0 })
    const mod = usePatchStore.getState().nodes.at(-1)!
    usePatchStore.getState().onConnect({
      source: mod.id,
      target: osc.id,
      sourceHandle: SIGNAL_RIGHT,
      targetHandle: SIGNAL_LEFT,
    })
    usePatchStore.getState().select(mod.id)
    return { mod: mod.id, osc: osc.id }
  }

  /** The option whose label starts with a name, since a dead one carries a reason after it. */
  const optionFor = (label: string): HTMLOptionElement | undefined => {
    const select = screen.getByLabelText('Target') as HTMLSelectElement
    return Array.from(select.options).find((option) => option.textContent?.startsWith(label))
  }

  it('offers the filter while the filter is on', () => {
    const { mod, osc } = modOnOscillator()
    usePatchStore.getState().updateParams(osc, { filterType: 'lowpass' })
    usePatchStore.getState().select(mod)
    render(<Inspector />)

    expect(optionFor('Cutoff')?.disabled).toBe(false)
    expect(screen.queryByText(/Doing nothing/)).toBeNull()
  })

  it('greys the filter out when the oscillator has it off, and says which one', () => {
    const { mod, osc } = modOnOscillator()
    usePatchStore.getState().updateParams(osc, { filterType: 'off' })
    usePatchStore.getState().select(mod)
    render(<Inspector />)

    // Still listed, still readable: a list that changes length as a filter type changes is harder to
    // follow than one where an entry is visibly out of reach.
    const cutoff = optionFor('Cutoff')
    expect(cutoff).toBeDefined()
    expect(cutoff?.disabled).toBe(true)
    expect(cutoff?.textContent).toContain('filter off')
  })

  it('leaves the level alone, which does not go through the filter', () => {
    const { mod, osc } = modOnOscillator()
    usePatchStore.getState().updateParams(osc, { filterType: 'off' })
    usePatchStore.getState().select(mod)
    render(<Inspector />)

    expect(optionFor('Level')?.disabled).toBe(false)
  })

  it('says why a target it is already pointed at has gone quiet', () => {
    // The case the design turns on: the target is kept rather than swapped for a working one, so
    // something has to explain the silence. Swapping would be an edit nobody asked for.
    const { mod, osc } = modOnOscillator()
    usePatchStore.getState().updateParams(mod, { target: 'cutoff' })
    usePatchStore.getState().updateParams(osc, { filterType: 'off' })
    usePatchStore.getState().select(mod)
    render(<Inspector />)

    expect(screen.getByText(/Doing nothing/).textContent).toContain('filter is off')
    // And the MOD still points where it was pointed.
    const params = usePatchStore.getState().nodes.find((n) => n.id === mod)!.data.params
    expect((params as { target?: string }).target).toBe('cutoff')
  })
})
