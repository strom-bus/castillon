/**
 * How many reverb tails a load of reverbs actually needs.
 *
 * One each is the obvious answer and it is linear in a thing that costs a megabyte per second: fine for
 * the three or four a patch has, a hundred and fifty megabytes for a measurement holding seventy-nine. One
 * shared is the other obvious answer and it is wrong for a different reason — two reverbs on the same
 * impulse response are perfectly correlated, so they sum three decibels louder and lose the diffusion that
 * is the whole point of a room.
 */

import { describe, expect, it } from 'vitest'
import { AudioEngine } from './engine'
import { fakeAudio } from './fakeAudio'
import { defaultFxParams } from '../nodes/registry'

/** Matches IMPULSE_VARIANTS in effects.ts, which is not exported: this is the claim, not the constant. */
const MOST = 4

function tailsFor(count: number, decay = 2.5): unknown[] {
  const fake = fakeAudio()
  const engine = new AudioEngine()
  engine.adopt(fake.ctx)
  for (let i = 0; i < count; i++) {
    engine.createEffect(`r${i}`, { ...defaultFxParams(), effect: 'reverb', decay }, 120)
  }
  return fake.nodes('convolver').map((node) => node.buffer)
}

describe('a load of reverbs at one decay', () => {
  it('gives every one of them a tail', () => {
    for (const buffer of tailsFor(20)) expect(buffer).not.toBeNull()
  })

  it('stops allocating new ones past a handful', () => {
    // Constant rather than linear, which is the whole change. Eighty of them used to be eighty megabytes.
    expect(new Set(tailsFor(80)).size).toBeLessThanOrEqual(MOST)
  })

  it('still uses more than one, so they do not sum in phase', () => {
    // A single shared tail is cheaper still and turns a wall of reverbs into one loud correlated one.
    expect(new Set(tailsFor(20)).size).toBeGreaterThan(1)
  })

  it('spends them all before it starts repeating', () => {
    expect(new Set(tailsFor(MOST)).size).toBe(MOST)
  })
})

describe('reverbs at different decays', () => {
  it('do not share a tail, since the tail is the decay', () => {
    // Sharing across decays would make a two-second room and a ten-second one sound the same length.
    const fake = fakeAudio()
    const engine = new AudioEngine()
    engine.adopt(fake.ctx)
    engine.createEffect('short', { ...defaultFxParams(), effect: 'reverb', decay: 1 }, 120)
    engine.createEffect('long', { ...defaultFxParams(), effect: 'reverb', decay: 8 }, 120)

    const [first, second] = fake.nodes('convolver').map((node) => node.buffer)
    expect(first).not.toBe(second)
    expect((first as { length: number }).length).toBeLessThan((second as { length: number }).length)
  })
})

describe('two contexts', () => {
  it('do not lend each other tails', () => {
    // A buffer belongs to the context that made it, and a render's would outlive the render.
    const a = fakeAudio()
    const b = fakeAudio()
    const one = new AudioEngine()
    const two = new AudioEngine()
    one.adopt(a.ctx)
    two.adopt(b.ctx)
    one.createEffect('r', { ...defaultFxParams(), effect: 'reverb', decay: 2.5 }, 120)
    two.createEffect('r', { ...defaultFxParams(), effect: 'reverb', decay: 2.5 }, 120)

    expect(a.nodes('convolver')[0]!.buffer).not.toBe(b.nodes('convolver')[0]!.buffer)
  })
})
