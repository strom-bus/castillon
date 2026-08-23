import { pitchesOf } from '../audio/scales'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { SIGNAL_LEFT, SIGNAL_RIGHT } from '../state/connections'
import { usePatchStore } from '../state/patchStore'
import { MAX_DELAY_MS, MIN_DELAY_MS, type DelayParams, type OscParams } from '../types/patch'
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

  it('shows each control once', () => {
    /*
     * The test that was missing, and the regrouping it was written for shipped showing every slider
     * seven times without one of the four tests here noticing. They asked whether the headings were in
     * order and whether anything sat outside a group; a control repeated in all five groups satisfies
     * both. Counting is the only question that catches it.
     */
    selectOsc()
    const labels = Array.from(document.querySelectorAll('.inspector-group label')).map((el) =>
      el.textContent?.replace(/[\d.\s]+$/, '').trim(),
    )
    const seen = new Map<string, number>()
    for (const label of labels) if (label) seen.set(label, (seen.get(label) ?? 0) + 1)

    const twice = [...seen].filter(([, times]) => times > 1)
    expect(twice).toEqual([])
  })

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

/**
 * How a modulator's panel reads, which is the principle the oscillator's now follows.
 *
 * Nothing tested the order of any panel until the oscillator was regrouped, so every one of them could
 * have been arranged wrongly and silently. This is the only other one with enough controls to get wrong.
 */
describe('the modulator panel', () => {
  function selectMod() {
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
    render(<Inspector />)
  }

  /**
   * Where each named control sits, top to bottom.
   *
   * Matched on the start of the label rather than the whole of it: a control's span carries its current
   * value, and some carry a unit outside the element the value sits in — so Rate reads as "RateHz" and
   * an exact comparison finds nothing.
   */
  function positionOf(name: string): number {
    return Array.from(document.querySelectorAll('.inspector-field, .inspector-check')).findIndex(
      (el) => {
        const span = el.querySelector('span')?.cloneNode(true) as HTMLElement | undefined
        span?.querySelector('em')?.remove()
        return span?.textContent?.trim().startsWith(name) ?? false
      },
    )
  }

  it('says what it is before what it points at', () => {
    // The panel should read as a sentence — an envelope, on the cutoff, fired on every note. It named
    // the destination first and left what kind of thing it was until second.
    selectMod()
    expect(positionOf('Kind')).toBe(0)
    expect(positionOf('Kind')).toBeLessThan(positionOf('Target'))
  })

  it('puts the control that reshapes the panel above everything it reshapes', () => {
    /*
     * Kind swaps a shape and a rate for a trigger and two times, so it sits above both sets: below them,
     * changing it would move whatever had just been set. Checked in both states, since a modulator
     * arrives as an LFO and the other half of the panel exists only once it is an envelope.
     */
    selectMod()
    for (const below of ['Shape', 'Rate', 'Depth']) {
      expect(positionOf(below), below).toBeGreaterThan(positionOf('Kind'))
    }

    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'env' } })
    for (const below of ['Fires on', 'Attack', 'Depth']) {
      expect(positionOf(below), below).toBeGreaterThan(positionOf('Kind'))
    }
  })
})

/**
 * Looking at one step of one sequencer (PLAN §18.16).
 *
 * A second, finer selection rather than a mode. Everything else here is inspected by selecting it, and a
 * step is a smaller thing to select — so the panel shows a step the way it shows a node.
 */
