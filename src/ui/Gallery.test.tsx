import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { gallery } from '../gallery/client'
import { useGalleryWindow } from '../gallery/window'
import { encodePatch } from '../state/patchCode'
import { toPatch, usePatchStore } from '../state/patchStore'
import { Gallery } from './Gallery'
import { PRESETS } from '../presets/presets'

/**
 * The window as a person meets it: what it says when empty, that a published patch appears in it with
 * a drawing of itself, that a star can be given and taken back, and that choosing a card loads the
 * patch and closes the window.
 */

let closed = 0
const close = () => {
  closed += 1
}

/**
 * Opens the window and turns to the gallery, which is no longer what it opens on.
 *
 * Presets are: they are three patches that are always there, where the gallery is a request that can be
 * slow, unreachable, or — on a browser that has published nothing — simply empty. Every test below is
 * about the gallery half, so every one of them has to walk in the same door a person would.
 */
function openGallery(onClose: () => void = close) {
  const result = render(<Gallery onClose={onClose} />)
  fireEvent.click(screen.getByRole('button', { name: 'GALLERY' }))
  return result
}

beforeEach(() => {
  localStorage.clear()
  closed = 0
  usePatchStore.getState().resetPatch()
  useGalleryWindow.setState({ open: false, view: 'presets' })
})

async function publishCurrentPatch(name: string): Promise<void> {
  await gallery.publish({ code: encodePatch(toPatch()), name, author: 'nick' })
}

describe('Gallery', () => {
  it('says how to fill it rather than showing an empty grid', async () => {
    openGallery()
    await waitFor(() => expect(screen.getByText(/No patches here yet/)).toBeDefined())
    expect(screen.getByText(/SHARE/)).toBeDefined()
  })

  it('shows a published patch with its name, author and a drawing of itself', async () => {
    await publishCurrentPatch('Two cascades')
    openGallery()

    await waitFor(() => expect(screen.getByText('Two cascades')).toBeDefined())
    expect(screen.getByText(/nick/)).toBeDefined()
    // The thumbnail: a card draws its own patch rather than showing a placeholder.
    expect(document.querySelector('.thumb')).not.toBeNull()
    expect(document.querySelectorAll('.thumb rect').length).toBeGreaterThan(0)
  })

  it('gives a star and takes it back', async () => {
    await publishCurrentPatch('Thing')
    openGallery()

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
    openGallery()
    await waitFor(() => expect(screen.getByLabelText('Withdraw this patch')).toBeDefined())
  })

  it('loads the patch and closes when a card is chosen', async () => {
    await publishCurrentPatch('Thing')
    // Empty the canvas, so loading the entry has something visible to restore.
    usePatchStore.setState({ nodes: [], edges: [] })

    openGallery()
    fireEvent.click(await waitFor(() => screen.getByTitle('Load this patch')))

    await waitFor(() => expect(usePatchStore.getState().nodes.length).toBeGreaterThan(0))
    expect(closed).toBe(1)
  })

  it('closes on Escape, as a window over a page should', async () => {
    openGallery()
    await waitFor(() => expect(screen.getByText('CLOSE')).toBeDefined())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closed).toBe(1)
  })

  it('opens on most recent, so a popularity ranking cannot ossify the list', async () => {
    // PLAN §12.7: whatever is posted first would otherwise collect the stars and stay on top.
    openGallery()
    await waitFor(() => expect(screen.getByText('RECENT')).toBeDefined())
    expect(screen.getByText('RECENT').className).toContain('on')
    expect(screen.getByText('POPULAR').className).not.toContain('on')
  })

  it('says out loud that nothing is shared yet', async () => {
    // Being honest about a private shelf matters more than looking finished.
    openGallery()
    await waitFor(() => expect(screen.getByText(/Nothing is shared yet/)).toBeDefined())
  })
})

/**
 * The two halves of one window.
 *
 * Presets and the gallery answer the same question — what can this thing do — from opposite directions:
 * one is what came with the machine and the other is what people made with it. Two windows would have
 * been two answers a person has to know to look for separately.
 */
describe('which half it opens on', () => {
  /*
   * The window is unmounted when it closes, so it asks the store afresh every time it opens — which is
   * what lets the two openers disagree. The titlebar button wants the presets, because the gallery can
   * be empty; publishing wants the gallery, because it just stopped being able to be.
   *
   * Read at the tabs rather than at the store, since the store is already tested on its own: what could
   * still be wrong here is a window that asks and then ignores the answer.
   */
  const active = () =>
    ['PRESETS', 'GALLERY'].find((name) =>
      screen.getByRole('button', { name }).className.includes('on'),
    )

  it('opens on the presets when that is what the store says', () => {
    useGalleryWindow.setState({ open: true, view: 'presets' })
    render(<Gallery onClose={close} />)
    expect(active()).toBe('PRESETS')
  })

  it('opens on the gallery when that is what the store says', () => {
    useGalleryWindow.setState({ open: true, view: 'gallery' })
    render(<Gallery onClose={close} />)
    expect(active()).toBe('GALLERY')
  })
})

describe('presets', () => {
  it('is what the window opens on', () => {
    /*
     * Because the gallery can fail and the presets cannot. A request that is slow, unreachable, or empty
     * on a browser that has published nothing is a poor first answer from a window whose whole job is to
     * show what the machine does.
     */
    render(<Gallery onClose={close} />)
    expect(screen.getByRole('button', { name: 'PRESETS' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.getByText(PRESETS[0]!.name)).toBeTruthy()
  })

  it('shows every one with its name and what it is for', () => {
    // A preset with a name and nothing else is a patch you have to load to find out about.
    render(<Gallery onClose={close} />)
    for (const preset of PRESETS) {
      expect(screen.getByText(preset.name)).toBeTruthy()
      expect(screen.getByText(preset.about)).toBeTruthy()
    }
  })

  it('loads one into the canvas and closes', () => {
    let closed = false
    render(<Gallery onClose={() => (closed = true)} />)
    fireEvent.click(screen.getAllByTitle('Load this patch')[0]!)

    expect(closed).toBe(true)
    expect(toPatch(usePatchStore.getState()).nodes.length).toBe(PRESETS[0]!.patch.nodes.length)
  })

  it('hides the ordering, which asks a question about a list that arrives', () => {
    /*
     * Three patches in the order they should be read in have nothing to sort by. Asserted through the
     * accessible tree rather than by looking for the attribute: hidden that a screen reader still reads
     * out is not hidden, and this is the query that agrees with what a person can actually reach.
     */
    render(<Gallery onClose={close} />)
    expect(screen.queryByRole('button', { name: 'RECENT' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'GALLERY' }))
    expect(screen.getByRole('button', { name: 'RECENT' })).toBeTruthy()
  })

  it('goes to the gallery and back without leaving the window', () => {
    render(<Gallery onClose={close} />)
    fireEvent.click(screen.getByRole('button', { name: 'GALLERY' }))
    expect(screen.queryByText(PRESETS[0]!.about)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'PRESETS' }))
    expect(screen.getByText(PRESETS[0]!.about)).toBeTruthy()
  })
})
