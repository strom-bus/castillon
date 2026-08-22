/**
 * Measuring what the budget's numbers should be.
 *
 * `audio/load.ts` says outright that its constants are reasoned rather than measured: they come from
 * what each node does per sample, which is a decent way to be roughly right and no way at all to be
 * exactly right. This turns them into measurements.
 *
 * **The method.** Render the same thing offline with and without one unit of work, time both, and the
 * difference is what that unit costs. Divide by what a plain sine voice costs and the answer is
 * already in the unit `load.ts` uses — one point is one plain oscillator voice — so a measured number
 * can be dropped straight in.
 *
 * The engine is driven directly rather than through a patch and the scheduler: `playNote` and
 * `createEffect` build exactly the nodes being measured, and nothing else varies.
 *
 * **What this does not tell you.** An offline render is not a realtime one — the browser is free to
 * schedule it differently — and a laptop is not a phone. What transfers is the *ratio* between two
 * kinds of work, which is all these constants are. The ceiling of a hundred and the threshold at
 * three quarters are a different kind of question: they are about when a machine starts to struggle,
 * and no amount of timing a render answers that. Those stay a judgement made by listening.
 */

import { AudioEngine, type NoteRequest } from '../audio/engine'
import { EFFECTS, effectOr } from '../audio/effects'
import { LAYER_THRESHOLD, MAX_LOAD, voiceCost } from '../audio/load'
import { MOD_COST, targetsFor, type ModVia } from '../audio/modulation'
import { driveValueModulation } from '../audio/render'
import type { FilterType, FxParams, ModParams, Waveform } from '../types/patch'

/** Long enough that per-sample work dominates the cost of setting the graph up. */
const RENDER_SECONDS = 4
const SAMPLE_RATE = 48000
/** Sustained voices per measurement. Well under the budget, so the engine steals none of them. */
const VOICES = 24
/** Each timing repeated, and the median taken: one render can be interrupted by anything. */
const REPEATS = 5

export interface Measured {
  label: string
  /** What `load.ts` says today. */
  current: number
  /** What the measurement says, in the same unit: one plain sine voice. */
  measured: number
  /** Milliseconds of render time per second of audio, for the one unit. */
  msPerSecond: number
}

/**
 * What sweeping a parameter adds to the thing being swept.
 *
 * The budget prices a modulator — an oscillator and a gain — and prices nothing for what modulating
 * *does* to its destination. There is reason to think that is a real omission: an automated
 * `AudioParam` makes a node recompute its coefficients per sample rather than per block, which is the
 * only thing that explains a phaser costing four times what its node count suggests.
 *
 * Measured by difference against the *same* modulator connected to something free, so its own cost is
 * paid on both sides and what is left is the sweep.
 *
 * The first attempt compared against a modulator connected to nothing at all, and that was wrong in a
 * way the control caught: Web Audio need not render a node with no path to the destination, so an
 * unconnected modulator costs nothing to run. Every surcharge came back at about the modulator's own
 * cost — including `level` and `mix`, which are gains and should be free — and one came back negative.
 * A modulator that exists but is idle is not the same as one that is running.
 */
export interface Surcharge {
  label: string
  via: ModVia
  /** Points added to the destination, in the same unit as everything else. */
  surcharge: number
}

