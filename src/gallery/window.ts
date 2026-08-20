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
export const useGalleryWindow = create<{
  open: boolean
  show(): void
  hide(): void
}>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}))
