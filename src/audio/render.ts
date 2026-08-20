/**
 * Offline rendering: a patch to an audio buffer, faster than real time.
 *
 * `OfflineAudioContext` speaks the same API the engine already does, so the export reuses the
 * engine, the router and the scheduler rather than a second implementation of any of them. Recording
 * the live output through a `MediaRecorder` was the alternative and is worse on every axis: it takes
 * as long as the piece, it captures whatever glitch happened on the way, and it produces webm rather
 * than something a DAW opens.
 *
 * Two decisions taken earlier for other reasons are what make this cheap. `drain(horizon)` holds no
 * reference to a clock, so a whole piece can be scheduled in one call — an offline context grants no
 * permission as it goes, so that is a requirement rather than a convenience. And `Engine` is an
 * interface with six methods, which is how the length can be measured without making a sound.
 */
import type { FxParams, NodeId, Patch } from '../types/patch'
import { ActivityBus, type ActivityEvent } from '../viz/activity'
import { effectOr } from './effects'
import { applyOps, AudioEngine, type Engine, type NoteRequest } from './engine'
import { diff, EMPTY_GRAPH, graphOf } from './router'
import { CascadeScheduler } from './scheduler'

/** CD-adjacent and what every browser resamples cleanly from. */
export const RENDER_SAMPLE_RATE = 48000
/** Stereo, because `pan` exists and a mono render would throw half of it away. */
const RENDER_CHANNELS = 2
/** A whole piece is scheduled in one call, so the per-tick firebreak has to be lifted. */
const OFFLINE_EVENT_BUDGET = 500_000
/** How far the measuring pass looks before giving up on finding a second lap. */
const MEASURE_HORIZON = 120
/**
 * Ceiling on a render, in seconds. A buffer is held in memory whole — two minutes of 48 kHz stereo
 * float is already about 46 MB — and a patch of sixty oscillators looping slowly could otherwise ask
 * for a great deal more.
 */
export const MAX_RENDER_SECONDS = 120
/** Silence at the very end, so a file never stops exactly on a decaying tail. */
const TAIL_PAD = 0.15

export const MIN_PASSES = 1
export const MAX_PASSES = 32

/**
 * Counts what a render would come to without producing any of it.
 *
 * `voiceLoadAt` reports nothing, which keeps the scheduler from degrading to restarts during the
 * measurement. Measuring an undegraded cascade errs long, and a fraction of a second of extra
 * silence at the end is the harmless direction to be wrong in.
 */
class Measurer implements Engine {
  /** When the last sound would stop, release included. */
  end = 0
  private busy = new Map<NodeId, number>()

  now(): number {
    return 0
  }

  playNote(req: NoteRequest): void {
    const stops = req.time + req.duration + req.release / 1000
    if (stops > this.end) this.end = stops
    const known = this.busy.get(req.nodeId) ?? 0
    if (stops > known) this.busy.set(req.nodeId, stops)
  }

  voiceLoadAt(): number {
    return 0
  }

  effectLoad(): number {
    return 0
  }

  nodeBusyUntil(nodeId: NodeId): number {
    return this.busy.get(nodeId) ?? 0
  }

  releaseNodeVoices(): void {
    // Nothing is sounding, so nothing needs cutting.
  }
}

/** A bus that keeps what it is told instead of drawing it. */
function collectingBus(into: ActivityEvent[]): ActivityBus {
  const bus = new ActivityBus(() => 0)
  bus.push = (event: ActivityEvent) => {
    into.push(event)
  }
  return bus
}

/** Always looping: "how many times round" is the question the export asks. */
function looping(patch: Patch): Patch {
  return { ...patch, loop: true }
}

export interface RenderPlan {
  /** How long one lap of the longest cascade takes. */
  passSeconds: number
  /** Where the scheduler should stop being asked for events. */
  until: number
  /** Total length of the file, tails included. */
  seconds: number
  /** Passes actually rendered, which the ceiling may have reduced. */
  passes: number
}

