/**
 * Finding, for each kind of work, how much of it this machine can take — and what the model says that is.
 *
 * Two numbers per subject. **Units at the break** is the truth: how many of the thing it took before the
 * audio thread dropped a block. **Points at the break** is what the app believed that load was. Divide the
 * reference's points by the subject's and you have the factor the model is out by, per kind, with nothing
 * inferred in between.
 *
 * The search doubles until it breaks and then bisects, which takes each subject from several hundred trials
 * to about fourteen. Every trial is independent — a fresh context, a fresh graph — because a ramp that only
 * grows carries whatever its earlier rungs left behind and cannot go back down to refine.
 */

import { EFFECTS } from '../audio/effects'
import { MAX_LOAD } from '../audio/load'
import type { EffectKind } from '../types/patch'
import {
  audioTargets,
  probe,
  probingAvailable,
  projectedPoints,
  type Subject,
  type Trial,
} from './probe'

/** Where the doubling starts. Small enough that a very dear effect is bracketed on the first few. */
const FIRST = 8
/** Where it gives up on count: a subject this cheap is telling us it is not the limit. */
const CEILING_UNITS = 4096
/**
 * And where it gives up on cost, which is the guard that matters.
 *
 * Half again over the ceiling. Only enough headroom to bracket a break that should land near one times it,
 * and no more — every unit past that is main-thread work spent proving something already known. Set at four
 * times, the doubling reached loads this machine cannot even schedule, let alone render.
 */
const POINT_CAP = Math.round(MAX_LOAD * 1.5)
/** How tight the bisection gets, as a share of the bracket. Four per cent is well inside the noise. */
const PRECISION = 0.04

export interface Found {
  subject: Subject
  /** The largest load that held, and the smallest that broke. */
  clean: Trial | null
  broke: Trial | null
  /** The trial where the main thread, not the audio thread, ran out — which invalidates the search. */
  saturated: Trial | null
}

export interface Sweep {
  supported: boolean
  reference: Found | null
  effects: Found[]
  surcharges: Found[]
}

/**
 * Doubles until something breaks, then bisects the bracket.
 *
 * A trial that breaks is trusted immediately rather than repeated. That errs towards a *lower* break point,
 * which is the safe direction for a budget — and repeating every trial would triple a sweep that already
 * takes minutes.
 */
async function findBreak(subject: Subject, onStep: (label: string) => void): Promise<Found> {
  let clean: Trial | null = null
  let broke: Trial | null = null

  let units = FIRST
  while (units <= CEILING_UNITS && projectedPoints(subject, units) <= POINT_CAP) {
    onStep(
      `${subject.label} · ${units} units · ~${projectedPoints(subject, units).toFixed(0)} points`,
    )
    const trial = await probe(subject, units)
    // A saturated main thread is not a reading. Stop rather than double into a tab that stops answering.
    if (trial.saturated) return { subject, clean, broke: null, saturated: trial }
    if (trial.underruns > 0) {
      broke = trial
      break
    }
    clean = trial
    units *= 2
  }

  if (!broke) return { subject, clean, broke: null, saturated: null }

  // Bisect between the last load that held and the first that did not.
  let low = clean?.units ?? 0
  let high = broke.units
  while (high - low > Math.max(1, Math.round(high * PRECISION))) {
    const middle = Math.round((low + high) / 2)
    onStep(`${subject.label} · ${middle} units · narrowing`)
    const trial = await probe(subject, middle)
    if (trial.saturated) return { subject, clean, broke, saturated: trial }
    if (trial.underruns > 0) {
      broke = trial
      high = middle
    } else {
      clean = trial
      low = middle
    }
  }

  return { subject, clean, broke, saturated: null }
}

/**
 * Everything worth measuring, in the order the results depend on each other.
 *
 * The reference first, because every other figure is read against it. Then each effect. Then the surcharges,
 * which are pairs: the same effect with and without a modulator on one target, since a surcharge of two
 * points is 0.06 % of the ceiling and invisible on its own — ramped across hundreds of units it is not.
 */
export async function sweep(onStep: (label: string) => void): Promise<Sweep> {
  if (!(await probingAvailable())) {
    return { supported: false, reference: null, effects: [], surcharges: [] }
  }

  const reference = await findBreak({ label: 'voices', filtered: true }, onStep)

  const effects: Found[] = []
  for (const descriptor of EFFECTS) {
    effects.push(await findBreak({ label: descriptor.label, effect: descriptor.kind }, onStep))
  }

  /*
   * Surcharges on one effect rather than on all of them.
   *
   * The offline harness already measured every target; what is missing is how much the realtime case
   * differs. Three pairs give that factor — a biquad's frequency, a biquad's Q, and a gain as the control
   * that should cost nothing — and it applies to the offline table by the same pattern that held for the
   * effects themselves. Measuring all thirty pairs would take half an hour to refine numbers the margin
   * already absorbs.
   */
  const surcharges: Found[] = []
  const subject: EffectKind = 'filter'
  const wanted = ['cutoff', 'resonance', 'level'].filter((target) =>
    audioTargets(subject).includes(target),
  )

  surcharges.push(await findBreak({ label: 'filter · unswept', effect: subject }, onStep))
  for (const target of wanted) {
    surcharges.push(
      await findBreak({ label: `filter · ${target}`, effect: subject, modulate: target }, onStep),
    )
  }

  return { supported: true, reference, effects, surcharges }
}

/** What one subject's break point says the model is out by. */
function factor(found: Found, referencePoints: number): number | null {
  const points = found.clean?.points ?? found.broke?.points
  return points && points > 0 ? referencePoints / points : null
}

export function formatSweep(result: Sweep): string {
  if (!result.supported) {
    return [
      'No playbackStats here, so a dropout cannot be counted from the page and none of this can run.',
      'It ships in Chrome 146. The manual ramp below still works, read from the DevTools WebAudio panel.',
    ].join('\n')
  }

  const referencePoints = result.reference?.clean?.points ?? 0

  const row = (found: Found) => {
    const clean = found.clean?.points
    const units = found.clean?.units
    if (found.saturated) {
      const share = (found.saturated.schedulerShare * 100).toFixed(0)
      return (
        `  ${found.subject.label.padEnd(20)} ${String(found.saturated.units).padStart(5)} units` +
        `   main thread saturated (${share}% scheduling) — audio thread was never the limit`
      )
    }
    if (!clean || !units) return `  ${found.subject.label.padEnd(20)} never broke, or broke at once`
    const out = factor(found, referencePoints)
    return (
      `  ${found.subject.label.padEnd(20)} ${String(units).padStart(5)} units` +
      `   ${clean.toFixed(0).padStart(6)} points` +
      `   model out by ${out ? out.toFixed(2) : '?'}x`
    )
  }

  return [
    `MAX_LOAD is ${MAX_LOAD}. Every factor below is measured against voices, which is the unit.`,
    '',
    'Reference:',
    row(
      result.reference ??
        ({ subject: { label: 'voices' }, clean: null, broke: null, saturated: null } as Found),
    ),
    '',
    'Effects — one per unit, each fed by its own voice:',
    ...result.effects.map(row),
    '',
    'Sweeping a parameter — the same effect with and without a modulator on one target:',
    ...result.surcharges.map(row),
    '',
    'A factor near 1 means that kind of work is priced right. Above 1 means the model is light: it costs',
    'more than the app believes. The control in the last group is `level`, a gain, which should come out',
    'the same as unswept — if it does not, the method is measuring something else.',
  ].join('\n')
}
