/**
 * Finding the real ceiling: how much work this machine's audio thread can do before it drops samples.
 *
 * `MAX_LOAD` is the one constant no offline render can settle, and §11.8 said so and left it. Timing a
 * render measures how fast a machine can produce audio when nothing is waiting for it; a ceiling is
 * about the opposite — whether each block of 128 samples is ready *in time*, every time, while the
 * page is also drawing a canvas and running React.
 *
 * `AudioContext.renderCapacity` is Chrome's own instrument for exactly that. It reports the share of
 * each render quantum used, the worst one in an interval, and the **underrun ratio** — the fraction of
 * quanta that were not ready. Anything above zero there is an audible dropout, which is the definition
 * of the ceiling rather than a proxy for it.
 *
 * **The load is built from raw oscillators rather than through the engine**, and that is not a shortcut.
 * The engine steals a voice whenever the next one would cross `MAX_LOAD`, so it cannot be asked to
 * exceed the very number being measured. And the unit works out: one point *is* one plain oscillator
 * voice, so N oscillators are N points by definition.
 */

/** Where the ramp stops, since a machine that manages two thousand is telling us enough. */
const STEPS = [25, 50, 100, 150, 200, 300, 400, 600, 800, 1200, 1600]

/** Seconds to hold each rung before believing the reading. */
const SETTLE = 1.6

/**
 * How much of a quantum may be used before a rung counts as unsafe.
 *
 * Well below 1, and deliberately: a reading taken here is the audio thread alone, while a real patch
 * is also being drawn, diffed and scheduled. Peak rather than average, because a dropout is a single
 * late block and an average hides it.
 */
const SAFE_PEAK = 0.7

export interface CeilingStep {
  /** Points, where one point is one plain oscillator voice — the same unit `load.ts` counts in. */
  points: number
  average: number
  peak: number
  underruns: number
}

export interface Ceiling {
  supported: boolean
  /** What was actually found, so a missing API can be told apart from a mistaken check. */
  diagnosis: string
  steps: CeilingStep[]
  /** The largest rung with no dropouts and peak below the margin, or null if even the first failed. */
  safe: number | null
  /** The first rung that dropped a sample, if the ramp got that far. */
  broke: number | null
}

const wait = (seconds: number) => new Promise((done) => setTimeout(done, seconds * 1000))

/**
 * A load that can be turned up, held, and taken down.
 *
 * Separated from the measuring so the same load can be read two ways: by the API where it exists, and
 * by a person watching DevTools where it does not. Chrome's WebAudio panel shows render capacity in its
 * status bar with no flag needed, which makes the eye a perfectly good instrument — it is only the
 * *reading* that has to move, not the measurement.
 */
export interface LoadRamp {
  points(): number
  add(points: number): void
  stop(): Promise<void>
}

/**
 * Builds load out of plain oscillators, which is the unit `load.ts` counts in — one point is one plain
 * oscillator voice, so N oscillators are N points by definition.
 *
 * Not through the engine, and not as a shortcut: the engine steals a voice whenever the next would
 * cross `MAX_LOAD`, so it cannot be asked to exceed the very number being measured.
 */
export async function startLoad(): Promise<{ ramp: LoadRamp; ctx: AudioContext }> {
  const ctx = new AudioContext()
  await ctx.resume()

  // Quiet enough not to hurt, loud enough that nothing about it is optimisable: silence is something a
  // browser may skip, and a skipped measurement measures nothing.
  const master = ctx.createGain()
  master.gain.value = 0.006
  master.connect(ctx.destination)

  const voices: OscillatorNode[] = []

  function addOne(index: number) {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    // Spread across the register, so nothing is measured at one frequency by accident.
    osc.frequency.value = 80 * Math.pow(2, (index % 36) / 12)
    const gain = ctx.createGain()
    gain.gain.value = 1 / Math.sqrt(index + 1)
    osc.connect(gain).connect(master)
    osc.start()
    voices.push(osc)
  }

  return {
    ctx,
    ramp: {
      points: () => voices.length,
      add(points) {
        for (let i = 0; i < points; i++) addOne(voices.length)
      },
      async stop() {
        for (const osc of voices) {
          try {
            osc.stop()
          } catch {
            // Already stopped.
          }
        }
        voices.length = 0
        await ctx.close()
      },
    },
  }
}

/**
 * Ramps the load up until the audio thread struggles, or until the ramp runs out.
 *
 * Needs a user gesture: it builds a realtime context. It also makes a sound — quiet, and a chord of
 * hundreds of oscillators is not music, but it is not silent either, because silence is something a
 * browser is allowed to optimise away and an optimised measurement measures nothing.
 */
