/**
 * How a card reads its own fields.
 *
 * Its own module so `Gallery.tsx` exports only a component — which is what Fast Refresh needs — and
 * so the two decisions here can be tested without rendering anything.
 */

/** Cloudflare's answers for "could not tell": Tor, and unknown. Neither is a place. */
const UNKNOWN_COUNTRIES = new Set(['XX', 'T1'])

/**
 * The country as its two letters, not as a flag.
 *
 * Emoji flags are not drawn at all on Windows — the system falls back to exactly these two letters —
 * so the code is what a large share of readers see either way, and it sits better with a monospaced
 * interface than a colour picture does.
 */
export function countryOf(country: string | null): string {
  if (!country || !/^[A-Za-z]{2}$/.test(country)) return ''
  const code = country.toUpperCase()
  return UNKNOWN_COUNTRIES.has(code) ? '' : code
}

/** Coarse on purpose: a card wants to say "yesterday", not a timestamp. */
export function relativeAge(from: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - from) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
