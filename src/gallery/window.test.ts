import { beforeEach, describe, expect, it } from 'vitest'
import { GALLERY_VIEWS, useGalleryWindow } from './window'

/**
 * Which half of the gallery window opens, which is a different answer for the two places that open it.
 *
 * The titlebar button asks for nothing and gets the presets: the gallery is a network request that may
 * be empty, slow or unreachable, and a window whose job is to show what the machine does should not open
 * on the half that can fail. Publishing asks for the gallery, because it has just stopped being able to
 * be empty — and it was arriving on the presets, showing somebody who had added a patch the one half
 * that has nothing to do with it.
 */

describe('opening the gallery window', () => {
  beforeEach(() => {
    useGalleryWindow.setState({ open: false, view: 'presets' })
  })

  it('opens on the presets when nothing says otherwise', () => {
    useGalleryWindow.getState().show()
    expect(useGalleryWindow.getState()).toMatchObject({ open: true, view: 'presets' })
  })

  it('opens on the gallery when asked, which is what publishing asks for', () => {
    useGalleryWindow.getState().show('gallery')
    expect(useGalleryWindow.getState()).toMatchObject({ open: true, view: 'gallery' })
  })

  it('ignores something that is not a view', () => {
    /*
     * The specific accident this is here for: `show` is small enough to hand straight to an `onClick`,
     * and React calls that with a `MouseEvent`. Typed `() => void` the compiler allows it, and the window
     * would open on a view named after an event object — which renders as neither half.
     */
    const asClickHandler = useGalleryWindow.getState().show as (event: unknown) => void
    asClickHandler({ type: 'click', preventDefault() {} })
    expect(useGalleryWindow.getState().view).toBe('presets')
  })

  it('remembers nothing across a close, since the next opener decides again', () => {
    useGalleryWindow.getState().show('gallery')
    useGalleryWindow.getState().hide()
    useGalleryWindow.getState().show()
    expect(useGalleryWindow.getState().view).toBe('presets')
  })

  it('knows both halves and no others', () => {
    // The list the tabs are drawn from, so a third view cannot appear in one place and not the other.
    expect([...GALLERY_VIEWS]).toEqual(['presets', 'gallery'])
  })
})
