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
  openPool,
  probe,
  projectedPoints,
  type Pool,
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
 * Twice the ceiling. Half again was too tight: it stopped eight of sixteen subjects before they failed at
 * all, and a subject that never fails yields only a one-sided bound. Twice is as far as this can reach
 * before the note scheduler itself becomes the limit, which is what the saturation check is there to catch.
 * Four times, the first attempt, reached loads this machine cannot even schedule, let alone render.
 */
const POINT_CAP = Math.round(MAX_LOAD * 2)
/** How tight the bisection gets, as a share of the bracket. Four per cent is well inside the noise. */
const PRECISION = 0.04

export interface Found {
  subject: Subject
  /** The largest load that held, and the smallest that broke. */
  clean: Trial | null
  broke: Trial | null
  /** The trial where the main thread, not the audio thread, ran out — which invalidates the search. */
  saturated: Trial | null
  /** Whether the search was abandoned because no trial could be trusted. A result, not a number. */
  unsettled: boolean
}

export interface Sweep {
  supported: boolean
  reference: Found | null
  effects: Found[]
  surcharges: Found[]
  /**
   * The reference measured again at the end, which is what says whether any of the rest means anything.
   *
   * The same subject twice, first and last, with the whole sweep in between. If the two agree, nothing
   * drifted and every figure here stands. If they do not, the sweep damaged itself as it went and the
   * numbers are an artefact of their position in the running order — which is exactly what happened
   * before this existed, discovered only because one subject happened to be measured twice by accident.
   */
  again: Found | null
}

/**
 * Doubles until something breaks, then bisects the bracket.
 *
 * A trial that breaks is trusted immediately rather than repeated. That errs towards a *lower* break point,
 * which is the safe direction for a budget — and repeating every trial would triple a sweep that already
 * takes minutes.
 */
async function findBreak(
  subject: Subject,
  pool: Pool,
  onStep: (label: string) => void,
): Promise<Found> {
  let clean: Trial | null = null
  let broke: Trial | null = null

  const perUnit = projectedPoints(subject, 1)
  /** The largest load the cost cap allows, which the doubling on its own would sail past and abandon. */
  const most = Math.min(CEILING_UNITS, Math.floor(POINT_CAP / perUnit))

  let units = FIRST
  while (units <= CEILING_UNITS) {
    /*
     * One last rung at the cap itself, rather than stopping at the last power of two beneath it.
     *
     * Doubling is coarse, and the cap falls where it falls: a run of this stopped eleven subjects out of
     * twelve with between a half and a whole doubling of allowed headroom still unexplored, reverb at 64
     * units when 121 were affordable. Half the table came back as one-sided bounds for want of one more
     * trial each.
     */
    if (units > most) {
      if (!clean || most <= clean.units) break
      units = most
    }
    onStep(
      `${subject.label} · ${units} units · ~${projectedPoints(subject, units).toFixed(0)} points`,
    )
    const trial = await probe(subject, units, pool)
    report(subject, trial)
    // A saturated main thread is not a reading. Stop rather than double into a tab that stops answering.
    if (trial.saturated) return { subject, clean, broke: null, saturated: trial, unsettled: false }
    if (!trial.settled) return { subject, clean, broke: null, saturated: null, unsettled: true }
    if (trial.underruns > 0) {
      /*
       * A break on the very first rung is not a break.
       *
       * Nothing was ever held cleanly, so there is no bracket to bisect and nothing to compare — and the
       * number it would print is the starting rung, which says more about where the search begins than
       * about the subject. Seven phasers were reported as the limit of a thread that had just carried four
       * hundred and forty-eight voices.
       */
      if (!clean) return { subject, clean: null, broke: trial, saturated: null, unsettled: true }
      broke = trial
      break
    }
    clean = trial
    // Already at the cap: doubling from here only overshoots, and the guard above would send it back.
    if (units >= most) break
    units *= 2
  }

  if (!broke) return { subject, clean, broke: null, saturated: null, unsettled: false }

  // Bisect between the last load that held and the first that did not.
  let low = clean?.units ?? 0
  let high = broke.units
  while (high - low > Math.max(1, Math.round(high * PRECISION))) {
    const middle = Math.round((low + high) / 2)
    onStep(`${subject.label} · ${middle} units · narrowing`)
    const trial = await probe(subject, middle, pool)
    report(subject, trial)
    if (trial.saturated) return { subject, clean, broke, saturated: trial, unsettled: false }
    if (!trial.settled) return { subject, clean, broke, saturated: null, unsettled: true }
    if (trial.underruns > 0) {
      broke = trial
      high = middle
    } else {
      clean = trial
      low = middle
    }
  }

  return { subject, clean, broke, saturated: null, unsettled: false }
}

