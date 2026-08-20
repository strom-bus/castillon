/**
 * The gallery the app talks to.
 *
 * One place to choose an implementation, so the window never knows whether it is looking at a shared
 * wall or at this browser's own shelf. With no service configured it falls back to the local one, so
 * the feature degrades to a private shelf rather than to an error — the same way sharing degrades to
 * the long code.
 */
import { createLocalGallery } from './localClient'
import { createRemoteGallery } from './remoteClient'
import type { GalleryClient } from './types'

const SERVICE = String(import.meta.env.VITE_SHARE_URL ?? '').replace(/\/+$/, '')

/** Whether the gallery is shared with anyone else, which the window says out loud. */
export const galleryIsShared = SERVICE !== ''

export const gallery: GalleryClient = galleryIsShared
  ? createRemoteGallery(SERVICE)
  : createLocalGallery()
