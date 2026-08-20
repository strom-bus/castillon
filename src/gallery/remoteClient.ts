/**
 * The shared gallery, over the sharing service.
 *
 * Deliberately thin: every decision about who may do what is on the far side, because a rule a
 * browser enforces is a rule anybody can turn off. What this does is carry the browser's id along
 * and turn the answers into what the window expects.
 */
import { publisherId } from './identity'
import type { GalleryClient, GalleryEntry, GallerySort, PublishRequest } from './types'

interface Wire {
  id: string
  code: string
  name: string
  author: string
  country: string | null
  createdAt: number
  stars: number
  starred: boolean
  mine: boolean
}

/** The service answers a message worth showing; a network failure does not. */
async function fail(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const body = (await response.json()) as { error?: string }
    if (typeof body.error === 'string' && body.error) message = body.error
  } catch {
    // No JSON body: the fallback says enough.
  }
  throw new Error(message)
}

export function createRemoteGallery(service: string): GalleryClient {
  const base = `${service.replace(/\/+$/, '')}/gallery`

  return {
    async list(sort: GallerySort, page = 0) {
      const viewer = encodeURIComponent(publisherId())
      const response = await fetch(`${base}?sort=${sort}&page=${page}&viewer=${viewer}`)
      if (!response.ok) await fail(response, 'The gallery could not be reached.')
      const body = (await response.json()) as { entries: Wire[]; hasMore: boolean }
      return { entries: body.entries as GalleryEntry[], hasMore: body.hasMore }
    },

    async publish(request: PublishRequest) {
      const response = await fetch(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...request, publisher: publisherId() }),
      })
      if (!response.ok) await fail(response, 'That could not be published.')
      return (await response.json()) as GalleryEntry
    },

    async star(id: string) {
      const response = await fetch(`${base}/${encodeURIComponent(id)}/star`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publisher: publisherId() }),
      })
      if (!response.ok) await fail(response, 'That star did not stick.')
      return (await response.json()) as GalleryEntry
    },

    async remove(id: string) {
      const response = await fetch(`${base}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publisher: publisherId() }),
      })
      // 204 with no body is the success here, and 404 means it was already gone.
      if (!response.ok && response.status !== 404) {
        await fail(response, 'That entry could not be withdrawn.')
      }
    },
  }
}
