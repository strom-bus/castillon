/**
 * The isotype's geometry, as data.
 *
 * A module of its own for two reasons. `public/favicon.svg` holds a second copy of this drawing that
 * cannot be generated from a component — a favicon is read before any script runs — and `logo.test.ts`
 * compares that copy against these numbers, so they have to be importable without dragging a
 * component along. Keeping them out of `Logo.tsx` also leaves that file exporting only its component,
 * which is what Fast Refresh needs.
 */

/** Node centres, in the 0-100 viewBox: one at the top, two below it. */
export const NODES = [
  { cx: 50, cy: 17 },
  { cx: 21, cy: 79 },
  { cx: 79, cy: 79 },
] as const

/** Half a node's width, whether it is drawn as a circle or a square. */
export const NODE_RADIUS = 15

/** The two cables, leaving the top node and curving down to the others. */
export const CABLES = ['M 42 27 C 33 41 27 56 24 65', 'M 58 27 C 67 41 73 56 76 65'] as const

export const CABLE_WIDTH = 11
