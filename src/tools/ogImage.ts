/**
 * Generates the link-preview image, from the same geometry the mark itself is drawn from.
 *
 * Run with `npm run og`. The result is committed, so this only runs when the mark changes — the same
 * reason `logoGeometry.ts` exists at all: one set of numbers, and a test that fails if a copy drifts.
 *
 * **The image carries no text, and that is a decision rather than a limitation.** A preview card is a
 * picture *plus* a title, and the title comes from `og:title` — typeset by whatever app is showing the
 * card, in its own font. Putting the name in the image would duplicate it, and would have to duplicate
 * it in the wrong typeface: Unbounded lives here as a `woff2` and a rasteriser cannot resolve it.
 * Checked rather than assumed — asking for Unbounded and asking for a font that does not exist produce
 * byte-identical renders.
 *
 * So the image is the one part of the identity that cannot be said in words: the isotype, and the ramp
 * that says which way is down.
 */

import sharp from 'sharp'
import { writeFileSync } from 'node:fs'
import { CABLE_WIDTH, CABLES, NODE_RADIUS, NODES } from '../ui/logoGeometry'
import { colorAt } from '../viz/depth'

/** What every crawler expects, and what they all crop towards. */
export const WIDTH = 1200
export const HEIGHT = 630

/** The app's own ground. */
const BACKGROUND = '#000000'
/** The deepest stop of the ramp, which is what the favicon uses flat. */
const BRAND = '#ff531f'

/** How much of the card's height the mark takes. There is nothing else in it, so it can breathe. */
const MARK_SHARE = 0.68

/** Enough samples for the ramp to read as continuous without hard-coding where its stops are. */
const GRADIENT_STEPS = 6

export type Palette = 'flat' | 'ramp'

/**
 * The mark, at card size, in one of two treatments.
 *
 * `flat` is the favicon's: one colour, which is right at sixteen pixels where a gradient could say
 * nothing. `ramp` uses the cascade's own colours — source at the top, deepest at the leaves — which is
 * the thing the favicon has no room for.
 *
 * The gradient is anchored in **user space across the cable's visible span**, from the bottom of the
 * source square to the top of the leaves, rather than to each path's bounding box. Two reasons: the
 * colour then means depth rather than "how far along this particular curve", and lengthening a cable
 * cannot shift it. Anchored to the bounding box, the cable arrived at a bright orange square in a dull
 * amber, with a seam where they met.
 */
export function markSvg(palette: Palette): string {
  const size = HEIGHT * MARK_SHARE
  const x = (WIDTH - size) / 2
  const y = (HEIGHT - size) / 2

  const source = NODES[0]
  const leaf = NODES[1]
  const from = source.cy + NODE_RADIUS
  const to = leaf.cy - NODE_RADIUS

  const stops = Array.from({ length: GRADIENT_STEPS }, (_, i) => {
    const t = i / (GRADIENT_STEPS - 1)
    const colour = palette === 'ramp' ? colorAt(t) : BRAND
    return `<stop offset="${t}" stop-color="${colour}"/>`
  }).join('')

  const cables = CABLES.map(
    (path) =>
      `<path d="${path}" stroke="url(#cascade)" stroke-width="${CABLE_WIDTH}" stroke-linecap="butt" fill="none"/>`,
  ).join('')

  const squares = NODES.map((node, i) => {
    const fill = palette === 'ramp' ? colorAt(i === 0 ? 0 : 1) : BRAND
    const side = NODE_RADIUS * 2
    return `<rect x="${node.cx - NODE_RADIUS}" y="${node.cy - NODE_RADIUS}" width="${side}" height="${side}" fill="${fill}"/>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <linearGradient id="cascade" gradientUnits="userSpaceOnUse" x1="0" y1="${from}" x2="0" y2="${to}">
      ${stops}
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${BACKGROUND}"/>
  <g transform="translate(${x} ${y}) scale(${size / 100})">${cables}${squares}</g>
</svg>`
}

/** Rasterises to PNG, which is what the crawlers take — none of them accept SVG reliably. */
export async function writeOgImage(palette: Palette, path: string): Promise<number> {
  const png = await sharp(Buffer.from(markSvg(palette)))
    .png({ compressionLevel: 9 })
    .toBuffer()
  writeFileSync(path, png)
  return png.length
}
