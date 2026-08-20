/**
 * This browser's identity, as far as the gallery is concerned.
 *
 * A random id, minted on first use and kept in `localStorage`. It is what puts a trash icon on your
 * own entry and what stops one browser starring the same patch twice — and it is deliberately not an
 * account, an address or anything a person has to remember (PLAN §12.6).
 *
 * It leaves here as itself and is stored only as a hash: the service digests it on arrival, so the
 * table it lands in cannot be read for the means to delete anyone's work.
 */

const KEY = 'castillon.gallery.publisher'

export function publisherId(): string {
  try {
    const existing = localStorage.getItem(KEY)
    if (existing) return existing
    const minted = `p-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    localStorage.setItem(KEY, minted)
    return minted
  } catch {
    // Storage refused: a session without a trash icon still beats one that cannot publish.
    return ''
  }
}
