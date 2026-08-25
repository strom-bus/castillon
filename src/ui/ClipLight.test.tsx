import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { engine } from '../audio/runtime'
import { ClipLight } from './ClipLight'

/**
 * The light that says the output is being held back.
 *
 * Everything about it is timing, which is why it is worth a test at all: it watches a *transient*
 * through a poll, so both halves can fail quietly. Poll and forget, and the light flickers where it
 * should hold. Hold and never look again, and it stays on for ever after one loud note.
 */

const dot = (container: HTMLElement) => container.querySelector('.clip-light')!

/** How hard the limiter says it is working, in decibels of reduction. */
function limitingAt(db: number) {
  vi.spyOn(engine, 'limiting').mockReturnValue(db)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the limiter light', () => {
  it('is dark while nothing is being held back', () => {
    limitingAt(0)
    const { container } = render(<ClipLight />)
    act(() => void vi.advanceTimersByTime(200))
    expect(dot(container).className).not.toContain('lit')
  })

  it('exists while it is dark, so it can be learned before it matters', () => {
    // An indicator that only appears when it fires is one nobody has ever seen when they need it.
    limitingAt(0)
    const { container } = render(<ClipLight />)
    expect(dot(container)).toBeTruthy()
  })

  it('lights once the limiter is working audibly', () => {
    limitingAt(-3)
    const { container } = render(<ClipLight />)
    act(() => void vi.advanceTimersByTime(100))
    expect(dot(container).className).toContain('lit')
  })

  it('ignores a reduction too small to hear', () => {
    // A tenth of a decibel is not a thing that has happened to anybody's mix, and a light that flickered
    // on it would be one people learn to ignore.
    limitingAt(-0.1)
    const { container } = render(<ClipLight />)
    act(() => void vi.advanceTimersByTime(200))
    expect(dot(container).className).not.toContain('lit')
  })

  it('holds after the moment has passed, then lets go', () => {
    /*
     * The half that a poll alone cannot do. Being held back lasts as long as the limiter's release —
     * a tenth of a second — and a light on for a tenth of a second is a light nobody sees.
     */
    limitingAt(-6)
    const { container } = render(<ClipLight />)
    act(() => void vi.advanceTimersByTime(100))
    expect(dot(container).className).toContain('lit')

    limitingAt(0)
    act(() => void vi.advanceTimersByTime(300))
    expect(dot(container).className, 'let go before the hold was up').toContain('lit')

    act(() => void vi.advanceTimersByTime(500))
    expect(dot(container).className, 'held on past the hold').not.toContain('lit')
  })
})
