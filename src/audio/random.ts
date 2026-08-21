/**
 * A deterministic random source, so that rendering the same patch twice gives the same file.
 *
 * Three places in the engine draw random numbers: the four noise colours and the reverb's impulse
 * response. All of them already took their generator as a parameter defaulting to `Math.random`
 * (PLAN §11.3), so making a render reproducible is threading one of these through rather than
 * rewriting any of them.
 *
 * **Only the export is seeded.** Live playback keeps `Math.random`, and that is deliberate: seeding
 * it too would mean rebuilding every noise buffer and every impulse response each time the patch
 * changed, since the seed would have to follow the patch. The export has no such problem — it gets a
 * fresh engine over a fresh context — and it is the one place where two runs are meant to match.
 *
 * What differs between a render and the playback you heard is therefore the grain of the noise and
 * the texture of a reverb tail. Not a note, not a time, not a level.
 */

export type Random = () => number

/**
 * Hashes a string to a seed. FNV-1a, which is small enough to read and spreads well enough that two
 * patch codes differing in one character do not land near each other.
 */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    // The FNV prime, by shifts because a 32-bit multiply in JS loses the high bits to the float.
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }
  // Unsigned, and never zero: a zero state would make some generators return zero forever.
  return hash >>> 0 || 1
}

/**
 * A generator from a seed — mulberry32.
 *
 * Chosen for being eleven lines with no dependency and good enough for noise and a reverb tail. This
 * is not a cryptographic generator and nothing here wants one; what is wanted is that the same seed
 * gives the same sequence in every browser, which a hand-written generator guarantees and
 * `Math.random` explicitly does not.
 */
export function seeded(seed: number): Random {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
