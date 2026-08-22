/**
 * One independent trial: hold a fixed load for a while and see whether the audio thread dropped anything.
 *
 * Independent is the point. A ramp that only grows carries whatever state its earlier rungs left behind —
 * allocations, garbage, a graph that has been rebuilt a hundred times — and it cannot go back down, which
 * rules out bisecting. A fresh context per trial costs a couple of hundred milliseconds and buys a reading
 * that means one thing.
 *
 * What it measures is the same question as always: not how loaded the thread looks, but whether it failed.
 * `playbackStats` counts blocks that were not delivered, and each one is audible.
 */

import { effectOr } from '../audio/effects'
import { AudioEngine, type NoteRequest } from '../audio/engine'
import { effectCost, voiceCost } from '../audio/load'
import { targetsFor } from '../audio/modulation'
import type { EffectKind, FxParams } from '../types/patch'
import { playbackStatsAvailable, readPlayback } from './playbackStats'

/** Notes a second, per voice. */
const NOTE_RATE = 6
/** How far ahead notes are scheduled. */
const HORIZON = 0.25
/** Seconds before a reading is believed: a context that has just been built is still settling. */
const SETTLE = 0.7
/** Seconds the load is held and watched. */
const HOLD = 1.3
/** How often the scheduler wakes. */
const TICK = 0.05

export interface Subject {
  /** What one unit is. */
  label: string
  /**
   * The effect each unit carries, or none for a plain voice.
   *
   * Every effect is fed by its own voice, since an effect with silence at its input is a different
   * measurement — and one a browser is allowed to optimise away.
   */
  effect?: EffectKind
  /** A modulation target to sweep on each unit, for measuring what sweeping one costs. */
  modulate?: string
  /** Whether each voice carries its own filter. */
  filtered?: boolean
}

/** Voices overlapping per slot, at this note rate and release. */
const OVERLAP = (1 / NOTE_RATE + 0.05 + 0.4) / (1 / NOTE_RATE)

/**
 * What the model reckons a load will cost, before any of it is built.
 *
 * Needed as a guard rather than as a measurement. A reverb generates its own impulse response — two
 * channels of up to ten seconds, one random number per sample — so four thousand of them is a billion
 * random numbers and four gigabytes of buffers, built synchronously. That is not a slow trial, it is a
 * hung tab. Projecting the cost first means a subject too cheap to ever be the limit stops doubling
 * instead of trying to.
 */
export function projectedPoints(subject: Subject, units: number): number {
  const voice = voiceCost('sawtooth', subject.filtered ?? true) * OVERLAP
  if (!subject.effect) return units * voice

  const descriptor = effectOr(subject.effect)
  const params = { effect: subject.effect, mix: 0.6, ...descriptor.defaults } as FxParams
  return units * (voice + effectCost(params))
}

export interface Trial {
  units: number
  /** What the meter would show — the engine's own accounting. */
  points: number
  /** Blocks the audio thread failed to deliver while the load was held. */
  underruns: number
  /**
   * Whether the *main* thread was the thing that could not keep up.
   *
   * A trial where scheduling notes eats the main thread is not a reading about the audio thread at all,
   * and it must not be reported as one. Left unsaid, it looks exactly like a very high ceiling — right up
   * until the tab stops answering.
   */
  saturated: boolean
  /** Share of wall time the note scheduler spent running. */
  schedulerShare: number
}

/** Beyond this share of the main thread spent scheduling, the trial is not measuring the audio thread. */
const SATURATED_AT = 0.5

const wait = (seconds: number) => new Promise((done) => setTimeout(done, seconds * 1000))

/**
 * Refuses to wait for ever.
 *
 * Every await in a trial talks to the audio system, and the audio system is entitled to simply never
 * answer — a context that cannot start leaves `resume()` pending indefinitely, and there is no event to
 * say so. Unguarded, that is a frozen tab and no information. Guarded, it is a line saying which call
 * stopped and on which trial, which is the difference between a bug report and a diagnosis.
 */
async function guard<T>(work: Promise<T>, seconds: number, what: string): Promise<T> {
  let bell: ReturnType<typeof setTimeout>
  const alarm = new Promise<never>((_, fail) => {
    bell = setTimeout(
      () => fail(new Error(`${what} did not answer within ${seconds}s`)),
      seconds * 1000,
    )
  })
  try {
    return await Promise.race([work, alarm])
  } finally {
    clearTimeout(bell!)
  }
}

/**
 * When a slot should fire next, given where it got to and what time it is now.
 *
 * The clamp to `now` is the whole point, and it is why this is a function rather than four lines inside
 * the timer. A slot resumed from wherever it left off will, after any tick that ran late, be sitting in
 * the past — and then it owes a note for every beat since. Each of those is a real oscillator, gain,
 * filter and four automation points, so paying the debt makes the next tick later still, which makes the
 * debt larger. It diverges rather than settling: a hundred and seventy-eight notes a tick becomes seven
 * thousand inside a second, and the page never comes back.
 *
 * Skipping the missed notes loses a little construction churn. Replaying them loses the tab.
 */
