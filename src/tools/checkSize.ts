/**
 * A size budget for what a first visit has to download, checked after a build.
 *
 * The splitting this guards is easy to undo by accident and impossible to notice: one static `import`
 * of the manual anywhere in the entry graph pulls ninety kilobytes back into the chunk that blocks the
 * first paint, and nothing about that import looks wrong. The build still succeeds, the app still
 * works, and the only symptom is a slower load on a connection nobody testing it has.
 *
 * So the budget is on **what a browser must fetch before the canvas appears**: the entry chunk plus
 * the vendor chunks it depends on, gzipped, since that is what crosses the wire. Chunks fetched later
 * — the manual, the gallery — are reported and not counted, because deferring them is the point.
 *
 * The numbers are ceilings with room above today's figures, not targets. A budget that fails on every
 * commit gets raised without being read, which is the same as not having one.
 */

import { gzipSync } from 'node:zlib'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist/assets'

/**
 * Gzipped kilobytes a first visit must fetch before anything is on screen.
 *
 * Twenty above today's figure, which is room for real work and not much more. Set generously it stops
 * catching anything: statically importing the manual again came to 184 kB, which a 200 kB budget waves
 * through — the named-chunk check below is what caught that, and a byte budget loose enough to need
 * rescuing is a byte budget doing nothing.
 */
const FIRST_PAINT_LIMIT = 175
/** Gzipped kilobytes for any one chunk fetched later, each of which is one interaction's wait. */
const DEFERRED_LIMIT = 60

/** Chunks that are fetched only when somebody opens the thing they belong to. */
const DEFERRED = ['Manual', 'Gallery']

const kb = (bytes: number) => bytes / 1024

function chunks() {
  return readdirSync(DIST)
    .filter((name) => name.endsWith('.js'))
    .map((name) => {
      const raw = readFileSync(join(DIST, name))
      return { name, raw: raw.length, gzip: gzipSync(raw).length }
    })
    .sort((a, b) => b.gzip - a.gzip)
}

const all = chunks()
if (all.length === 0) {
  console.error('No chunks in dist/assets — run `npm run build` first.')
  process.exit(1)
}

const isDeferred = (name: string) => DEFERRED.some((prefix) => name.startsWith(prefix))
const upfront = all.filter((chunk) => !isDeferred(chunk.name))
const later = all.filter((chunk) => isDeferred(chunk.name))

const firstPaint = upfront.reduce((sum, chunk) => sum + chunk.gzip, 0)

console.log('first paint:')
for (const chunk of upfront) {
  console.log(`  ${kb(chunk.gzip).toFixed(1).padStart(7)} kB gz  ${chunk.name}`)
}
console.log(`  ${kb(firstPaint).toFixed(1).padStart(7)} kB gz  total, budget ${FIRST_PAINT_LIMIT}`)

if (later.length > 0) {
  console.log('on demand:')
  for (const chunk of later) {
    console.log(`  ${kb(chunk.gzip).toFixed(1).padStart(7)} kB gz  ${chunk.name}`)
  }
}

const failures: string[] = []
if (kb(firstPaint) > FIRST_PAINT_LIMIT) {
  failures.push(
    `first paint is ${kb(firstPaint).toFixed(1)} kB gzipped, over the ${FIRST_PAINT_LIMIT} kB budget. ` +
      'Something large is being imported by the entry graph — check for a static import of a window ' +
      'that used to be lazy.',
  )
}
for (const chunk of later) {
  if (kb(chunk.gzip) > DEFERRED_LIMIT) {
    failures.push(
      `${chunk.name} is ${kb(chunk.gzip).toFixed(1)} kB gzipped, over the ${DEFERRED_LIMIT} kB budget for a deferred chunk.`,
    )
  }
}

/*
 * And the other direction, which a budget on its own does not catch: the deferred chunks existing at
 * all. If somebody imports the manual statically, it stops being its own chunk and the first-paint
 * figure grows — but if the app were split differently tomorrow, a missing chunk would simply not be
 * checked. Naming them is what makes their absence a failure rather than a silence.
 */
for (const prefix of DEFERRED) {
  if (!all.some((chunk) => chunk.name.startsWith(prefix))) {
    failures.push(`${prefix} is not a chunk of its own any more — it is being loaded up front.`)
  }
}

if (failures.length > 0) {
  console.error('\nover budget:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('\nwithin budget.')
