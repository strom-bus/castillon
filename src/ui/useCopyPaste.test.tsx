import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { usePatchStore } from '../state/patchStore'
import { useCopyPaste } from './useCopyPaste'

/** Somewhere for the keystrokes to land, with a text field to test the guard against. */
function Host() {
  useCopyPaste()
  return <input aria-label="text" defaultValue="some text" />
}

const state = () => usePatchStore.getState()
const oscs = () => state().nodes.filter((n) => n.type === 'osc')

function selectFirstOsc() {
  const first = oscs()[0]
  usePatchStore.setState((s) => ({
    nodes: s.nodes.map((n) => ({ ...n, selected: n.id === first.id })),
    selectedId: first.id,
  }))
}

const press = (key: string, target: Window | Element = window, extra: object = {}) =>
  fireEvent.keyDown(target, { key, metaKey: true, ...extra })

beforeEach(() => {
  usePatchStore.setState({ clipboard: null })
  usePatchStore.getState().resetPatch()
})

describe('the copy and paste shortcut', () => {
  it('copies and pastes the selected node', () => {
    render(<Host />)
    selectFirstOsc()
    const before = oscs().length

    press('c')
    press('v')
    expect(oscs()).toHaveLength(before + 1)
  })

  it('works with Ctrl as well as Cmd', () => {
    render(<Host />)
    selectFirstOsc()
    const before = oscs().length

    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })
    expect(oscs()).toHaveLength(before + 1)
  })

  it('takes the key whichever case it arrives in', () => {
    render(<Host />)
    selectFirstOsc()
    const before = oscs().length

    press('C')
    press('V')
    expect(oscs()).toHaveLength(before + 1)
  })

  it('leaves a text field alone, so copying a patch code still copies text', () => {
    // The failure this guards: selecting the patch code and pressing Cmd+C copying the node behind
    // it instead of the text.
    const { getByLabelText } = render(<Host />)
    const input = getByLabelText('text')
    selectFirstOsc()
    const before = oscs().length

    press('c', input)
    press('v', input)
    expect(oscs()).toHaveLength(before)
  })

  it('ignores the keys without the modifier', () => {
    render(<Host />)
    selectFirstOsc()
    const before = oscs().length

    fireEvent.keyDown(window, { key: 'c' })
    fireEvent.keyDown(window, { key: 'v' })
    expect(oscs()).toHaveLength(before)
  })

  it('ignores a combination that means something else', () => {
    render(<Host />)
    selectFirstOsc()
    const before = oscs().length

    press('c', window, { altKey: true })
    press('v', window, { altKey: true })
    expect(oscs()).toHaveLength(before)
  })

  it('stops listening once it is gone', () => {
    const view = render(<Host />)
    selectFirstOsc()
    press('c')
    view.unmount()

    const before = oscs().length
    press('v')
    expect(oscs()).toHaveLength(before)
  })
})
