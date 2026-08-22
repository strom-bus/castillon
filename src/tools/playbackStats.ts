/**
 * Reading whether the audio thread has actually dropped anything.
 *
 * `AudioContext.playbackStats` reports **the failure itself** rather than a proxy for it: how many
 * underruns there have been and how much audio was lost to them. That is a better instrument than any
 * load percentage for one reason — a load figure has to be interpreted, and "you have lost audio three
 * times" does not.
 *
 * Chrome 146, per the Intent to Ship, enabled for everybody. It shipped as `playoutStats` first and the
 * old name survives as a deprecated alias, so both are looked for. Chromium-only for the foreseeable
 * future.
 *
 * This is what `renderCapacity` should have been for us and was not: that one is in the Web Audio 1.1
 * spec but Chrome exposes it only over the DevTools protocol, which a page cannot speak.
 */

/** The fields worth having, under whichever name this browser knows them by. */
export interface Playback {
  /** Underruns since the context was built. Each one is audible. */
  events: number
  /** Seconds of audio lost to them. */
  lost: number
  /** Seconds of audio produced, so the two can be a rate rather than a count. */
  total: number
}

interface StatsShape {
  underrunEvents?: number
  underrunDuration?: number
  totalDuration?: number
  // The names the WICG explainer used before the API was renamed.
  fallbackFramesEvents?: number
  fallbackFramesDuration?: number
  totalFramesDuration?: number
}

type WithStats = AudioContext & {
  playbackStats?: StatsShape
  playoutStats?: StatsShape
}

/** Whether this browser can tell us. */
export function playbackStatsAvailable(ctx: AudioContext): boolean {
  const withStats = ctx as WithStats
  return Boolean(withStats.playbackStats ?? withStats.playoutStats)
}

/**
 * The current reading, or null where the browser has no idea.
 *
 * Read fresh each time rather than held: the object is live, and holding a snapshot of it would report
 * whatever it said when it was taken.
 */
export function readPlayback(ctx: AudioContext): Playback | null {
  const withStats = ctx as WithStats
  const stats = withStats.playbackStats ?? withStats.playoutStats
  if (!stats) return null

  return {
    events: stats.underrunEvents ?? stats.fallbackFramesEvents ?? 0,
    // Durations arrive in milliseconds under the older name and in seconds under the newer one; both
    // are only ever compared against each other here, so the unit matters less than the pairing.
    lost: stats.underrunDuration ?? stats.fallbackFramesDuration ?? 0,
    total: stats.totalDuration ?? stats.totalFramesDuration ?? 0,
  }
}

/** What share of the audio produced was lost. Zero is the only good answer. */
export function failureRate(reading: Playback): number {
  return reading.total > 0 ? reading.lost / reading.total : 0
}
