import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { installHistory } from '../history/patchHistory'
import { usePatchStore } from '../state/patchStore'
import { UndoRedo } from './UndoRedo'

/**
 * The buttons, and the thing they say that the keystroke cannot: whether there is anything to go back
 * to. A shortcut that does nothing gives no answer at all.
 */

let teardown: () => void

beforeEach(() => {
  usePatchStore.getState().resetPatch()
  teardown = installHistory()
})

afterEach(() => teardown())

const store = () => usePatchStore.getState()
/**
 * Mutating the store outside `act` leaves React with the update queued and the button still drawn
 * from the old state. The app has no such problem — Zustand subscribes properly — so this is the test
 * catching up with React rather than a defect being papered over.
 */
const edit = (change: () => void) => act(() => change())
const undoButton = () => screen.getByLabelText('Undo') as HTMLButtonElement
const redoButton = () => screen.getByLabelText('Redo') as HTMLButtonElement

describe('UndoRedo', () => {
  it('starts with both disabled, since nothing has happened', () => {
    render(<UndoRedo />)
    expect(undoButton().disabled).toBe(true)
    expect(redoButton().disabled).toBe(true)
  })

  it('enables undo once something has been done', () => {
    render(<UndoRedo />)
    edit(() => store().addNode('osc', { x: 0, y: 0 }))
    expect(undoButton().disabled).toBe(false)
  })

  it('steps back when clicked', () => {
    render(<UndoRedo />)
    const before = store().nodes.length
    edit(() => store().addNode('osc', { x: 0, y: 0 }))
    fireEvent.click(undoButton())
    expect(store().nodes).toHaveLength(before)
  })

  it('enables redo only after an undo, and puts the work back', () => {
    render(<UndoRedo />)
    edit(() => store().addNode('osc', { x: 0, y: 0 }))
    const after = store().nodes.length
    expect(redoButton().disabled).toBe(true)

    fireEvent.click(undoButton())
    expect(redoButton().disabled).toBe(false)
    fireEvent.click(redoButton())
    expect(store().nodes).toHaveLength(after)
  })

  it('names its keystroke, so the shortcut is discoverable from the button', () => {
    render(<UndoRedo />)
    expect(undoButton().title).toMatch(/Z/)
    expect(redoButton().title).toMatch(/Shift/)
  })

  it('draws the two arrows as mirror images rather than two drawings', () => {
    // One geometry, flipped: two hand-drawn arrows are two chances to disagree.
    const { container } = render(<UndoRedo />)
    const mirrored = container.querySelectorAll('svg g[transform]')
    expect(mirrored).toHaveLength(1)
  })
})
