/**
 * The gallery the app talks to.
 *
 * One place to choose an implementation, so the window never knows whether it is looking at a shared
 * wall or at this browser's own shelf. Today there is only the local one; when the Worker and its
 * database exist, the choice is made here and nothing above it changes.
 */
import { createLocalGallery } from './localClient'
import type { GalleryClient } from './types'

export const gallery: GalleryClient = createLocalGallery()

/** Whether the gallery is shared with anyone else, which the window says out loud. */
export const galleryIsShared = false
