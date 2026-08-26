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
/**
 * Gzipped kilobytes for any one chunk fetched later, each of which is one interaction's wait.
 *
 * Raised from sixty when the manual's entries grew example rows, and raised **with a condition attached**
 * rather than because it failed — a budget moved to fit what happened to it is not a budget.
 *
 * The condition: about half of what this chunk carries is a language the reader will never see, since
 * every passage holds both. That is the real waste and it has a real fix — load the language being read
 * — which is worth doing at eighty and is not worth doing at sixty, because the chunk is fetched once,
 * on a deliberate click, and then cached while somebody reads for minutes. So eighty is the line where
 * the answer stops being "raise it" and becomes "split it", and this comment is here so that the next
 * person to hit it does the second thing.
 */
const DEFERRED_LIMIT = 80

/** Chunks that are fetched only when somebody opens the thing they belong to. */
const DEFERRED = ['Manual', 'Gallery']

/**
 * How far the README's table may drift from the build before it is a lie.
 *
 * A budget catches a chunk getting too big. Nothing caught the *documentation* getting stale, and it had:
 * the table said the manual was about thirty kilobytes when it had reached thirty-nine, and the entry
 * chunk forty when it was forty-four. Both inside every budget and both wrong by enough that a reader
 * planning around them would plan around the wrong thing.
 *
 * Twenty per cent, because the table says "~" and a table of approximate sizes that has to be edited on
 * every release is a table nobody edits. Wide enough to ignore ordinary growth, narrow enough that a
 * third of a chunk appearing out of nowhere is a failure.
 */
const DRIFT = 0.2

/**
 * The table itself, **read out of the README** rather than copied beside it.
 *
 * It was copied: an object here holding five numbers that had to agree with five numbers in a markdown
 * table, which is this repository's most familiar bug wearing its documentation clothes — one fact
 * declared twice, and the copy the compiler cannot see is the one that falls behind. Editing the README
 * and forgetting this line failed the build with a message about the README being wrong when it was the
 * only one that was right.
 */
function documented(): Record<string, number> {
  const table = readFileSync('README.md', 'utf8')
  const found: Record<string, number> = {}
  // | `Manual`  | ~39 kB  | Only if the manual is opened |
  for (const [, name, size] of table.matchAll(/^\|\s*`(\w+)`\s*\|\s*~(\d+) kB/gm)) {
    found[name] = Number(size)
  }
  return found
}

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
 * The README's table, which is the one number here a reader takes away and the one nothing was checking.
 */
const DOCUMENTED = documented()

/*
 * Every chunk worth naming has to be in the table, asked of the build rather than of a list.
 *
 * Both directions matter and only one of them was covered. A row nobody updates is caught below; a row
 * that goes *missing* — or a reader that quietly stops matching one — would leave that chunk unchecked
 * and the build green, which is this file's own failure mode happening to this file. A kilobyte is the
 * line between a chunk and the runtime shim, which is four hundred bytes and not worth a row.
 */
const WORTH_NAMING = 1
for (const chunk of all) {
  if (kb(chunk.gzip) < WORTH_NAMING) continue
  if (Object.keys(DOCUMENTED).some((prefix) => chunk.name.startsWith(prefix))) continue
  failures.push(
    `${chunk.name} is ${kb(chunk.gzip).toFixed(1)} kB gzipped and the README's chunk table does not ` +
      'name it. Add a row to "What a first visit downloads", or the table is a list of some of the ' +
      'chunks presented as all of them.',
  )
}

for (const [prefix, stated] of Object.entries(DOCUMENTED)) {
  const chunk = all.find((one) => one.name.startsWith(prefix))
  if (!chunk) {
    failures.push(`the README's chunk table names ${prefix}, and the build has no such chunk.`)
    continue
  }
  const actual = kb(chunk.gzip)
  if (Math.abs(actual - stated) / stated > DRIFT) {
    failures.push(
      `the README says ${prefix} is about ${stated} kB gzipped and it is ${actual.toFixed(1)} kB. ` +
        'Update the table in "How the output is split" — a stated size nobody maintains is worse than ' +
        'none, because a reader believes it.',
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