export async function measureCeiling(onStep: (label: string) => void): Promise<Ceiling> {
  const ctx = new AudioContext()
  // Resumed *before* looking. A suspended context is not obviously the same object as a running one,
  // and checking first was cheap to get wrong — which is exactly what a diagnosis is for.
  await ctx.resume()

  const capacity = ctx.renderCapacity
  if (!capacity) {
    // Not a dead end any more: the ramp still runs and the panel still reads. Only the reading moves.
    const onInstance = 'renderCapacity' in ctx
    const onPrototype = 'renderCapacity' in AudioContext.prototype
    await ctx.close()
    return {
      supported: false,
      // Which of the three it is decides what to do about it, and one line of prose cannot.
      diagnosis: `on the instance: ${onInstance} · on the prototype: ${onPrototype} · state was ${ctx.state}`,
      steps: [],
      safe: null,
      broke: null,
    }
  }

  let latest: CeilingStep | null = null
  capacity.onupdate = (event) => {
    latest = {
      points: 0,
      average: event.averageLoad,
      peak: event.peakLoad,
      underruns: event.underrunRatio,
    }
  }
  capacity.start({ updateInterval: 0.4 })

  // Quiet enough not to hurt, loud enough that nothing about it is optimisable.
  const master = ctx.createGain()
  master.gain.value = 0.006
  master.connect(ctx.destination)

  const voices: OscillatorNode[] = []
  const steps: CeilingStep[] = []

  /** One point: an oscillator through a gain, which is what a plain voice is made of. */
  function addVoice(index: number) {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    // Spread across the register, so nothing is measured at one frequency by accident.
    osc.frequency.value = 80 * Math.pow(2, (index % 36) / 12)
    const gain = ctx.createGain()
    gain.gain.value = 1 / Math.sqrt(Math.max(1, voices.length + 1))
    osc.connect(gain).connect(master)
    osc.start()
    voices.push(osc)
  }

  try {
    for (const target of STEPS) {
      onStep(`${target} points`)
      while (voices.length < target) addVoice(voices.length)

      // Discard whatever was in flight from the previous rung before believing a reading.
      latest = null
      await wait(SETTLE)
      if (!latest) continue

      const reading: CeilingStep = { ...(latest as CeilingStep), points: target }
      steps.push(reading)

      // No point climbing past the first failure: everything above it fails too.
      if (reading.underruns > 0 || reading.peak >= 1) break
    }
  } finally {
    capacity.stop()
    capacity.onupdate = null
    for (const osc of voices) {
      try {
        osc.stop()
      } catch {
        // Already stopped.
      }
    }
    await ctx.close()
  }

  const safeSteps = steps.filter((step) => step.underruns === 0 && step.peak < SAFE_PEAK)
  const broken = steps.find((step) => step.underruns > 0)

  return {
    supported: true,
    diagnosis: '',
    steps,
    safe: safeSteps.length > 0 ? safeSteps[safeSteps.length - 1].points : null,
    broke: broken?.points ?? null,
  }
}

/**
 * The reading as text, and what it means for `MAX_LOAD`.
 *
 * The recommendation is deliberately a fraction of what this machine managed. A ceiling exists for the
 * weakest device worth supporting, not the machine it was measured on — and the reading is the audio
 * thread with nothing else asking for the CPU.
 */
export function formatCeiling(ceiling: Ceiling, current: number): string {
  if (!ceiling.supported) {
    return [
      'renderCapacity is not available here, so the ceiling cannot be measured directly.',
      '',
      `What was found — ${ceiling.diagnosis}`,
      '',
      'It is a Chrome-only API and may still be behind a flag rather than shipped: try',
      'chrome://flags/#enable-experimental-web-platform-features, then restart the browser.',
      '',
      'Worth reporting either way. There is no good substitute from inside the page — an underrun',
      'happens past everything a script can observe, which is why the API exists at all.',
    ].join('\n')
  }

  const rows = ceiling.steps.map(
    (step) =>
      `  ${String(step.points).padStart(5)} points   avg ${(step.average * 100).toFixed(0).padStart(3)}%` +
      `   peak ${(step.peak * 100).toFixed(0).padStart(3)}%` +
      `   dropouts ${(step.underruns * 100).toFixed(2)}%`,
  )

  const lines = [
    `MAX_LOAD is ${current} today.`,
    '',
    ...rows,
    '',
    ceiling.safe === null
      ? 'Even the smallest rung was already past the margin, which is worth a second run: something else was probably using the CPU.'
      : `Comfortable up to ${ceiling.safe} points on this machine — no dropouts, peak under ${SAFE_PEAK * 100}%.`,
  ]

  if (ceiling.broke !== null) lines.push(`First dropouts at ${ceiling.broke} points.`)
  else if (ceiling.safe !== null)
    lines.push('No rung dropped a sample, so the true ceiling is higher.')

  if (ceiling.safe !== null) {
    // A quarter, so a machine four times slower than this one still never drops a sample at 100 %.
    const suggested = Math.round(ceiling.safe / 4 / 25) * 25
    lines.push(
      '',
      `Suggested MAX_LOAD: ${suggested} — a quarter of what this machine managed, so a phone four times`,
      'slower still never drops a sample at a full meter. The point of the ceiling is the weakest device',
      'worth supporting, and this reading is the audio thread with nothing else asking for the CPU.',
    )
  }

  return lines.join('\n')
}
