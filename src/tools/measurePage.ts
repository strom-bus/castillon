/**
 * The entry for measure.html. Nothing but wiring: a button, a running commentary, and the report.
 *
 * Kept in src/ rather than beside the page so that `npm run typecheck` covers it — a development tool
 * outside the compiler's reach is a development tool that stops compiling without anyone noticing.
 */

import { formatReport, measureLoad, type Measured } from './measureLoad'
import { findCeiling, formatCeiling } from './findCeiling'
import {
  CEILING,
  LOAD_KINDS,
  LOAD_LABELS,
  LOAD_NOTES,
  startRamp,
  type LoadKind,
  type Ramp,
} from './loadRamp'

const run = document.getElementById('run') as HTMLButtonElement
const status = document.getElementById('status') as HTMLParagraphElement
const out = document.getElementById('out') as HTMLPreElement

/** Far enough from what load.ts says today to be worth changing the constant for. */
const WORTH_CHANGING = 0.25

function line(m: Measured): string {
  const drift = Math.abs(m.measured - m.current) / Math.max(m.current, 0.01)
  const mark = drift > WORTH_CHANGING ? ' ←' : ''
  return `${m.label.padEnd(20)} now ${m.current.toFixed(2).padStart(6)}   measured ${m.measured
    .toFixed(2)
    .padStart(6)}${mark}`
}

/**
 * The ceiling: a separate run, because it measures a different thing on a different thread.
 *
 * The relative costs come from timing an offline render — how fast audio can be produced when nothing
 * is waiting. A ceiling is the opposite question: whether every block is ready *in time*. Only
 * `renderCapacity` answers that, and only in realtime, which is why this one makes a sound.
 */
const ceiling = document.getElementById('ceiling') as HTMLButtonElement

/**
 * The ramp, one kind of load at a time.
 *
 * Reading it is a person's job here, since `renderCapacity` is not exposed in this browser — and
 * Chrome's WebAudio panel shows the same metric with no flag, so the eye is a perfectly good
 * instrument. Stepped by hand rather than on a timer: somebody reading a panel should not be racing
 * one.
 *
 * What makes this worth doing rather than the plain-voice ramp it replaces is the second number. The
 * points shown are the app's own accounting, so where they disagree with Chrome's percentage, that kind
 * of work is mispriced — and by how much, and in which direction.
 */
const kindsBox = document.getElementById('kinds') as HTMLDivElement
const kindNote = document.getElementById('kindNote') as HTMLParagraphElement
const unitsOut = document.getElementById('units') as HTMLSpanElement
const pointsOut = document.getElementById('points') as HTMLSpanElement
const shareOut = document.getElementById('share') as HTMLSpanElement
const kindName = document.getElementById('kindName') as HTMLSpanElement

let kind: LoadKind = 'sine'
let ramp: Ramp | null = null

function draw() {
  const units = ramp?.units() ?? 0
  const points = ramp?.points() ?? 0
  unitsOut.textContent = String(units)
  pointsOut.textContent = points.toFixed(0)
  shareOut.textContent = ((points / CEILING) * 100).toFixed(1)
  kindName.textContent = LOAD_LABELS[kind].toLowerCase()
  kindNote.textContent = LOAD_NOTES[kind]
}

async function chooseKind(next: LoadKind) {
  // A kind change tears the old ramp down: two kinds running at once would measure neither.
  await ramp?.stop()
  ramp = null
  kind = next
  for (const button of kindsBox.querySelectorAll('button')) {
    button.classList.toggle('on', button.dataset.kind === next)
  }
  draw()
}

for (const option of LOAD_KINDS) {
  const button = document.createElement('button')
  button.textContent = LOAD_LABELS[option]
  button.dataset.kind = option
  button.addEventListener('click', () => void chooseKind(option))
  kindsBox.append(button)
}

for (const [id, step] of [
  ['add1', 1],
  ['add10', 10],
  ['add100', 100],
] as const) {
  document.getElementById(id)?.addEventListener('click', async () => {
    ramp ??= await startRamp(kind)
    ramp.add(step)
    draw()
    status.textContent = `holding ${ramp.units()} ${LOAD_LABELS[kind].toLowerCase()}`
  })
}

document.getElementById('stopLoad')?.addEventListener('click', async () => {
  await ramp?.stop()
  ramp = null
  draw()
  status.textContent = 'stopped'
})

void chooseKind('sine')

ceiling.addEventListener('click', async () => {
  ceiling.disabled = true
  run.disabled = true
  out.textContent = ''
  try {
    const measured = await findCeiling(
      (label) => {
        status.textContent = `holding ${label}…`
      },
      // Filtered voices with a reverb every eight slots: closer to a patch than a wall of sines, which
      // is what mismeasured this the first time.
      { filtered: true, effectEvery: 8 },
    )
    status.textContent = measured.supported ? 'done' : 'no playbackStats — use the manual ramp'
    out.textContent = formatCeiling(measured)
    await navigator.clipboard.writeText(out.textContent).catch(() => {})
  } catch (error) {
    status.textContent = `failed: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    ceiling.disabled = false
    run.disabled = false
  }
})

run.addEventListener('click', async () => {
  run.disabled = true
  out.textContent = ''
  try {
    const report = await measureLoad((label) => {
      status.textContent = `measuring ${label}…`
    })
    status.textContent =
      'done — the arrows are where the current constant is off by a quarter or more'
    out.textContent = [
      formatReport(report),
      '',
      'Worth changing:',
      ...[...report.voices, ...report.effects].map(line),
    ].join('\n')
    // Straight to the clipboard as well, since the point of the run is to hand the numbers over.
    await navigator.clipboard.writeText(out.textContent).catch(() => {})
  } catch (error) {
    status.textContent = `failed: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    run.disabled = false
  }
})