describe('the step panel', () => {
  function oscId(): string {
    return usePatchStore.getState().nodes.find((n) => n.type === 'osc')!.id
  }

  function openStep(index = 2) {
    const id = oscId()
    usePatchStore.getState().selectStep(id, index)
    render(<Inspector />)
    return id
  }

  it('replaces the oscillator rather than sitting beside it', () => {
    // Two scopes on screen at once leaves the reader to work out which control belongs to which.
    openStep()
    expect(screen.getByText(/STP 3/)).toBeTruthy()
    expect(screen.queryByLabelText(/^Waveform/)).toBeNull()
  })

  it('says where you are and offers the way back', () => {
    // A panel whose only exit is "click somewhere else" is one people get stuck in.
    const id = openStep()
    fireEvent.click(screen.getByRole('button', { name: /OSC/ }))

    expect(usePatchStore.getState().selectedStep).toBeNull()
    expect(usePatchStore.getState().selectedId).toBe(id)
  })

  it('gives a note its own volume, which nothing could set before', () => {
    /*
     * Velocity has been in the file format, in the engine and in the dice since long before today, read
     * by anything wired to it — and there has never been a way to write it. This panel exists as much to
     * expose that as to carry what arrived with it.
     */
    const id = openStep()
    // Matched on the start of the label: a slider's label carries its current value, so asking for
    // "Volume" exactly finds nothing at all.
    const slider = screen.getByLabelText(/^Volume/)
    fireEvent.change(slider, { target: { value: '0.4' } })

    const steps = (
      usePatchStore.getState().nodes.find((n) => n.id === id)!.data.params as OscParams
    ).steps
    expect(steps[2]!.velocity).toBeCloseTo(0.4, 5)
  })

  it('hides chance and ratchets until the sequencer asks for them', () => {
    // A control for something switched off is a question about a thing that is not happening.
    openStep()
    expect(screen.queryByLabelText(/^Chance/)).toBeNull()
    expect(screen.queryByLabelText(/^Ratchet/)).toBeNull()
  })

  it('shows them once it does', () => {
    const id = oscId()
    usePatchStore.getState().updateParams(id, { useChance: true, useRatchet: true })
    openStep()

    expect(screen.getByLabelText(/^Chance/)).toBeTruthy()
    expect(screen.getByLabelText(/^Ratchet/)).toBeTruthy()
  })

  it('keeps what the steps hold when a switch goes off again', () => {
    // So it can be turned back on and find the sequence as it was left, rather than as it was born.
    const id = oscId()
    usePatchStore.getState().updateParams(id, { useChance: true })
    usePatchStore.getState().updateStep(id, 2, { chance: 0.3 })
    usePatchStore.getState().updateParams(id, { useChance: false })

    const steps = (
      usePatchStore.getState().nodes.find((n) => n.id === id)!.data.params as OscParams
    ).steps
    expect(steps[2]!.chance).toBeCloseTo(0.3, 5)
  })

  it('drops the step when another node is chosen', () => {
    // A step of a node you are no longer looking at is not a thing to be looking at.
    openStep()
    const other = usePatchStore.getState().nodes.find((n) => n.type === 'start')!.id
    usePatchStore.getState().select(other)
    expect(usePatchStore.getState().selectedStep).toBeNull()
  })
})

/**
 * The scale, where it lives and what it is allowed to touch.
 */
describe('a sequencer scale', () => {
  function selectOscillator(): string {
    const osc = usePatchStore.getState().nodes.find((n) => n.type === 'osc')!
    usePatchStore.getState().select(osc.id)
    render(<Inspector />)
    return osc.id
  }

  const stepsOf = (id: string) =>
    (usePatchStore.getState().nodes.find((n) => n.id === id)!.data.params as OscParams).steps

  it('offers a root only once there is a scale to have one in', () => {
    // A root while everything is allowed is a question with no consequence.
    selectOscillator()
    expect(screen.queryByLabelText('Root')).toBeNull()

    fireEvent.change(screen.getByLabelText('Scale'), { target: { value: 'minor' } })
    expect(screen.getByLabelText('Root')).toBeTruthy()
  })

  it('leaves the notes alone when the scale changes', () => {
    /*
     * The bargain this instrument makes is that you see what you hear, and a control that silently
     * retuned a sequence you had written would break it. The scale bites while a bar is dragged.
     */
    const id = selectOscillator()
    const before = stepsOf(id).map((s) => s.note)
    fireEvent.change(screen.getByLabelText('Scale'), { target: { value: 'blues' } })

    expect(stepsOf(id).map((s) => s.note)).toEqual(before)
  })

  it('moves them when asked to, and only then', () => {
    const id = selectOscillator()
    fireEvent.change(screen.getByLabelText('Scale'), { target: { value: 'minorPentatonic' } })
    fireEvent.click(screen.getByRole('button', { name: /FIT TO SCALE/ }))

    const allowed = pitchesOf('minorPentatonic', 0)!
    for (const step of stepsOf(id)) {
      expect(allowed.has(((step.note % 12) + 12) % 12), String(step.note)).toBe(true)
    }
  })

  it('hides the way to move them while everything is allowed', () => {
    // Fitting to no scale is fitting to nothing, and a button that does nothing teaches people to stop
    // pressing them.
    selectOscillator()
    expect(screen.queryByRole('button', { name: /FIT TO SCALE/ })).toBeNull()
  })
})
