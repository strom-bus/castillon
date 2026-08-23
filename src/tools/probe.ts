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
/**
 * Seconds before a reading is believed, which has to outlast the load arriving as well as the context.
 *
 * Slots stagger their first note across most of a second so they do not all fire on one tick, and a voice
 * lives for its duration plus its release — so the overlap a slot is supposed to carry is not reached for
 * about a second and a half. Reading at seven tenths caught the load on its way up: the same subject
 * measured 7.2 points a slot in one sweep and 4.4 in the next, with more slots in the one that read less.
 *
 * That difference was made by moving the wait for silence to before the build, which was right for its own
 * reasons and took away the extra second the reading had been leaning on without anyone intending it to.
 */
const SETTLE = 1.5
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
/**
 * Milliseconds of building allowed between yields.
 *
 * By time and not by count, which is what it used to be. A count only works if every unit costs the same,
 * and they differ by more than an order of magnitude: assigning a buffer to a convolver makes the browser
 * partition the impulse response there and then, so sixteen reverbs between yields is over a second with
 * the page dead — five times over, indistinguishable from a crash, and long enough that the watchdog meant
 * to notice cannot run either. Sixteen of anything cheaper is imperceptible. Time is the thing that was
 * actually meant.
 */
const SLICE = 25

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
   * Seconds spent building the load, which for one subject is most of what a trial costs.
   *
   * Assigning a buffer to a convolver makes the browser partition the impulse response, and that happens
   * once per convolver whether or not the buffer is shared. Nothing else here has a setup cost worth
   * naming, so without this a slow trial and a stuck one look alike from the outside.
   */
  buildSeconds: number
  /**
   * Whether the audio thread ever went quiet before the reading was taken.
   *
   * An unsettled trial is not a soft result, it is no result. Tearing down a few hundred effects glitches
   * for longer than a fixed pause allows for, and those glitches land in whatever is measured next — which
   * is how seven phasers came to look like the limit of a thread that had just carried four hundred voices.
   */
  settled: boolean
  /** How the wait for silence went, when there was one worth reporting on. */
  settling?: Settling
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
    glide: 0,
    velocity: 1,
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
/**
 * How the wait for silence went, rather than only whether it succeeded.
 *
 * A run reported the filter subject as "no reading — the audio thread never went quiet" and there was
 * nothing else to go on. The obvious cause was already handled: a context that will not settle is retired
 * and the load tried once on a fresh one, so the failure had happened *twice*, the second time on a
 * context with nothing on it. Which rules out the previous trial's teardown as the story and leaves a
 * question this returned no evidence about.
 *
 * So it now says how long it waited and how many underruns kept arriving while it did. Many, on an empty
 * context, means the device is still busy with a context that was closed — they share one audio thread,
 * and `close()` resolving is not the thread going idle. A handful means it was nearly there and PATIENCE
 * is too short. None at all, with `settled` false, would mean the counter is not moving and the check
 * itself is broken. Three different faults that looked identical.
 */
export interface Settling {
  settled: boolean
  /** Seconds spent waiting. */
  waited: number
  /** Underruns that arrived during the wait, on a context carrying nothing. */
  events: number
}

async function quiet(ctx: AudioContext): Promise<Settling> {
  const started = performance.now()
  const first = readPlayback(ctx)?.events ?? 0
  let last = first
  let since = 0

  const seconds = () => (performance.now() - started) / 1000

  while (seconds() < PATIENCE) {
    await wait(0.1)
    const now = readPlayback(ctx)?.events ?? 0
    since = now === last ? since + 0.1 : 0
    last = now
    if (since >= QUIET) return { settled: true, waited: seconds(), events: last - first }
  }
  return { settled: false, waited: seconds(), events: last - first }
}

/**
 * Runs one trial and tears everything down.
 *
 * The engine's own ceiling is lifted: it steals a voice whenever the next would cross `MAX_LOAD`, so a
 * trial bounded by the number under test could never exceed it — which is how one earlier measurement
 * silently capped itself at the answer it was looking for.
 */
