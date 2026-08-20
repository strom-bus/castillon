/**
 * What the gallery stores and how the app asks for it.
 *
 * The interface is here rather than in the client so the window can be built and tested against a
 * local implementation while the Worker and its database are still being provisioned — the same
 * arrangement that let `worker.ts` be tested against a `Map` instead of KV.
 */

export interface GalleryEntry {
  /** The entry's own id. Several entries may point at one patch (PLAN §12.1). */
  id: string
  /**
   * The long patch code, not the short one. The short code is a pointer that has to be redeemed over
   * the network, and a card needs the graph itself: it draws the cascade's shape (PLAN §12.8), and
   * clicking it loads the patch without a round trip. `shortCodeFor` derives the six characters for
   * display from this.
   */
  code: string
  /** What the author called the patch. */
  name: string
  /** A nickname, not an account. */
  author: string
  /** Two letters from Cloudflare, or null where it could not be told (Tor, unknown). */
  country: string | null
  /** Epoch milliseconds. */
  createdAt: number
  stars: number
  /** Whether this browser has starred it, so a star cannot be given twice by accident. */
  starred: boolean
  /** Whether this browser published it and may still withdraw it (PLAN §12.6). */
  mine: boolean
}

export type GallerySort = 'recent' | 'popular'

export interface PublishRequest {
  code: string
  name: string
  author: string
}

export interface GalleryClient {
  list(sort: GallerySort): Promise<GalleryEntry[]>
  publish(request: PublishRequest): Promise<GalleryEntry>
  /** Toggles this browser's star. Returns the entry as it now stands. */
  star(id: string): Promise<GalleryEntry>
  remove(id: string): Promise<void>
}

/** Limits on the two free-text fields, which are the gallery's real risk surface (PLAN §12.4). */
export const MAX_NAME_LENGTH = 48
export const MAX_AUTHOR_LENGTH = 24
/** How long after publishing an author can still withdraw their own entry. */
export const WITHDRAW_WINDOW_MS = 24 * 60 * 60 * 1000