/**
 * Works out how long the file has to be, which an offline context needs up front.
 *
 * A lap is measured rather than assumed: every Ignite is triggered once when the cascade starts and
 * again when it has drained, so the gap between one Ignite's first two triggers *is* its period. The
 * longest of those governs, so shorter cascades simply come round more often — which is the same
 * thing that happens on playback, and the reason a patch of several cascades drifts into polyrhythm.
 */
export function planRender(patch: Patch, passes: number): RenderPlan {
  const events: ActivityEvent[] = []
  const measurer = new Measurer()
  const scheduler = new CascadeScheduler({
    engine: measurer,
    activity: collectingBus(events),
    getPatch: () => looping(patch),
    maxEventsPerDrain: OFFLINE_EVENT_BUDGET,
  })
  scheduler.start()
  scheduler.drain(MEASURE_HORIZON)
  scheduler.stop()

  const starts = new Set(patch.nodes.filter((node) => node.type === 'start').map((node) => node.id))
  let first = Infinity
  let period = 0
  for (const id of starts) {
    const times = events
      .filter((event) => event.kind === 'node' && event.id === id)
      .map((event) => event.time)
      .sort((a, b) => a - b)
    if (times.length === 0) continue
    if (times[0] < first) first = times[0]
    // Two triggers are one lap apart. With only one, this cascade is longer than the horizon and
    // the note ends have to stand in for it.
    const lap = times.length > 1 ? times[1] - times[0] : measurer.end - times[0]
    if (lap > period) period = lap
  }

  // An Ignite with nothing under it does have a lap — it completes instantly and restarts — but it
  // makes no sound, and a file of silence is not an export. No notes measured, nothing to render.
  if (period <= 0 || measurer.end <= 0) {
    return { passSeconds: 0, until: 0, seconds: 0, passes: 0 }
  }

  const offset = first === Infinity ? 0 : first
  const tail =
    Math.max(
      0,
      ...patch.nodes
        .filter((n) => n.type === 'fx')
        .map((n) => effectOr((n.params as FxParams).effect).releaseTime),
    ) + TAIL_PAD

  const wanted = Math.max(MIN_PASSES, Math.min(MAX_PASSES, Math.floor(passes)))
  // Trim rather than refuse: asking for thirty-two laps of a slow patch should give as many as fit.
  const room = Math.max(1, Math.floor((MAX_RENDER_SECONDS - offset - tail) / period))
  const actual = Math.min(wanted, room)

  const until = offset + actual * period
  return {
    passSeconds: period,
    // A shade short of the boundary, so the trigger that would open one more lap is never processed.
    until: until - 1e-4,
    seconds: Math.min(MAX_RENDER_SECONDS, until + tail),
    passes: actual,
  }
}

/**
 * Renders the patch to a buffer.
 *
 * The engine is a second instance over the offline context, not the live one, so a render neither
 * disturbs what is playing nor has to wait for it to stop.
 */
export async function renderPatch(
  patch: Patch,
  passes: number,
  masterGain: number,
): Promise<{ buffer: AudioBuffer; plan: RenderPlan }> {
  const plan = planRender(patch, passes)
  if (plan.passes === 0) throw new Error('Nothing to render: wire an oscillator under an Ignite.')

  const ctx = new OfflineAudioContext(
    RENDER_CHANNELS,
    Math.ceil(plan.seconds * RENDER_SAMPLE_RATE),
    RENDER_SAMPLE_RATE,
  )

  const engine = new AudioEngine()
  // Before `adopt`, so the master gain is built with the right value rather than ramped to it.
  engine.setMasterGain(masterGain)
  engine.adopt(ctx)
  applyOps(engine, diff(EMPTY_GRAPH, graphOf(patch)), patch.bpm)

  const scheduler = new CascadeScheduler({
    engine,
    activity: collectingBus([]),
    getPatch: () => looping(patch),
    maxEventsPerDrain: OFFLINE_EVENT_BUDGET,
  })
  scheduler.start()
  scheduler.drain(plan.until)
  scheduler.stop()

  return { buffer: await ctx.startRendering(), plan }
}
