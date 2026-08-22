import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLanguage } from '../help/language'
import { useManualWindow } from '../help/window'
import { usePatchStore } from '../state/patchStore'
import { Inspector } from './Inspector'
import { Manual } from './Manual'
import { MANUAL } from '../help/manual'

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

  it('says which of the two is showing, for anything that cannot see which is lit', () => {
    render(<Manual onClose={() => {}} />)
    expect(screen.getByText('EN').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('ESP').getAttribute('aria-pressed')).toBe('false')
  })

  it('changes what is written, not only which button is lit', () => {
    render(<Manual onClose={() => {}} />)
    fireEvent.click(screen.getByText('ESP'))

    expect(screen.getByText('La idea')).toBeDefined()
    expect(screen.queryByText('The one idea')).toBeNull()
  })

  it('tells the page which language it is in, for anything reading it aloud', () => {
    render(<Manual onClose={() => {}} />)
    fireEvent.click(screen.getByText('ESP'))
    expect(document.querySelector('.manual-body')?.getAttribute('lang')).toBe('es')
  })

  it('remembers the choice, so nobody picks their language twice', () => {
    render(<Manual onClose={() => {}} />)
    fireEvent.click(screen.getByText('ESP'))
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

/**
 * Read more, and the way back.
 *
 * The manual has two audiences wanting opposite things: somebody who has used a synthesiser wants the
 * ideas and the differences and stops there, while somebody who has not needs to know what every slider
 * does. Folding the second away keeps the first short — and only works if getting back is obvious, since
 * a reader who feels lost in a manual closes it.
 */
describe('reading further', () => {
  it('offers more on every section that has more', () => {
    render(<Manual onClose={() => {}} />)
    const more = screen.getAllByRole('button', { name: /read more/i })
    expect(more.length).toBe(MANUAL.filter((section) => section.detail?.length).length)
    expect(more.length).toBeGreaterThan(0)
  })

  it('shows one section detail in place of the list', () => {
    // In place of, not folded into: detail expanded inline pushes everything after it out of reach and
    // the reader loses where they were.
    render(<Manual onClose={() => {}} />)
    fireEvent.click(screen.getAllByRole('button', { name: /read more/i })[0]!)

    expect(screen.queryAllByRole('button', { name: /read more/i })).toHaveLength(0)
    expect(screen.getByText(MANUAL[0]!.detail![0]!.term.en)).toBeTruthy()
  })

  it('comes back to the list, and to the top of it', () => {
    render(<Manual onClose={() => {}} />)
    fireEvent.click(screen.getAllByRole('button', { name: /read more/i })[0]!)
    fireEvent.click(screen.getByRole('button', { name: /back to the manual/i }))

    expect(screen.getAllByRole('button', { name: /read more/i }).length).toBeGreaterThan(0)
  })

  it('lets Escape leave the section before it leaves the manual', () => {
    // Otherwise reading one page costs the whole manual to get out of, which teaches people not to open
    // one in the first place.
    let closed = false
    render(<Manual onClose={() => (closed = true)} />)
    fireEvent.click(screen.getAllByRole('button', { name: /read more/i })[0]!)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closed).toBe(false)
    expect(screen.getAllByRole('button', { name: /read more/i }).length).toBeGreaterThan(0)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closed).toBe(true)
  })

  it('says both in Spanish too, since a beginner is the reader here', () => {
    render(<Manual onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'ESP' }))

    fireEvent.click(screen.getAllByRole('button', { name: /leer más/i })[0]!)
    expect(screen.getByRole('button', { name: /volver al manual/i })).toBeTruthy()
  })
})
