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

/**
 * How the oscillator's panel is laid out, which until now was not laid out at all.
 *
 * Fifteen controls in a flat list gave a new parameter nowhere to belong, so decay, glide and key follow
 * each landed at the bottom for no reason anybody could read off the screen. The order is the same idea
 * this whole instrument runs on applied once more: what happens first is written first.
 */
describe('the oscillator panel', () => {
  function selectOsc() {
    const osc = usePatchStore.getState().nodes.find((n) => n.type === 'osc')!
    usePatchStore.getState().select(osc.id)
    render(<Inspector />)
    return osc.id
  }

  /** Group headings, in the order they appear on screen. */
  const headings = () =>
    Array.from(document.querySelectorAll('.inspector-group-title')).map((el) => el.textContent)

  it('reads in the order a note is lived', () => {
    // Chosen, timed, given a tone, given a shape, given a colour — and last, what to fire next.
    selectOsc()
    expect(headings()).toEqual(['SEQUENCE', 'VOICE', 'SHAPE', 'FILTER', 'NEXT'])
  })

  it('leaves no control stranded outside a group', () => {
    // One that belongs nowhere is exactly the state this replaced, and it would be invisible: a field
    // between two groups looks like it belongs to whichever one the eye reached last.
    selectOsc()
    const fields = Array.from(document.querySelectorAll('.inspector-field, .inspector-slider'))
    const orphans = fields.filter((el) => !el.closest('.inspector-group'))
    expect(orphans.map((el) => el.textContent?.slice(0, 30))).toEqual([])
  })

  it('puts what fires next on its own, and last', () => {
    /*
     * Because it is not about this node: it is where this one finishes and the next begins. It spent a
     * long time seventh in a flat list, which is a poor place for one of the few controls the whole
     * instrument turns on.
     */
    selectOsc()
    const next = Array.from(document.querySelectorAll('.inspector-group')).at(-1)!
    expect(next.querySelector('.inspector-group-title')?.textContent).toBe('NEXT')
    expect(next.textContent).toContain('Propagation')
  })

  it('keeps the filter last of the sound groups, since it is the one that changes size', () => {
    // One control becomes four the moment it is switched on, and a group that grows unsettles less at
    // the bottom than in the middle.
    selectOsc()
    const order = headings()
    expect(order.indexOf('FILTER')).toBe(order.indexOf('NEXT') - 1)
  })
})
