/**
 * Facts about the instrument that only prose states, in a form a test can read.
 *
 * The cable kinds are a type, and a type has no length. `EdgeKind` is a union, so nothing at runtime can
 * count it — which is why the README's "four overlaid graphs" was able to say three for as long as it
 * did. Listing them here gives the count a home that a test can reach and that fails to compile if the
 * union changes underneath it.
 */

import type { EdgeKind } from '../types/patch'

export const EDGE_KINDS_IN_ORDER: readonly EdgeKind[] = ['event', 'audio', 'mod', 'warp']