/**
 * Everything worth measuring, in the order the results depend on each other.
 *
 * The reference first, because every other figure is read against it. Then each effect. Then the surcharges,
 * which are pairs: the same effect with and without a modulator on one target, since a surcharge of two
 * points is 0.06 % of the ceiling and invisible on its own — ramped across hundreds of units it is not.
 */
export async function sweep(onStep: (label: string) => void): Promise<Sweep> {
  const { pool, supported } = await openPool()
  if (!supported) {
    await pool.close()
    return { supported: false, reference: null, effects: [], surcharges: [], again: null }
  }

  try {
    /*
     * Announced before it runs, not only after it finishes.
     *
     * The two together are what localise a stall. A line saying a trial started, with no line saying how
     * it went, means it died building that load — which is a different fault from one that reports a
     * reading and then never begins the next. Twice now a diagnosis has cost a rerun for want of that
     * distinction.
     */
    return await run(pool, (label) => {
      console.info(`[sweep] → ${label}`)
      onStep(label)
    })
  } finally {
    await pool.close()
  }
}

/**
 * Every trial, echoed to the console as well as to the page.
 *
 * The page is the wrong place to watch a sweep from: building a few hundred nodes starves repainting, so
 * a label that has not changed means nothing in particular. The console keeps its line whatever the
 * renderer is doing, which makes the last one printed the answer to where it stopped.
 */
function report(subject: Subject, trial: Trial): void {
  const state = !trial.settled
    ? 'UNSETTLED — the context never went quiet'
    : trial.saturated
      ? `SATURATED (${(trial.schedulerShare * 100).toFixed(0)}% scheduling)`
      : trial.underruns > 0
        ? `DROPPED ${trial.underruns}`
        : 'clean'
  console.info(
    `[sweep] ${subject.label} · ${trial.units} units · ${trial.points.toFixed(0)} points · ${state}`,
  )
}

