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
  WARM_UP,
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
/** Underruns at or below which a break might be a stray glitch, and so is worth running again. */
const MARGINAL = 4

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
 * A break is confirmed before it is believed, which it used not to be. Trusting one immediately was
 * defended as erring low and therefore safe, and that was wrong twice over: a stray dropout from anywhere
 * on the machine reads as a break, nothing ever revisits it, and the subject keeps that answer for the rest
 * of the run. One sweep put the filter effect at 124 units in the effects group and 294 in the surcharge
 * group — the same subject, from one glitch believed. Only breaks are repeated, so this costs a handful of
 * trials rather than doubling the sweep.
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
    const trial = await confirmed(subject, units, pool, report, onStep)
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
    const trial = await confirmed(subject, middle, pool, report, onStep)
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
 * One reading, with any break checked a second time before it is passed on.
 *
 * A clean trial is taken as it comes: a load that failed to fail is not the reading that goes wrong. A
 * broken one is repeated, and only counts if it breaks again — otherwise the confirming trial is returned
 * instead, which is a clean reading at that load and exactly what the search should have seen.
 */
async function confirmed(
  subject: Subject,
  units: number,
  pool: Pool,
  report: (subject: Subject, trial: Trial) => void,
  onStep: (label: string) => void = () => {},
): Promise<Trial> {
  const building = (built: number, of: number) =>
    onStep(`${subject.label} · ${units} units · building ${built}/${of}`)

  const first = await probe(subject, units, pool, building)
  report(subject, first)
  if (first.underruns === 0 || !first.settled || first.saturated) return first

  /*
   * Only a *marginal* break is worth a second run.
   *
   * The point of confirming is to throw out a break caused by one stray dropout from elsewhere on the
   * machine, and a stray dropout is one or two blocks. A thread that has genuinely run out drops dozens:
   * this rung reported eighty-two, which is not something a second opinion is going to overturn. Repeating
   * it anyway paid for the most expensive load in the sweep twice over to verify the unambiguous, on the
   * one subject where building the load is itself most of the cost.
   */
  if (first.underruns > MARGINAL) return first

  const again = await probe(subject, units, pool, building)
  report(subject, again)
  return again
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
      // Progress within a trial goes to the page and not to the console. It is there so that a slow build
      // can be told from a stuck one, which wants a number that moves in front of somebody — a thousand
      // extra lines in the console would bury the trail that localises a stall, and slow the console down
      // while doing it.
      if (!label.includes('building')) console.info(`[sweep] → ${label}`)
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
    `[sweep] ${subject.label} · ${trial.units} units · ${trial.points.toFixed(0)} points · ` +
      `built in ${trial.buildSeconds.toFixed(1)}s · ${state}`,
  )
}

async function run(pool: Pool, onStep: (label: string) => void): Promise<Sweep> {
  // Discarded on purpose: the point is to have run this code, not to know what it said.
  for (const [subject, units] of WARM_UP) {
    onStep(`warming up · ${subject.label} · ${units} units`)
    await probe(subject, units, pool)
  }

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
/**
 * And how far the two readings of the filter effect may.
 *
 * A wider allowance than the drift check because these two sit far apart in the running order and carry
 * whatever the reference drift does as well. It is the check that has caught two bad runs, both times by
 * eye — the numbers were printed and nothing compared them, so a table whose duplicate readings were 2.3
 * times apart still announced that its figures stood.
 */
const AGREEMENT_LIMIT = 0.25

/** The two reference readings, and what their disagreement costs the rest. */
function drift(result: Sweep): { share: number; trustworthy: boolean } | null {
  const first = result.reference?.clean?.points
  const last = result.again?.clean?.points
  if (!first || !last) return null
  const share = Math.abs(last - first) / first
  return { share, trustworthy: share <= DRIFT_LIMIT }
}

/**
 * The same subject measured twice, once in each group, and whether the two agree.
 *
 * Independent of drift and catches what drift cannot: a spurious break leaves the reference untouched and
 * shows up only as one subject disagreeing with itself.
 */
function agreement(result: Sweep): { share: number; trustworthy: boolean } | null {
  const inEffects = result.effects.find((found) => found.subject.effect === 'filter')?.clean?.points
  const inSurcharges = result.surcharges.find((found) => !found.subject.modulate)?.clean?.points
  if (!inEffects || !inSurcharges) return null
  const share = Math.abs(inSurcharges - inEffects) / Math.min(inEffects, inSurcharges)
  return { share, trustworthy: share <= AGREEMENT_LIMIT }
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
      `   model out by ${out ? out.toFixed(2) : '?'}x` +
      // Printed on every row, not only when it trips the limit. Whether this column falls across a run is
      // the difference between a machine that warmed up and one that wore out, and a whole sweep was
      // thrown away for want of being able to tell which.
      `   ${((found.clean?.schedulerShare ?? 0) * 100).toFixed(0).padStart(3)}% sched`
    )
  }

  /*
   * Two checks, and a table is only worth reading if both pass.
   *
   * They fail for different reasons, which is why one cannot stand in for the other. Drift is the machine
   * changing under the measurement, and shows in the reference. Agreement is one subject disagreeing with
   * itself, which a spurious break causes and which leaves the reference untouched — a run whose duplicate
   * readings were 2.3 times apart passed the drift check at 13 per cent and announced that its figures
   * stood.
   */
  const moved = drift(result)
  const agreed = agreement(result)
  const first = result.reference?.clean?.points?.toFixed(0)
  const last = result.again?.clean?.points?.toFixed(0)

  const problems: string[] = []
  if (!moved) {
    problems.push('Only one reference reading, so drift is unchecked.')
  } else if (!moved.trustworthy) {
    problems.push(
      `Voices read ${first} points at the start and ${last} at the end, ` +
        `${(moved.share * 100).toFixed(1)}% apart on identical work — the machine changed as it ran, so ` +
        'each figure reflects where it came in the order as much as what it measured.',
    )
  }
  if (!agreed) {
    problems.push(
      'The filter effect was not measured twice, so nothing checks a subject against itself.',
    )
  } else if (!agreed.trustworthy) {
    problems.push(
      `The filter effect reads ${(agreed.share * 100).toFixed(0)}% apart between its two measurements, ` +
        'which is one subject disagreeing with itself rather than anything drifting. A break believed on ' +
        'one stray dropout does this, and it lands on whichever subject was unlucky.',
    )
  }

  const verdict =
    problems.length > 0
      ? ['TRUST NOTHING BELOW.', ...problems]
      : [
          `Voices read ${first} points at the start and ${last} at the end, ` +
            `${((moved?.share ?? 0) * 100).toFixed(1)}% apart, and the filter effect agrees with itself ` +
            `to ${((agreed?.share ?? 0) * 100).toFixed(0)}%. The figures below stand.`,
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
