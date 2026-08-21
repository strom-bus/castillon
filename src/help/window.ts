/**
 * Whether the manual is open.
 *
 * Its own store for the same reason the gallery has one: the button that opens it is buried in the
 * inspector's empty state, and the window has to render at the app root so its backdrop covers
 * everything. Threading a callback between them would put the manual in the signature of components
 * that have nothing to do with it.
 */
import { create } from 'zustand'

export const useManualWindow = create<{
  open: boolean
  show(): void
  hide(): void
}>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}))