async function run(pool: Pool, onStep: (label: string) => void): Promise<Sweep> {
  const reference = await findBreak({ label: 'voices', filtered: true }, pool, onStep)

  const effects: Found[] = []
  for (const descriptor of EFFECTS) {
    effects.push(
      await findBreak({ label: descriptor.label, effect: descriptor.kind }, pool, onStep),
    )
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

  surcharges.push(await findBreak({ label: 'filter · unswept', effect: subject }, pool, onStep))
  for (const target of wanted) {
    surcharges.push(
      await findBreak(
        { label: `filter · ${target}`, effect: subject, modulate: target },
        pool,
        onStep,
      ),
    )
  }

  const again = await findBreak({ label: 'voices again', filtered: true }, pool, onStep)
  return { supported: true, reference, effects, surcharges, again }
}

/** How far the two reference readings may differ before the sweep is calling itself untrustworthy. */
const DRIFT_LIMIT = 0.15

/** The two reference readings, and what their disagreement costs the rest. */
function drift(result: Sweep): { share: number; trustworthy: boolean } | null {
  const first = result.reference?.clean?.points
  const last = result.again?.clean?.points
  if (!first || !last) return null
  const share = Math.abs(last - first) / first
  return { share, trustworthy: share <= DRIFT_LIMIT }
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
    if (found.unsettled) {
      return (
        `  ${found.subject.label.padEnd(20)} no reading — the audio thread never went quiet, so ` +
        `nothing here could be trusted`
      )
    }
    if (found.saturated) {
      const share = (found.saturated.schedulerShare * 100).toFixed(0)
      return (
        `  ${found.subject.label.padEnd(20)} ${String(found.saturated.units).padStart(5)} units` +
        `   main thread saturated (${share}% scheduling) — audio thread was never the limit`
      )
    }
    if (!clean || !units) return `  ${found.subject.label.padEnd(20)} never broke, or broke at once`

    /*
     * A subject that never broke is not a measurement, and must not be printed as one.
     *
     * The cost cap stops the doubling before some subjects fail at all, and a run of these read exactly
     * like real breaks — eight of sixteen rows, including a reverb figure that a whole conclusion was
     * nearly drawn from. What such a row does prove is one-sided: the load held, so the model is not
     * *under*-pricing it. Only a reading above the ceiling proves anything at all, and what it proves is
     * a lower bound on how much the model is over by.
     */
    if (!found.broke) {
      const over = referencePoints > 0 ? clean / referencePoints : 0
      const says =
        over > 1
          ? `over-priced by at least ${over.toFixed(2)}x`
          : 'nothing — it never reached the ceiling'
      return (
        `  ${found.subject.label.padEnd(20)} ${String(units).padStart(5)} units` +
        `   ${clean.toFixed(0).padStart(6)} points` +
        `   HELD, capped — proves ${says}`
      )
    }
    const out = factor(found, referencePoints)
    return (
      `  ${found.subject.label.padEnd(20)} ${String(units).padStart(5)} units` +
      `   ${clean.toFixed(0).padStart(6)} points` +
      `   model out by ${out ? out.toFixed(2) : '?'}x`
    )
  }

  const moved = drift(result)
  const verdict = !moved
    ? ['Only one reference reading, so there is no check on drift and nothing here is confirmed.']
    : moved.trustworthy
      ? [
          `Voices read ${result.reference?.clean?.points?.toFixed(0)} points at the start and ` +
            `${result.again?.clean?.points?.toFixed(0)} at the end, ` +
            `${(moved.share * 100).toFixed(1)}% apart. Nothing drifted; the figures below stand.`,
        ]
      : [
          `TRUST NOTHING BELOW. Voices read ${result.reference?.clean?.points?.toFixed(0)} points at the ` +
            `start and ${result.again?.clean?.points?.toFixed(0)} at the end, ` +
            `${(moved.share * 100).toFixed(1)}% apart on identical work.`,
          'The sweep damaged itself as it ran, so each figure reflects where it came in the order as much',
          'as what it measured. Shorten the run or give each subject its own context.',
        ]

  return [
    `MAX_LOAD is ${MAX_LOAD}. Every factor below is measured against voices, which is the unit.`,
    '',
    ...verdict,
    '',
    'Reference:',
    row(
      result.reference ??
        ({
          subject: { label: 'voices' },
          clean: null,
          broke: null,
          saturated: null,
          unsettled: false,
        } as Found),
    ),
    '',
    'Effects — one per unit, each fed by its own voice:',
    ...result.effects.map(row),
    '',
    'Sweeping a parameter — the same effect with and without a modulator on one target:',
    ...result.surcharges.map(row),
    '',
    'Reference again, for the drift check at the top:',
    row(result.again ?? ({ subject: { label: 'voices again' } } as Found)),
    '',
    'A factor near 1 means that kind of work is priced right. Above 1 means the model is light: it costs',
    'more than the app believes. The control in the last group is `level`, a gain, which should come out',
    'the same as unswept — if it does not, the method is measuring something else.',
  ].join('\n')
}
