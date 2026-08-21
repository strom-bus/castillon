import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMidiStore } from '../input/midiStore'
import type { MidiState } from '../input/midi'
import { bindingLabel } from './keys'
import { MidiStatus } from './MidiStatus'

/**
 * The MIDI indicator, which exists to answer one question without being asked: is there a keyboard?
 *
 * Greyed rather than hidden, because an icon that appears only once it works cannot tell you that it
 * does not — and "nothing there" is the state somebody needs told.
 */

beforeEach(() => useMidiStore.setState({ state: 'idle', devices: [] }))

const show = (state: MidiState, devices: string[] = []) => {
  useMidiStore.setState({ state, devices })
  render(<MidiStatus />)
  return screen.getByRole('button')
}

describe('what it says', () => {
  it('says a device is not connected when access is granted and nothing is there', () => {
    // The state the whole thing was asked for.
    expect(show('empty').getAttribute('title')).toBe('MIDI device not connected')
  })

  it('names the device when there is one, rather than only saying there is', () => {
    // Which is the difference between believing it works and knowing.
    expect(show('connected', ['Arturia KeyStep 32']).getAttribute('title')).toContain(
      'Arturia KeyStep 32',
    )
  })

  it('does not blame a missing cable when the browser is what cannot do it', () => {
    // Telling somebody on Safari that no device is connected sends them looking for a cable that
    // would not have helped.
    expect(show('unsupported').getAttribute('title')).toContain('browser')
  })

  it('asks to be clicked before it has asked for permission', () => {
    expect(show('idle').getAttribute('title')).toContain('Click')
  })

  it('says a refusal is a refusal', () => {
    expect(show('denied').getAttribute('title')).toContain('refused')
  })
})

describe('how it looks and behaves', () => {
  it('is lit only when something is connected', () => {
    expect(show('connected').className).toContain('on')
  })

  it('is greyed in every other state', () => {
    for (const state of ['unsupported', 'idle', 'denied', 'empty'] as const) {
      useMidiStore.setState({ state, devices: [] })
      const { unmount } = render(<MidiStatus />)
      expect(screen.getByRole('button').className).not.toContain('on')
      unmount()
    }
  })

  it('is clickable only where clicking would do something', () => {
    // Asking for access is the one action it has. Clicking it with a keyboard already connected, or on
    // a browser that cannot do MIDI, should not look like it would help.
    expect(show('idle').getAttribute('aria-disabled')).toBe('false')
    useMidiStore.setState({ state: 'connected', devices: ['x'] })
    render(<MidiStatus />)
    expect(screen.getAllByRole('button').at(-1)?.getAttribute('aria-disabled')).toBe('true')
  })

  it('asks for access when clicked', () => {
    const connect = vi.fn()
    useMidiStore.setState({ state: 'idle', devices: [], connect })
    render(<MidiStatus />)
    fireEvent.click(screen.getByRole('button'))
    expect(connect).toHaveBeenCalled()
  })

  it('carries its message where a screen reader can reach it too, not only on hover', () => {
    expect(show('empty').getAttribute('aria-label')).toBe('MIDI device not connected')
  })
})

describe('what a binding looks like', () => {
  it('shows a note by name, not by number', () => {
    // `60` means nothing to anybody and `C4` means exactly one thing. This is what the Ignite node
    // shows as well as the capture button, which is why it lives beside `keyLabel`.
    expect(bindingLabel({ source: 'midi', code: '60' })).toBe('C4')
  })

  it('shows a key by its letter', () => {
    expect(bindingLabel({ source: 'key', code: 'KeyA' })).toBe('A')
  })

  it('falls back to the raw code rather than showing NaN', () => {
    expect(bindingLabel({ source: 'midi', code: 'nonsense' })).toBe('nonsense')
  })

  it('says nothing when there is no binding', () => {
    expect(bindingLabel(null)).toBe('')
  })
})
