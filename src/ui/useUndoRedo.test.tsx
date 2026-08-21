import { fireEvent, render } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { installHistory, useHistoryStore } from '../history/patchHistory'
import { usePatchStore } from '../state/patchStore'
import { useUndoRedo } from './useUndoRedo'

/**
 * The shortcut, and the one rule that matters about it: a text field keeps its own undo. Cmd+Z inside
 * the patch code has to undo the typing, not the last thing done to the patch.
 */

function Harness() {
  useUndoRedo()
  return <input aria-label="a field" />
}

let teardown: () => void

beforeEach(() => {
  usePatchStore.getState().resetPatch()
  teardown = installHistory()
})

afterEach(() => teardown())

const store = () => usePatchStore.getState()
const press = (target: Element, init: Partial<KeyboardEventInit>) =>
  fireEvent.keyDown(target, { key: 'z', metaKey: true, ...init })

describe('useUndoRedo', () => {
  it('undoes on Cmd+Z', () => {
    const { container } = render(<Harness />)
    const before = store().nodes.length
    store().addNode('osc', { x: 0, y: 0 })

    press(container, {})
    expect(store().nodes).toHaveLength(before)
  })

  it('redoes on Cmd+Shift+Z', () => {
    const { container } = render(<Harness />)
    store().addNode('osc', { x: 0, y: 0 })
    const after = store().nodes.length

    press(container, {})
    press(container, { shiftKey: true })
    expect(store().nodes).toHaveLength(after)
  })

  it('redoes on Ctrl+Y as well, for the Windows habit', () => {
    const { container } = render(<Harness />)
    store().addNode('osc', { x: 0, y: 0 })
    const after = store().nodes.length

    fireEvent.keyDown(container, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(container, { key: 'y', ctrlKey: true })
    expect(store().nodes).toHaveLength(after)
  })

  it('leaves a text field its own undo', () => {
    const { getByLabelText } = render(<Harness />)
    const before = store().nodes.length
    store().addNode('osc', { x: 0, y: 0 })

    fireEvent.keyDown(getByLabelText('a field'), { key: 'z', metaKey: true })
    // Untouched: the keystroke belonged to the field, and the browser undoes the typing.
    expect(store().nodes).toHaveLength(before + 1)
  })

  it('ignores the key without its modifier', () => {
    const { container } = render(<Harness />)
    store().addNode('osc', { x: 0, y: 0 })
    const after = store().nodes.length

    fireEvent.keyDown(container, { key: 'z' })
    expect(store().nodes).toHaveLength(after)
  })

  it('does nothing when there is nothing to undo', () => {
    const { container } = render(<Harness />)
    const before = store().nodes.length
    press(container, {})
    expect(store().nodes).toHaveLength(before)
    expect(useHistoryStore.getState().canUndo).toBe(false)
  })
})
