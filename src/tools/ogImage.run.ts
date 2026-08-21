/**
 * `npm run og`: writes the link-preview image.
 *
 * The ramp rather than the flat treatment, and for a reason worth stating: flat, the source square and
 * the two cables merge into one silhouette and the notch between them reads as a mistake. The ramp's
 * colour change separates them, so the card shows what the mark *means* — one thing feeding two — which
 * is exactly what a favicon has no room to say and a preview card does.
 */
import { writeOgImage } from './ogImage'

const bytes = await writeOgImage('ramp', 'public/og.png')
console.log(`public/og.png  ${(bytes / 1024).toFixed(1)} kB`)
