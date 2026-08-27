import { create } from 'zustand'

/**
 * Whether the gallery window is open.
 *
 * A store of its own, tiny on purpose. Two places open the window and they are nowhere near each
 * other: the titlebar button, and the publish form buried inside the patch code cluster. Threading a
 * callback from the app root down through the transport and the code field would put the gallery in
 * the signature of two components that have nothing to do with it.
 *
 * Not part of the patch store either: this is where the app is looking, not what the patch is.
 */
/** The two halves the window holds: what came with the machine, and what people made with it. */
export const GALLERY_VIEWS = ['presets', 'gallery'] as const
export type GalleryView = (typeof GALLERY_VIEWS)[number]

export const useGalleryWindow = create<{
  open: boolean
  /**
   * Which half to open on, which is not the same question for the two places that open it.
   *
   * The titlebar button opens on the presets, because the gallery is a network request that may be
   * empty, slow or unreachable and that is the wrong first impression. Publishing opens on the gallery,
   * because it *cannot* be empty — something was just put in it, and the thing somebody wants to see
   * after adding a thing is the thing they added.
   */
  view: GalleryView
  show(view?: GalleryView): void
  hide(): void
}>((set) => ({
  open: false,
  view: 'presets',
  /*
   * Validated rather than trusted, for one specific reason: `show` is small enough to be handed
   * straight to an `onClick`, and React calls that with a `MouseEvent`. Typed as `() => void` the
   * compiler allows it and the store would open on a view called `[object MouseEvent]`.
   */
  show: (view) =>
    set({ open: true, view: GALLERY_VIEWS.includes(view as GalleryView) ? view! : 'presets' }),
  hide: () => set({ open: false }),
}))
