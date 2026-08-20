import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { gallery } from '../gallery/client'
import { useGalleryWindow } from '../gallery/window'
import { SharePatch } from './SharePatch'

/**
 * Publishing has to land somewhere. Reporting success and closing meant reopening the gallery to see
 * what you had just done, so it opens the gallery instead — and that is worth a test, since it is the
 * kind of wiring a later refactor drops without anything failing.
 */

const CODE = 'FGJaABAJBSMEAoUjiuuaDszNV6oJ5QAM'

let closed = 0

beforeEach(() => {
  localStorage.clear()
  closed = 0
  useGalleryWindow.setState({ open: false })
})

function fill(name: string, nickname: string): void {
  // The labels are capitals in the markup, like every other label in the app, so that is what is
  // queried rather than a prettier version of them.
  fireEvent.change(screen.getByLabelText('PATCH NAME'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('YOUR NICKNAME'), { target: { value: nickname } })
}

describe('SharePatch', () => {
  it('opens the gallery once the patch is published', async () => {
    render(<SharePatch code={CODE} onClose={() => (closed += 1)} />)
    fill('Two cascades', 'nick')
    fireEvent.click(screen.getByText('PUBLISH'))

    await waitFor(() => expect(useGalleryWindow.getState().open).toBe(true))
    // And gets out of the way, rather than stacking a window on a window.
    expect(closed).toBe(1)
    expect((await gallery.list('recent'))[0].name).toBe('Two cascades')
  })

  it('remembers the nickname, since typing it every time is a chore', async () => {
    render(<SharePatch code={CODE} onClose={() => (closed += 1)} />)
    fill('Thing', 'wilhelm')
    fireEvent.click(screen.getByText('PUBLISH'))

    await waitFor(() => expect(useGalleryWindow.getState().open).toBe(true))
    expect(localStorage.getItem('castillon.gallery.nickname')).toBe('wilhelm')
  })

  it('stays put and says what is missing rather than publishing something nameless', async () => {
    render(<SharePatch code={CODE} onClose={() => (closed += 1)} />)
    fill('', 'nick')
    fireEvent.click(screen.getByText('PUBLISH'))

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/name/i))
    expect(useGalleryWindow.getState().open).toBe(false)
    expect(closed).toBe(0)
  })

  it('says up front that this is public, and does not explain infrastructure', () => {
    render(<SharePatch code={CODE} onClose={() => (closed += 1)} />)
    expect(screen.getByText(/Anyone can see this/)).toBeDefined()
    // How the country is worked out is not the publisher's problem.
    expect(screen.queryByText(/country/i)).toBeNull()
  })
})