export interface Report {
  voices: Measured[]
  effects: Measured[]
  surcharges: Surcharge[]
  /** What one plain sine voice costs, which is the unit everything else is divided by. */
  unitMs: number
  /** Overhead with nothing playing: the master gain and the limiter. */
  baselineMs: number
  /**
   * What a full budget would cost to render, as a share of real time. Under 1 means a patch at the
   * ceiling renders faster than it plays; well over 1 says the ceiling is set too high for this
   * machine, which is the one thing here that speaks to the ceiling at all.
   */
  fullBudgetRatio: number
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function note(over: Partial<NoteRequest>, index: number): NoteRequest {
  return {
    nodeId: `osc${index}`,
    time: 0,
    // Spread across the register, so nothing is measured at one frequency by accident.
    freq: 110 * Math.pow(2, (index % 24) / 12),
    waveform: 'sine',
    pulseWidth: 0.5,
    // Sustained for the whole render: the cost being measured is a voice running, not one starting.
    duration: RENDER_SECONDS,
    gain: 0.02,
    attack: 5,
    decay: 0,
    release: 5,
    filterType: 'off',
    cutoff: 2000,
    resonance: 4,
    ...over,
  }
}

/** Renders once and returns how long it took, in milliseconds. */
async function timeRender(build: (engine: AudioEngine) => void): Promise<number> {
  const ctx = new OfflineAudioContext(2, Math.ceil(RENDER_SECONDS * SAMPLE_RATE), SAMPLE_RATE)
  const engine = new AudioEngine()
  engine.setMasterGain(0.8)
  engine.adopt(ctx)
  build(engine)
  // A no-op unless something is modulated by recomputation, and where something is, the cost of the
  // rebuilding is exactly what is being measured — so it has to be driven here as a render drives it.
  driveValueModulation(ctx, engine, RENDER_SECONDS)

  const started = performance.now()
  await ctx.startRendering()
  const took = performance.now() - started
  engine.dispose()
  return took
}

async function timeMedian(build: (engine: AudioEngine) => void): Promise<number> {
  const runs: number[] = []
  // One discarded first: the first render of a session pays for warm-up that nothing after it does.
  await timeRender(build)
  for (let i = 0; i < REPEATS; i++) runs.push(await timeRender(build))
  return median(runs)
}

const nothing = () => {}

/**
 * Times everything and reports it.
 *
 * `onStep` is called with a label before each measurement, because the whole run takes a while and a
 * page that looks frozen is a page somebody reloads halfway through.
 */
export async function measureLoad(onStep: (label: string) => void = nothing): Promise<Report> {
  onStep('baseline')
  const baselineMs = await timeMedian(nothing)

  /** The cost of one of something, over and above an empty render. */
  const perUnit = async (build: (engine: AudioEngine) => void, count: number): Promise<number> => {
    const total = await timeMedian(build)
    return (total - baselineMs) / count
  }

  onStep('one plain sine voice')
  const unitMs = await perUnit((engine) => {
    for (let i = 0; i < VOICES; i++) engine.playNote(note({}, i))
  }, VOICES)

  const waveforms: Waveform[] = [
    'sine',
    'triangle',
    'sawtooth',
    'square',
    'pulse',
    'ramp',
    'white',
    'pink',
    'brown',
    'blue',
  ]

  const voices: Measured[] = []
  for (const waveform of waveforms) {
    for (const filterType of ['off', 'lowpass'] as FilterType[]) {
      const label = filterType === 'off' ? waveform : `${waveform} + filter`
      onStep(label)
      const ms = await perUnit((engine) => {
        for (let i = 0; i < VOICES; i++) engine.playNote(note({ waveform, filterType }, i))
      }, VOICES)
      voices.push({
        label,
        current: voiceCost(waveform, filterType !== 'off'),
        measured: ms / unitMs,
        msPerSecond: ms / RENDER_SECONDS,
      })
    }
  }

  const effects: Measured[] = []
  for (const descriptor of EFFECTS) {
    onStep(descriptor.label)
    // One oscillator feeding one effect, against the same oscillator alone: what is left is the
    // effect. Effects are priced as standing cost, so nothing needs to be sounding through them —
    // but something is, since an effect with silence at its input can be optimised away.
    const params = { effect: descriptor.kind, mix: 0.8, ...descriptor.defaults } as FxParams
    const withEffect = await timeMedian((engine) => {
      engine.playNote(note({}, 0))
      engine.createEffect('fx', params, 120)
      engine.connectSend('osc0', 'fx')
    })
    const alone = await timeMedian((engine) => engine.playNote(note({}, 0)))
    const ms = withEffect - alone
    effects.push({
      label: descriptor.label,
      current: effectOr(descriptor.kind).cost(params),
      measured: ms / unitMs,
      msPerSecond: ms / RENDER_SECONDS,
    })
  }

  onStep('a modulator')
  const modMs = await timeMedian((engine) => {
    engine.playNote(note({}, 0))
    engine.createModulator('mod', { kind: 'lfo', wave: 'sine', rate: 2, depth: 0.6 })
    engine.connectMod('mod', 'osc0', 'level', 0.6)
  })
  const modAlone = await timeMedian((engine) => engine.playNote(note({}, 0)))
  effects.push({
    label: 'MOD',
    current: MOD_COST,
    measured: (modMs - modAlone) / unitMs,
    msPerSecond: (modMs - modAlone) / RENDER_SECONDS,
  })

  const surcharges = await measureSurcharges(onStep, timeMedian, unitMs)

  return {
    voices,
    effects,
    surcharges,
    unitMs,
    baselineMs,
    // A full budget of plain voices, against the length of audio it would be.
    fullBudgetRatio: (unitMs * MAX_LOAD) / (RENDER_SECONDS * 1000),
  }
}

const LFO: ModParams = { kind: 'lfo', wave: 'sine', rate: 2, depth: 0.6 }

/**
 * What sweeping each parameter costs the thing being swept.
 *
 * Each one is two renders of the same graph: once with a modulator that exists and is connected to
 * nothing, once with it connected. The modulator's own cost is in both, so the difference is the
 * sweep and nothing else.
 *
 * Recomputed targets are measured too, and they are the ones to watch: they are not an automated
 * parameter but a buffer or a curve rebuilt twenty times a second, which nothing in the budget knows
 * about at all. Their number carries a little render-only overhead — an offline render has to suspend
 * and resume to do the rebuilding — so `pan · width` is measured as well and reported alongside as
 * the floor: its recomputation is two `setTargetAtTime` calls, so whatever it costs is the overhead
 * rather than the work.
 */
async function measureSurcharges(
  onStep: (label: string) => void,
  timeMedian: (build: (engine: AudioEngine) => void) => Promise<number>,
  unitMs: number,
): Promise<Surcharge[]> {
  const out: Surcharge[] = []

  for (const descriptor of EFFECTS) {
    const params = { effect: descriptor.kind, mix: 0.8, ...descriptor.defaults } as FxParams

    /**
     * The same graph every time, and a modulator that is always running. What differs is only where
     * its cable lands: on the parameter under test, or on the oscillator's own level.
     *
     * The oscillator's level is the reference because it is a gain on a node that is not the subject —
     * so it is both free and out of the way.
     */
    const build = (sweeping: string | null) => (engine: AudioEngine) => {
      engine.playNote(note({}, 0))
      engine.createEffect('fx', params, 120)
      engine.connectSend('osc0', 'fx')
      engine.createModulator('mod', LFO)
      // Null is the reference: wired somewhere free rather than not wired at all.
      if (sweeping === null) engine.connectMod('mod', 'osc0', 'level', 0.6)
      else engine.connectMod('mod', 'fx', sweeping, 0.6)
    }

    for (const target of targetsFor('fx', descriptor.kind)) {
      onStep(`${descriptor.label} · ${target.key}`)
      const idle = await timeMedian(build(null))
      const swept = await timeMedian(build(target.key))
      out.push({
        label: `${descriptor.label} · ${target.key}`,
        via: target.via,
        surcharge: (swept - idle) / unitMs,
      })
    }
  }

  // The per-voice case, which is the one with room to be large: an oscillator's filter is built per
  // note, so one cable sweeps as many biquads as there are voices sounding.
  for (const key of ['cutoff', 'resonance'] as const) {
    onStep(`an oscillator's ${key}, per voice`)
    const build = (sweeping: boolean) => (engine: AudioEngine) => {
      // All on one node, so a single cable reaches every voice.
      for (let i = 0; i < VOICES; i++) {
        engine.playNote({ ...note({ filterType: 'lowpass' }, i), nodeId: 'osc' })
      }
      engine.createModulator('mod', LFO)
      // Running in both cases; only the destination moves, from the free level to the filter.
      engine.connectMod('mod', 'osc', sweeping ? key : 'level', 0.6)
    }
    const idle = await timeMedian(build(false))
    const swept = await timeMedian(build(true))
    out.push({
      label: `osc · ${key} (per voice)`,
      via: 'audio',
      surcharge: (swept - idle) / unitMs / VOICES,
    })
  }

  return out
}

/** The report as text, for pasting somewhere. */
export function formatReport(report: Report): string {
  const row = (m: Measured) =>
    `  ${m.label.padEnd(20)} now ${m.current.toFixed(2).padStart(6)}   measured ${m.measured
      .toFixed(2)
      .padStart(6)}   (${m.msPerSecond.toFixed(3)} ms per second of audio)`

  return [
    `Unit: one plain sine voice = ${report.unitMs.toFixed(3)} ms per ${RENDER_SECONDS} s render`,
    `Empty render: ${report.baselineMs.toFixed(1)} ms`,
    `A full budget of ${MAX_LOAD} points renders at ${report.fullBudgetRatio.toFixed(3)}x real time`,
    `(layering backs off at ${Math.round(LAYER_THRESHOLD * 100)}% of that)`,
    '',
    'Voices:',
    ...report.voices.map(row),
    '',
    'Standing cost:',
    ...report.effects.map(row),
    '',
    'What sweeping a parameter adds to what it is pointed at (nothing prices these today):',
    ...report.surcharges.map(
      (s) => `  ${s.label.padEnd(28)} ${s.via.padEnd(6)} ${s.surcharge.toFixed(2).padStart(7)}`,
    ),
  ].join('\n')
}
