import { normaliseShortCode } from './shortCode'

/**
 * The client half of sharing.
 *
 * Set at build time, empty until the service is deployed. Everything here is optional by design: the
 * long code is the primary path and works with no network at all, so an unset or unreachable service
 * costs the short-code convenience and nothing else.
 */
const SERVICE = String(import.meta.env.VITE_SHARE_URL ?? '').replace(/\/+$/, '')

export const sharingAvailable = SERVICE !== ''

/** Publishes a snapshot and answers the short code that now stands for it. */
export async function publishPatch(code: string): Promise<string> {
  if (!sharingAvailable) throw new Error('sharing is not set up')

  const response = await fetch(SERVICE, { method: 'POST', body: code })
  const body = (await response.text()).trim()
  if (!response.ok) throw new Error(body || 'could not share')
  return body
}

/** Null when there is no patch under that code, as opposed to throwing when the service is down. */
export async function resolveShortCode(id: string): Promise<string | null> {
  if (!sharingAvailable) throw new Error('sharing is not set up')

  const response = await fetch(`${SERVICE}/${normaliseShortCode(id)}`)
  if (response.status === 404) return null
  const body = (await response.text()).trim()
  if (!response.ok) throw new Error(body || 'could not reach the share service')
  return body
}
