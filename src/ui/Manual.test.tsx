import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLanguage } from '../help/language'
import { useManualWindow } from '../help/window'
import { usePatchStore } from '../state/patchStore'
import { Inspector } from './Inspector'
import { Manual } from './Manual'

/**
 * The manual: a window over the app, in one of two languages.
 *
 * What is worth testing is what would break quietly — that switching language actually changes what is
 * on the page rather than only which button looks pressed, that the choice survives a reload, and that
 * the button which opens it is reachable from where somebody would look for it.
 */

beforeEach(() => {
  useLanguage.setState({ language: 'en' })
  useManualWindow.setState({ open: false })
  localStorage.clear()
})

describe('the window', () => {
  it('opens in English and shows the idea first', () => {
    render(<Manual onClose={() => {}} />)
    expect(screen.getByText('The one idea')).toBeDefined()
  })

  it('changes what is written, not only which button is lit', () => {
    render(<Manual onClose={() => {}} />)
    fireEvent.click(screen.getByText('Español'))

    expect(screen.getByText('La idea')).toBeDefined()
    expect(screen.queryByText('The one idea')).toBeNull()
  })

  it('tells the page which language it is in, for anything reading it aloud', () => {
    render(<Manual onClose={() => {}} />)
    fireEvent.click(screen.getByText('Español'))
    expect(document.querySelector('.manual-body')?.getAttribute('lang')).toBe('es')
  })

  it('remembers the choice, so nobody picks their language twice', () => {
    render(<Manual onClose={() => {}} />)
    fireEvent.click(screen.getByText('Español'))
    expect(localStorage.getItem('castillon.manual.language')).toBe('es')
  })

  it('closes on Escape and on the button', () => {
    const onClose = vi.fn()
    render(<Manual onClose={onClose} />)

    fireEvent.click(screen.getByText('CLOSE'))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('does not close on a click that started inside it', () => {
    // The backdrop closes the window; a click on a paragraph must not.
    const onClose = vi.fn()
    render(<Manual onClose={onClose} />)
    fireEvent.click(screen.getByText('The one idea'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('carries every section, so nothing is written and never shown', () => {
    render(<Manual onClose={() => {}} />)
    for (const title of ['The one idea', 'The parts', 'Shortcuts']) {
      expect(screen.getByText(title)).toBeDefined()
    }
  })
})

describe('getting to it', () => {
  it('is offered by an empty inspector, under the basics', () => {
    // Where somebody with nothing selected is already looking, and after what they need in the first
    // minute rather than instead of it.
    usePatchStore.getState().select(null)
    render(<Inspector />)
    expect(screen.getByText('HELP')).toBeDefined()
  })

  it('opens when that is pressed', () => {
    usePatchStore.getState().select(null)
    render(<Inspector />)
    fireEvent.click(screen.getByText('HELP'))
    expect(useManualWindow.getState().open).toBe(true)
  })

  it('is not in the way once a node is selected', () => {
    // The panel is then doing its actual job, and a manual button among the parameters is noise.
    const id = usePatchStore.getState().nodes[0].id
    usePatchStore.getState().select(id)
    render(<Inspector />)
    expect(screen.queryByText('HELP')).toBeNull()
  })
})
