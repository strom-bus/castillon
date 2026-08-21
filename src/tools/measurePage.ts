/**
 * The entry for measure.html. Nothing but wiring: a button, a running commentary, and the report.
 *
 * Kept in src/ rather than beside the page so that `npm run typecheck` covers it — a development tool
 * outside the compiler's reach is a development tool that stops compiling without anyone noticing.
 */

import { formatReport, measureLoad, type Measured } from './measureLoad'

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