export function fires(from: number, now: number): { times: number[]; next: number } {
  let at = Math.max(from, now)
  const times: number[] = []
  while (at < now + HORIZON) {
    times.push(at)
    at += 1 / NOTE_RATE
  }
  return { times, next: at }
}

function note(slot: number, at: number, filtered: boolean): NoteRequest {
  return {
    nodeId: `slot${slot}`,
    time: at,
    // Spread across the register, so nothing is measured at one frequency by accident.
    freq: 90 * Math.pow(2, (slot % 30) / 12),
    waveform: 'sawtooth',
    pulseWidth: 0.5,
    duration: 1 / NOTE_RATE + 0.05,
    gain: 0.4,
    // The envelope is what makes a voice's gain a-rate, and a hand-built voice with a constant gain is
    // what mismeasured this by an order of magnitude the first time.
    attack: 6,
    release: 400,
    filterType: filtered ? 'lowpass' : 'off',
    cutoff: 700 + (slot % 40) * 80,
    resonance: 5,
  }
}

/**
 * The one context a whole sweep runs in, started and checked.
 *
 * One, not one per trial. A browser caps how many audio contexts a page may hold at once, and a sweep
 * bisecting sixteen subjects wants well over a hundred — past the cap `new AudioContext()` yields
 * something that never reaches `running`, so `resume()` never settles and the sweep stops dead with no
 * error to show. Nothing needed the fresh context anyway: what a trial must not inherit is the previous
 * graph, and `dispose()` takes that down to the master gain.
 */
export async function openProbeContext(): Promise<{ ctx: AudioContext; supported: boolean }> {
  const ctx = new AudioContext()
  await guard(ctx.resume(), 5, 'opening the audio context')
  return { ctx, supported: playbackStatsAvailable(ctx) }
}

/**
 * Runs one trial and tears everything down.
 *
 * The engine's own ceiling is lifted: it steals a voice whenever the next would cross `MAX_LOAD`, so a
 * trial bounded by the number under test could never exceed it — which is how one earlier measurement
 * silently capped itself at the answer it was looking for.
 */
export async function probe(subject: Subject, units: number, ctx: AudioContext): Promise<Trial> {
  const engine = new AudioEngine()
  engine.ceiling = Number.POSITIVE_INFINITY
  engine.setMasterGain(0.04)
  engine.adopt(ctx)
  // Only where a processor is actually wanted, and only once per context: registering a module is a
  // compile, and eleven effects out of thirteen never touch one.
  if (subject.effect === 'crush' || subject.effect === 'octave') {
    await guard(engine.loadWorklets(), 10, 'registering the worklet modules')
  }

  const filtered = subject.filtered ?? true
  const scheduled: number[] = []

  for (let slot = 0; slot < units; slot++) {
    // Staggered, so every voice does not fire on the same tick and produce one huge spike.
    scheduled[slot] = ctx.currentTime + (slot % NOTE_RATE) / NOTE_RATE

    // Yielded periodically. Building a few hundred convolvers is seconds of synchronous work, and a page
    // that has stopped repainting is indistinguishable from one that has crashed.
    if (slot > 0 && slot % 16 === 0) await wait(0)

    if (subject.effect) {
      const descriptor = effectOr(subject.effect)
      const params = { effect: subject.effect, mix: 0.6, ...descriptor.defaults } as FxParams
      const id = `fx${slot}`
      engine.createEffect(id, params, 120)
      engine.connectSend(`slot${slot}`, id)

      if (subject.modulate) {
        engine.createModulator(`mod${slot}`, { kind: 'lfo', wave: 'sine', rate: 1.5, depth: 0.6 })
        engine.connectMod(`mod${slot}`, id, subject.modulate, 0.6)
      }
    }
  }

  /** Milliseconds spent inside the scheduler, so a saturated main thread can say so. */
  let schedulerMs = 0

  const timer = window.setInterval(() => {
    const entered = performance.now()
    const now = engine.now()
    for (let slot = 0; slot < units; slot++) {
      const due = fires(scheduled[slot] ?? now, now)
      for (const at of due.times) engine.playNote(note(slot, at, filtered))
      scheduled[slot] = due.next
    }
    schedulerMs += performance.now() - entered
  }, TICK * 1000)

  try {
    await wait(SETTLE)
    const before = readPlayback(ctx)
    const points = engine.voiceLoadAt(engine.now()) + engine.effectLoad()
    schedulerMs = 0
    const watchFrom = performance.now()
    await wait(HOLD)
    const after = readPlayback(ctx)
    const share = schedulerMs / (performance.now() - watchFrom)

    return {
      units,
      points,
      underruns: (after?.events ?? 0) - (before?.events ?? 0),
      saturated: share > SATURATED_AT,
      schedulerShare: share,
    }
  } finally {
    window.clearInterval(timer)
    engine.dispose()
    // Yielded once, so the graph this trial built is actually released before the next one is measured.
    await wait(0.05)
  }
}

/** Every audio-rate target an effect offers, for sweeping the surcharge measurements over. */
export function audioTargets(effect: EffectKind): string[] {
  return targetsFor('fx', effect)
    .filter((target) => target.via === 'audio')
    .map((target) => target.key)
}