/**
 * The longest a single trial may take before it is called stuck.
 *
 * Half a minute, which was a whole one and too long to be of use. A watchdog is only a diagnosis if
 * somebody is still watching when it fires, and nobody stares at a frozen tab for sixty seconds — the
 * report that came back was "stuck", from a run that may simply have been working.
 */
const TRIAL_PATIENCE = 30

export async function probe(
  subject: Subject,
  units: number,
  pool: Pool,
  onProgress: (built: number, of: number) => void = () => {},
): Promise<Trial> {
  /*
   * Watched as a whole, not only at each await inside it.
   *
   * Guarding the individual calls covered the ones known to be able to stall, which is only the ones
   * thought of. A trial that stops between them looks the same from outside and says nothing at all, and a
   * sweep died on the distortion subject with no more to go on than the rung it died at. If the wait
   * expires the trial is reported stuck by name; if instead the page itself has frozen, nothing fires —
   * and that silence is the other half of the diagnosis, since it means a loop and not a pending promise.
   */
  const where = `${subject.label} at ${units} units`

  // Two attempts. A context that will not go quiet is retired and the same load tried once on a fresh one,
  // because the usual cause is the previous trial's teardown rather than anything about this load.
  const first = await guard(
    attempt(subject, units, await pool.get(), onProgress),
    TRIAL_PATIENCE,
    where,
  )
  if (first.settled) return first
  pool.retire()
  return await guard(
    attempt(subject, units, await pool.get(), onProgress),
    TRIAL_PATIENCE,
    `${where}, retried`,
  )
}

async function attempt(
  subject: Subject,
  units: number,
  ctx: AudioContext,
  onProgress: (built: number, of: number) => void,
): Promise<Trial> {
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
  const settling = await quiet(ctx)
  if (!settling.settled) {
    return {
      units,
      points: 0,
      underruns: 0,
      saturated: false,
      schedulerShare: 0,
      settled: false,
      buildSeconds: 0,
      settling,
    }
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
  const buildFrom = performance.now()
  let sliceFrom = buildFrom

  for (let slot = 0; slot < units; slot++) {
    // Staggered, so every voice does not fire on the same tick and produce one huge spike.
    scheduled[slot] = ctx.currentTime + (slot % NOTE_RATE) / NOTE_RATE

    /*
     * Yielded whenever this has been running long enough, and saying how far it has got.
     *
     * A page that has stopped repainting is indistinguishable from one that has crashed, so yielding keeps
     * it alive and the moving number says which of the two it is. Both were already here and both were
     * governed by a unit count, which assumes every unit costs about the same — and a reverb costs more
     * than an order of magnitude more than a gain.
     */
    if (performance.now() - sliceFrom >= SLICE) {
      sliceFrom = performance.now()
      onProgress(slot, units)
      await wait(0)
    }

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

  const buildSeconds = (performance.now() - buildFrom) / 1000

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
    // Long enough for the graph just built to stop settling and the load to arrive; what it drops after
    // this counts.
    await wait(SETTLE)
    const before = readPlayback(ctx)
    schedulerMs = 0
    const watchFrom = performance.now()

    /*
     * Sampled across the hold rather than once at the start of it.
     *
     * One instant is a poor account of a load that is a sum of voices coming and going: the count moves
     * from moment to moment, and a single reading is as likely to catch a trough as the plateau. Averaging
     * over the window the underruns are counted in also makes the two describe the same stretch of time,
     * which they did not before.
     */
    const samples: number[] = []
    for (let taken = 0; taken < HOLD * 10; taken++) {
      await wait(0.1)
      samples.push(engine.voiceLoadAt(engine.now()) + engine.effectLoad())
    }
    const points = samples.reduce((sum, one) => sum + one, 0) / Math.max(1, samples.length)

    const after = readPlayback(ctx)
    const share = schedulerMs / (performance.now() - watchFrom)

    return {
      units,
      points,
      underruns: (after?.events ?? 0) - (before?.events ?? 0),
      saturated: share > SATURATED_AT,
      schedulerShare: share,
      settled: true,
      buildSeconds,
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
