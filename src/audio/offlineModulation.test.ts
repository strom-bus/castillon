import { describe, expect, it, vi } from 'vitest'
import { AudioEngine } from './engine'
import { fakeAudio } from './fakeAudio'
import { driveValueModulation } from './render'
import type { FxParams } from '../types/patch'

/**
 * Stepping the modulations that cannot be scheduled, on the audio clock rather than the wall clock.
 *
 * Two separate things can go wrong and neither is visible from the app. The engine must not start a
 * timer it does not own — that was the bug: an offline render produces a minute of audio in about a
 * second, so a 50 ms wall-clock timer fired once or twice per render at an arbitrary moment, and an
 * export contained almost none of its own modulation. And the render must register its suspensions
 * over the right span, since a loop that stops early silently truncates the sweep.
 */

const REVERB = { effect: 'reverb', mix: 0.8, decay: 2.5, cutoff: 4000 } as FxParams

/** An offline context that records where it was asked to stop. */
function recordingContext(withSuspend = true) {
  const suspendedAt: number[] = []
  let resumed = 0
  const ctx = {
    suspend: withSuspend
      ? (at: number) => {
          suspendedAt.push(at)
          return Promise.resolve()
        }
      : undefined,
    resume: () => {
      resumed++
      return Promise.resolve()
    },
  }
  return { ctx: ctx as unknown as OfflineAudioContext, suspendedAt, resumed: () => resumed }
}

function engineWithValueModulation(): AudioEngine {
  const engine = new AudioEngine()
  engine.adopt(fakeAudio().ctx)
  engine.createEffect('fx', REVERB, 120)
  engine.createModulator('mod', { kind: 'lfo', wave: 'sine', rate: 2, depth: 0.8 })
  engine.connectMod('mod', 'fx', 'decay', 0.8)
  return engine
}

describe('an adopted engine', () => {
  it('starts no wall-clock timer, since it does not own the clock', () => {
    vi.useFakeTimers()
    try {
      const engine = engineWithValueModulation()
      expect(engine.hasValueModulation()).toBe(true)
      // The regression this guards: a timer here fires against a clock that is not the one producing
      // the audio, which is how a render came to contain almost none of its own modulation.
      expect(vi.getTimerCount()).toBe(0)
      engine.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('driveValueModulation', () => {
  it('stops at every step across the render, and no further', () => {
    const { ctx, suspendedAt } = recordingContext()
    driveValueModulation(ctx, engineWithValueModulation(), 1)

    // Twenty a second, from the first step rather than from zero — nothing has moved at zero.
    expect(suspendedAt).toHaveLength(19)
    expect(suspendedAt[0]).toBeCloseTo(0.05, 6)
    expect(suspendedAt.at(-1)!).toBeLessThan(1)
  })

  it('does nothing at all when nothing is modulated that way', () => {
    // Which is most patches, and registering a couple of thousand suspensions for them would be a
    // whole render's worth of promises spent to move nothing.
    const engine = new AudioEngine()
    engine.adopt(fakeAudio().ctx)
    const { ctx, suspendedAt } = recordingContext()
    driveValueModulation(ctx, engine, 10)
    expect(suspendedAt).toEqual([])
  })

  it('steps and resumes at each stop', async () => {
    const engine = engineWithValueModulation()
    const advance = vi.spyOn(engine, 'advanceValueModulation')
    const recorded = recordingContext()
    driveValueModulation(recorded.ctx, engine, 0.2)

    // The callbacks are promise continuations, so they land on the next turn.
    await Promise.resolve()
    await Promise.resolve()
    expect(advance).toHaveBeenCalled()
    expect(recorded.resumed()).toBeGreaterThan(0)
  })

  it('degrades rather than throwing where an offline context cannot suspend', () => {
    // Older Safari. The parameter then stays at the value it was built with: a tail that does not
    // breathe, which is what happened before any of this and is the fair way to be wrong.
    const { ctx, suspendedAt } = recordingContext(false)
    expect(() => driveValueModulation(ctx, engineWithValueModulation(), 5)).not.toThrow()
    expect(suspendedAt).toEqual([])
  })
})
