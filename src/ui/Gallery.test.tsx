import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { gallery } from '../gallery/client'
import { encodePatch } from '../state/patchCode'
import { toPatch, usePatchStore } from '../state/patchStore'
import { Gallery } from './Gallery'

/**
 * The window as a person meets it: what it says when empty, that a published patch appears in it with
 * a drawing of itself, that a star can be given and taken back, and that choosing a card loads the
 * patch and closes the window.
 */

let closed = 0
const close = () => {
  closed += 1
}

beforeEach(() => {
  localStorage.clear()
  closed = 0
  usePatchStore.getState().resetPatch()
})

async function publishCurrentPatch(name: string): Promise<void> {
  await gallery.publish({ code: encodePatch(toPatch()), name, author: 'nick' })
}

describe('Gallery', () => {
  it('says how to fill it rather than showing an empty grid', async () => {
    render(<Gallery onClose={close} />)
    await waitFor(() => expect(screen.getByText(/No patches here yet/)).toBeDefined())
    expect(screen.getByText(/SHARE/)).toBeDefined()
  })

  it('shows a published patch with its name, author and a drawing of itself', async () => {
    await publishCurrentPatch('Two cascades')
    render(<Gallery onClose={close} />)

    await waitFor(() => expect(screen.getByText('Two cascades')).toBeDefined())
    expect(screen.getByText(/nick/)).toBeDefined()
    // The thumbnail: a card draws its own patch rather than showing a placeholder.
    expect(document.querySelector('.thumb')).not.toBeNull()
    expect(document.querySelectorAll('.thumb rect').length).toBeGreaterThan(0)
  })

  it('gives a star and takes it back', async () => {
    await publishCurrentPatch('Thing')
    render(<Gallery onClose={close} />)

    const give = await waitFor(() => screen.getByLabelText('Give a star'))
    fireEvent.click(give)
    await waitFor(() => expect(screen.getByLabelText('Remove star')).toBeDefined())
    expect(screen.getByText('1')).toBeDefined()

    fireEvent.click(screen.getByLabelText('Remove star'))
    await waitFor(() => expect(screen.getByLabelText('Give a star')).toBeDefined())
    expect(screen.getByText('0')).toBeDefined()
  })

  it('offers to withdraw an entry this browser published', async () => {
    await publishCurrentPatch('Mine')
    render(<Gallery onClose={close} />)
    await waitFor(() => expect(screen.getByLabelText('Withdraw this patch')).toBeDefined())
  })

  it('loads the patch and closes when a card is chosen', async () => {
    await publishCurrentPatch('Thing')
    // Empty the canvas, so loading the entry has something visible to restore.
    usePatchStore.setState({ nodes: [], edges: [] })

    render(<Gallery onClose={close} />)
    fireEvent.click(await waitFor(() => screen.getByTitle('Load this patch')))

    await waitFor(() => expect(usePatchStore.getState().nodes.length).toBeGreaterThan(0))
    expect(closed).toBe(1)
  })

  it('closes on Escape, as a window over a page should', async () => {
    render(<Gallery onClose={close} />)
    await waitFor(() => expect(screen.getByText('CLOSE')).toBeDefined())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closed).toBe(1)
  })

  it('opens on most recent, so a popularity ranking cannot ossify the list', async () => {
    // PLAN §12.7: whatever is posted first would otherwise collect the stars and stay on top.
    render(<Gallery onClose={close} />)
    await waitFor(() => expect(screen.getByText('RECENT')).toBeDefined())
    expect(screen.getByText('RECENT').className).toContain('on')
    expect(screen.getByText('POPULAR').className).not.toContain('on')
  })

  it('says out loud that nothing is shared yet', async () => {
    // Being honest about a private shelf matters more than looking finished.
    render(<Gallery onClose={close} />)
    await waitFor(() => expect(screen.getByText(/Nothing is shared yet/)).toBeDefined())
  })
})
