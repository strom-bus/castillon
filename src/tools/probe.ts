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

export interface Trial {
  units: number
  /** What the meter would show — the engine's own accounting. */
  points: number
  /** Blocks the audio thread failed to deliver while the load was held. */
  underruns: number
}

const wait = (seconds: number) => new Promise((done) => setTimeout(done, seconds * 1000))

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

/** Whether trials can be run at all here. */
export async function probingAvailable(): Promise<boolean> {
  const ctx = new AudioContext()
  await ctx.resume()
  const yes = playbackStatsAvailable(ctx)
  await ctx.close()
  return yes
}

/**
 * Runs one trial and tears everything down.
 *
 * The engine's own ceiling is lifted: it steals a voice whenever the next would cross `MAX_LOAD`, so a
 * trial bounded by the number under test could never exceed it — which is how one earlier measurement
 * silently capped itself at the answer it was looking for.
 */
export async function probe(subject: Subject, units: number): Promise<Trial> {
  const ctx = new AudioContext()
  const engine = new AudioEngine()
  engine.ceiling = Number.POSITIVE_INFINITY
  engine.setMasterGain(0.04)
  engine.adopt(ctx)
  await engine.loadWorklets()
  await ctx.resume()

  const filtered = subject.filtered ?? true
  const scheduled: number[] = []

  for (let slot = 0; slot < units; slot++) {
    // Staggered, so every voice does not fire on the same tick and produce one huge spike.
    scheduled[slot] = ctx.currentTime + (slot % NOTE_RATE) / NOTE_RATE

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

  const timer = window.setInterval(() => {
    const now = engine.now()
    for (let slot = 0; slot < units; slot++) {
      let at = scheduled[slot] ?? now
      while (at < now + HORIZON) {
        engine.playNote(note(slot, Math.max(at, now), filtered))
        at += 1 / NOTE_RATE
      }
      scheduled[slot] = at
    }
  }, 50)

  try {
    await wait(SETTLE)
    const before = readPlayback(ctx)
    const points = engine.voiceLoadAt(engine.now()) + engine.effectLoad()
    await wait(HOLD)
    const after = readPlayback(ctx)

    return {
      units,
      points,
      underruns: (after?.events ?? 0) - (before?.events ?? 0),
    }
  } finally {
    window.clearInterval(timer)
    engine.dispose()
    await ctx.close()
  }
}

/** Every audio-rate target an effect offers, for sweeping the surcharge measurements over. */
export function audioTargets(effect: EffectKind): string[] {
  return targetsFor('fx', effect)
    .filter((target) => target.via === 'audio')
    .map((target) => target.key)
}
