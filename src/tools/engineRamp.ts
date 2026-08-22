/**
 * Ramping the load with the app's own engine, and reading its own meter.
 *
 * Every earlier ramp built voices by hand, and that turned out to be the flaw in the whole ceiling
 * measurement: a hand-built voice was an oscillator through a **constant** gain, sustained for ever. A
 * voice the app builds carries a scheduled envelope — four automation points on its gain — which makes
 * that gain a-rate rather than k-rate, and it is created and destroyed on every note. Those are exactly
 * the two costs the earlier reading could not see, and the model counts both at zero.
 *
 * So this asks the engine to play notes, and reports the number **the meter itself would show**. There
 * is no model in between: when the audio thread drops its first sample, whatever this says is the
 * ceiling, in the units the app actually counts.
 *
 * Paired with `playbackStats`, no eye is needed either — an underrun is a counter going up rather than
 * a percentage to interpret on a panel that never sits still.
 */

import { AudioEngine, type NoteRequest } from '../audio/engine'
import { effectOr } from '../audio/effects'
import type { FxParams } from '../types/patch'
import { readPlayback, type Playback } from './playbackStats'

/** Notes a second, per slot. Fast enough that construction churn is a real share of the work. */
const NOTE_RATE = 6
/** How far ahead notes are scheduled, matching the engine's own look-ahead discipline. */
const HORIZON = 0.25
/** How often the scheduler wakes. */
const TICK = 0.05

export interface EngineRamp {
  /** Voice slots running: each one retriggers, so it stands for one sounding line of a patch. */
  slots(): number
  /** What the meter would show — the engine's own accounting, not a model of it. */
  points(): number
  /** The latest underrun reading, or null where the browser cannot say. */
  playback(): Playback | null
  add(slots: number): void
  stop(): void
}

export interface EngineRampOptions {
  /** Whether each voice carries its own filter, which is what most patches do. */
  filtered?: boolean
  /** An effect every this many slots, or none. A patch is rarely all voices. */
  effectEvery?: number
}

/**
 * Starts a ramp. Returns the controls and the context, so underruns can be read off the same one.
 *
 * Quiet, but not silent: silence is something a browser may skip, and a skipped measurement measures
 * nothing.
 */
export function startEngineRamp(options: EngineRampOptions = {}): {
  ramp: EngineRamp
  ctx: AudioContext
} {
  const { filtered = true, effectEvery = 0 } = options
  const ctx = new AudioContext()
  const engine = new AudioEngine()
  engine.setMasterGain(0.05)
  engine.adopt(ctx)
  void engine.loadWorklets()

  let slots = 0
  /** Absolute audio time each slot has been scheduled up to, so nothing is scheduled twice. */
  const scheduled: number[] = []
  let effects = 0

  function note(slot: number, at: number): NoteRequest {
    return {
      nodeId: `slot${slot}`,
      time: at,
      // Spread across the register, so nothing is measured at one frequency by accident.
      freq: 90 * Math.pow(2, (slot % 30) / 12),
      waveform: 'sawtooth',
      pulseWidth: 0.5,
      // Overlapping: a note outlasting its own step is what makes a patch layer, and layering is most
      // of what the budget is about.
      duration: 1 / NOTE_RATE + 0.05,
      gain: 0.5,
      // The envelope is the point. This is what makes a voice's gain a-rate, and a hand-built voice
      // with a constant gain is the thing that mismeasured the ceiling by an order of magnitude.
      attack: 6,
      release: 90,
      filterType: filtered ? 'lowpass' : 'off',
      cutoff: 700 + (slot % 40) * 80,
      resonance: 5,
    }
  }

  const timer = window.setInterval(() => {
    const now = engine.now()
    for (let slot = 0; slot < slots; slot++) {
      let at = scheduled[slot] ?? now
      while (at < now + HORIZON) {
        engine.playNote(note(slot, Math.max(at, now)))
        at += 1 / NOTE_RATE
      }
      scheduled[slot] = at
    }
  }, TICK * 1000)

  return {
    ctx,
    ramp: {
      slots: () => slots,
      points: () => engine.voiceLoadAt(engine.now()) + engine.effectLoad(),
      playback: () => readPlayback(ctx),
      add(count) {
        for (let i = 0; i < count; i++) {
          const slot = slots++
          // Staggered, so every slot does not fire on the same tick and produce one huge spike.
          scheduled[slot] = engine.now() + (slot % NOTE_RATE) / NOTE_RATE

          if (effectEvery > 0 && slot % effectEvery === 0) {
            const params = {
              effect: 'reverb',
              mix: 0.5,
              ...effectOr('reverb').defaults,
            } as FxParams
            const id = `fx${effects++}`
            engine.createEffect(id, params, 120)
            engine.connectSend(`slot${slot}`, id)
          }
        }
      },
      stop() {
        window.clearInterval(timer)
        engine.dispose()
        void ctx.close()
      },
    },
  }
}
