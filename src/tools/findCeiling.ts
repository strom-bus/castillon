/**
 * Finding the ceiling without a person watching a panel.
 *
 * Every previous attempt asked somebody to read a number that never sits still and say when it reached a
 * hundred. `playbackStats` replaces that with a counter: an underrun either happened or it did not, and
 * a count going up is not something anybody has to interpret.
 *
 * What comes back is the reading **in the app's own units** — whatever the meter said at the moment the
 * audio thread first dropped a sample. That is the ceiling with no model in between, which is exactly
 * what the last two attempts could not produce.
 */

import { MAX_LOAD } from '../audio/load'
import { startEngineRamp, type EngineRampOptions } from './engineRamp'
import { playbackStatsAvailable, type Playback } from './playbackStats'

/** Voice slots added per rung. Small, so the ceiling is not overshot by a wide margin. */
const RUNG = 4
/** Seconds to hold each rung. Long enough for a rung to actually be tested, short enough to finish. */
const HOLD = 1.2
/** A hard stop, in case a machine simply never struggles. */
const MAX_SLOTS = 600
/** Rungs allowed to pass unbroken before the whole thing is believed to be idle-safe. */
const SETTLE_RUNGS = 2

export interface Rung {
  slots: number
  points: number
  /** Underruns that happened during *this* rung, not since the start. */
  underruns: number
}

export interface CeilingResult {
  supported: boolean
  rungs: Rung[]
  /** Points the meter showed on the last rung that dropped nothing. */
  safe: number | null
  /** Points the meter showed on the first rung that dropped something. */
  broke: number | null
  /** What the app currently believes the ceiling is. */
  current: number
}

const wait = (seconds: number) => new Promise((done) => setTimeout(done, seconds * 1000))

/**
 * Ramps until the audio thread drops a sample, then stops.
 *
 * Underruns are counted **per rung** rather than cumulatively. The first seconds of any context tend to
 * drop something while the graph is being set up, and a cumulative count would blame that on whatever
 * rung happened to be running.
 */
export async function findCeiling(
  onStep: (label: string) => void,
  options: EngineRampOptions = {},
): Promise<CeilingResult> {
  const { ramp, ctx } = startEngineRamp(options)
  await ctx.resume()

  if (!playbackStatsAvailable(ctx)) {
    ramp.stop()
    return { supported: false, rungs: [], safe: null, broke: null, current: MAX_LOAD }
  }

  const rungs: Rung[] = []
  let safe: number | null = null
  let broke: number | null = null

  try {
    // Warmed up before anything is believed: a context that has just been built is still settling.
    ramp.add(RUNG)
    await wait(HOLD * SETTLE_RUNGS)

    let previous = ramp.playback() as Playback

    while (ramp.slots() < MAX_SLOTS) {
      onStep(`${ramp.slots()} slots · ${ramp.points().toFixed(0)} points`)
      await wait(HOLD)

      const now = ramp.playback() as Playback
      const underruns = now.events - previous.events
      previous = now

      const rung: Rung = { slots: ramp.slots(), points: ramp.points(), underruns }
      rungs.push(rung)

      if (underruns > 0) {
        broke = rung.points
        break
      }
      safe = rung.points
      ramp.add(RUNG)
    }
  } finally {
    ramp.stop()
  }

  return { supported: true, rungs, safe, broke, current: MAX_LOAD }
}

/** The result as text, and what it says `MAX_LOAD` should be. */
export function formatCeiling(result: CeilingResult): string {
  if (!result.supported) {
    return [
      'This Chrome has no playbackStats, so underruns cannot be counted from the page.',
      '',
      'It ships in Chrome 146 (as `playbackStats`, previously `playoutStats`). Until then the only',
      'route is the DevTools WebAudio panel, read by eye — which is what the ramp below is for.',
    ].join('\n')
  }

  const rows = result.rungs.map(
    (rung) =>
      `  ${String(rung.slots).padStart(4)} slots   ${rung.points.toFixed(0).padStart(6)} points` +
      `   ${rung.underruns > 0 ? `DROPPED ${rung.underruns}` : 'clean'}`,
  )

  const lines = [
    `MAX_LOAD is ${result.current} today. The meter reads points as a share of it.`,
    '',
    ...rows,
    '',
  ]

  if (result.broke === null) {
    lines.push(
      `Nothing dropped up to ${result.safe?.toFixed(0)} points, which is as far as this goes.`,
      'The ceiling is higher than that, or something else is the limit.',
    )
    return lines.join('\n')
  }

  lines.push(
    `Clean to ${result.safe?.toFixed(0) ?? '0'} points; first dropout at ${result.broke.toFixed(0)}.`,
    '',
    // The safe rung rather than the broken one: a ceiling somebody can reach without glitching is the
    // useful number, and the difference between two rungs is the resolution of the measurement.
    `So MAX_LOAD wants to be about ${Math.round((result.safe ?? result.broke) / 25) * 25}, not ${result.current}.`,
    '',
    'That is this machine at its limit, with nothing else running. The margin for a slower one is',
    'LAYER_THRESHOLD, which backs off at three quarters of whatever this is set to.',
  )

  return lines.join('\n')
}
