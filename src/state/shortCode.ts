/**
 * Short codes: six characters that stand in for a patch code.
 *
 * A six-character code holds thirty bits, and a patch runs to thousands, so a short code cannot
 * *contain* a patch — only refer to one. It is the hash of the patch code, which buys three things
 * a counter would not:
 *
 * - the same patch always yields the same code, so sharing twice creates nothing new;
 * - change the patch and the code changes, which is the snapshot behaviour the long code has;
 * - no sequence to synchronise, and nothing revealed about how many patches exist.
 *
 * Collisions are settled where they can be seen: the service refuses to overwrite a code that holds
 * different content, and answers with a longer one instead.
 */

/**
 * Crockford's base32, which drops I, L, O and U. Chosen over base62 because these are meant to be
 * read aloud and typed: there is no 0/O or 1/l to get wrong, and no accidental words.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export const SHORT_CODE_LENGTH = 6
/** How far the service may extend a code to settle a collision. */
export const MAX_SHORT_CODE_LENGTH = 10

/**
 * 64-bit FNV-1a, carried in two 32-bit halves since JavaScript numbers cannot hold it exactly.
 *
 * Not a cryptographic hash, and it does not need to be: nothing is gained by colliding with someone
 * else's patch, because the service will not let a collision overwrite anything.
 */
function hash(input: string): [number, number] {
  let high = 0xcbf2_9ce4
  let low = 0x84222325

  for (let i = 0; i < input.length; i++) {
    low ^= input.charCodeAt(i) & 0xff

    // Multiply by the FNV prime, 2^40 + 2^8 + 0xb3, as shifts and adds on the two halves.
    const lowShift8 = (low << 8) >>> 0
    const highShift8 = (((high << 8) >>> 0) | (low >>> 24)) >>> 0
    const lowShift40 = 0
    const highShift40 = (low << 8) >>> 0

    let nextLow = low * 0xb3
    let nextHigh = high * 0xb3 + Math.floor(nextLow / 0x1_0000_0000)
    nextLow = nextLow >>> 0

    nextLow = (nextLow + lowShift8) >>> 0
    nextHigh = (nextHigh + highShift8 + (nextLow < lowShift8 ? 1 : 0)) >>> 0
    nextLow = (nextLow + lowShift40) >>> 0
    nextHigh = (nextHigh + highShift40) >>> 0

    low = nextLow
    high = nextHigh >>> 0
  }

  return [high >>> 0, low >>> 0]
}

/** The code a given patch code always produces, at the requested length. */
export function shortCodeFor(patchCode: string, length = SHORT_CODE_LENGTH): string {
  const trimmed = patchCode.trim()
  let [high, low] = hash(trimmed)
  let out = ''

  for (let i = 0; i < length; i++) {
    out += ALPHABET[low & 31]
    // Shift the pair right by five, feeding the high half down into the low one.
    low = ((low >>> 5) | ((high & 31) << 27)) >>> 0
    high = high >>> 5
    // Long codes would run out of hash, so it is stirred with the round number rather than
    // repeating.
    if (high === 0 && low === 0) [high, low] = hash(`${trimmed}#${i}`)
  }

  return out
}

/** Whether something typed into the patch field is a short code rather than a patch. */
export function looksLikeShortCode(input: string): boolean {
  const trimmed = input.trim().toUpperCase()
  if (trimmed.length < SHORT_CODE_LENGTH || trimmed.length > MAX_SHORT_CODE_LENGTH) return false
  return [...trimmed].every((char) => ALPHABET.includes(char))
}

/**
 * Reads a code the way a person might have written it: lower case, and with the letters Crockford
 * leaves out mapped to the digits they get mistaken for.
 */
export function normaliseShortCode(input: string): string {
  return input.trim().toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0').replace(/U/g, 'V')
}
