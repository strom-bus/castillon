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
/** Underruns must hold still this long before a trial counts as having a clean baseline. */
const QUIET = 0.6
/** And this is as long as it will wait for that. Past here the context is spoiled, not settling. */
const PATIENCE = 4
/** Trials a context runs before it is retired, whether or not it looks well. */
const PER_CONTEXT = 12

/**
 * Loads run and thrown away before anything is believed, so the first real trial is not the cold one.
 *
 * A sweep read its reference at 2415 points, measured fifteen other things, and read the same reference
 * again at 3171 — thirty-one per cent higher. Damage accumulating would have pushed the second reading
 * *down*; up means the machine got faster as it went. The reference runs first, on the coldest code in
 * the whole run, and by the end `playNote` has been called hundreds of thousands of times and optimised.
 * Cheaper scheduling leaves more processor for the audio thread, so the ceiling appears to rise.
 */
export const WARM_UP: Array<[Subject, number]> = [
  [{ label: 'voices', filtered: true }, 128],
  [{ label: 'voices', filtered: true }, 256],
  [{ label: 'reverb', effect: 'reverb' }, 32],
  [{ label: 'bitcrusher', effect: 'crush' }, 96],
]
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
  /**
   * Whether the audio thread ever went quiet before the reading was taken.
   *
   * An unsettled trial is not a soft result, it is no result. Tearing down a few hundred effects glitches
   * for longer than a fixed pause allows for, and those glitches land in whatever is measured next — which
   * is how seven phasers came to look like the limit of a thread that had just carried four hundred voices.
   */
  settled: boolean
}

/**
 * Beyond this share of the main thread spent scheduling, the trial is not measuring the audio thread.
 *
 * A third, not a half. Half was chosen as an obvious ceiling and it was too lax: a sweep drifted 31 per
 * cent upwards over its own length without a single trial tripping it, which only makes sense if the main
 * thread was competing hard enough to move the answer long before it dominated.
 */
const SATURATED_AT = 0.34

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
    // Flat, deliberately: changing the subject would invalidate every figure the sweep produced.
    decay: 0,
    release: 400,
    filterType: filtered ? 'lowpass' : 'off',
    cutoff: 700 + (slot % 40) * 80,
    resonance: 5,
  }
}

/**
 * Contexts, handed out a few trials at a time.
 *
 * Neither extreme works. One per trial wants over a hundred in a sweep, and a browser caps how many a page
 * may hold at once — past the cap `new AudioContext()` yields something that never reaches `running`, so
 * `resume()` stays pending with no event to say why, and the sweep dies where it stands. One for the whole
 * sweep instead lets damage pile up: the same filter subject read 1650 points early on and 907 at the end,
 * a factor of 1.8 on something identical.
 *
 * So a dozen trials each, which is eight or nine contexts for a sweep — far under any cap, and short enough
 * that nothing accumulates far. A trial that finds its context spoiled can also retire it early.
 */
export interface Pool {
  get(): Promise<AudioContext>
  /** Throw this context away: something it did cannot be trusted. */
  retire(): void
  close(): Promise<void>
}

export async function openPool(): Promise<{ pool: Pool; supported: boolean }> {
  let ctx: AudioContext | null = null
  let left = 0

  const fresh = async () => {
    if (ctx) await guard(ctx.close(), 5, 'closing the audio context').catch(() => {})
    ctx = new AudioContext()
    await guard(ctx.resume(), 5, 'opening the audio context')
    left = PER_CONTEXT
    return ctx
  }

  const first = await fresh()
  return {
    supported: playbackStatsAvailable(first),
    pool: {
      async get() {
        if (!ctx || left <= 0) return await fresh()
        left--
        return ctx
      },
      retire() {
        left = 0
      },
      async close() {
        if (ctx) await guard(ctx.close(), 5, 'closing the audio context').catch(() => {})
        ctx = null
      },
    },
  }
}

/**
 * Waits for the audio thread to stop dropping things, so a reading starts from silence.
 *
 * A fixed pause cannot do this job. How long a context needs depends on what was torn down before it, and
 * the honest signal is the counter itself holding still — not a duration somebody picked.
 */
async function quiet(ctx: AudioContext): Promise<boolean> {
  const started = performance.now()
  let last = readPlayback(ctx)?.events ?? 0
  let since = 0

  while ((performance.now() - started) / 1000 < PATIENCE) {
    await wait(0.1)
    const now = readPlayback(ctx)?.events ?? 0
    since = now === last ? since + 0.1 : 0
    last = now
    if (since >= QUIET) return true
  }
  return false
}

/**
 * Runs one trial and tears everything down.
 *
 * The engine's own ceiling is lifted: it steals a voice whenever the next would cross `MAX_LOAD`, so a
 * trial bounded by the number under test could never exceed it — which is how one earlier measurement
 * silently capped itself at the answer it was looking for.
 */
export async function probe(subject: Subject, units: number, pool: Pool): Promise<Trial> {
  // Two attempts. A context that will not go quiet is retired and the same load tried once on a fresh one,
  // because the usual cause is the previous trial's teardown rather than anything about this load.
  const first = await attempt(subject, units, await pool.get())
  if (first.settled) return first
  pool.retire()
  return await attempt(subject, units, await pool.get())
}

async function attempt(subject: Subject, units: number, ctx: AudioContext): Promise<Trial> {
  /*
   * Silence is demanded before the load exists, which is the only moment the answer means one thing.
   *
   * Asked afterwards it cannot tell two opposite situations apart. A context still glitching from the last
   * trial's teardown never goes quiet — and neither does a load that is genuinely failing, which is the
   * very result being looked for. Pan came back as "no reading" twice for exactly that: it follows the
   * heaviest subject in the run, and both its attempts were overloaded loads being read as spoiled
   * contexts. On an empty context there is nothing to glitch, so whatever glitches after this point
   * belongs to the load.
   */
  if (!(await quiet(ctx))) {
    return { units, points: 0, underruns: 0, saturated: false, schedulerShare: 0, settled: false }
  }

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
    // Long enough for the graph just built to stop settling; what it drops after this counts.
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
      settled: true,
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
