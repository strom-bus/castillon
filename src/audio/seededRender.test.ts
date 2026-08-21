import { describe, expect, it } from 'vitest'
import { AudioEngine, type NoteRequest } from './engine'
import { fakeAudio } from './fakeAudio'
import { seeded, seedFrom, type Random } from './random'
import type { FxParams } from '../types/patch'

/**
 * That the same patch renders to the same file (PLAN §11.3).
 *
 * The property lives in two places and only one of them is arithmetic. `seeded` has to give the same
 * sequence for the same seed, which is easy to check — and the engine has to actually *use* the source
 * it was handed, for the noise buffers and for a reverb's impulse response. That second half is the
 * one that fails silently: a generator threaded to nine of ten places still produces two different
 * files, and nothing about the code would look wrong.
 *
 * There is no `OfflineAudioContext` in a test runner, so what is compared is what the engine wrote
 * into its buffers rather than a rendered file. That is the same question one step earlier.
 *
 * Buffers are compared by fingerprint rather than sample by sample, and not for speed: comparing them
 * directly worked, but a *failure* asked the runner to diff two hundred and eighty thousand floats,
 * which took long enough to look like a hang. A test that reports uselessly slowly when it breaks is
 * most of the way to no test at all.
 */

/** A short digest of a buffer, so a mismatch prints two numbers instead of every sample. */
function fingerprint(samples: Float32Array): string {
  let hash = 0
  for (let i = 0; i < samples.length; i++) {
    hash = (hash * 31 + Math.round(samples[i] * 1e6)) | 0
  }
  return `${samples.length}:${hash}`
}

const NOISE: NoteRequest = {
  nodeId: 'osc',
  time: 0,
  freq: 440,
  waveform: 'white',
  pulseWidth: 0.5,
  duration: 0.5,
  gain: 0.8,
  attack: 5,
  release: 50,
  filterType: 'off',
  cutoff: 1200,
  resonance: 4,
}

const REVERB = { effect: 'reverb', mix: 0.8, decay: 2.5, cutoff: 4000 } as FxParams

/** What one engine writes into its noise buffer, given a source of randomness. */
function noiseFrom(random: Random): string {
  const fake = fakeAudio()
  const engine = new AudioEngine(random)
  engine.adopt(fake.ctx)
  engine.playNote(NOISE)

  const source = fake.nodes('bufferSource')[0] as {
    buffer: { getChannelData(c: number): Float32Array }
  }
  return fingerprint(source.buffer.getChannelData(0))
}

/** What one engine writes into a reverb's impulse response. */
function impulseFrom(random: Random): string {
  const fake = fakeAudio()
  const engine = new AudioEngine(random)
  engine.adopt(fake.ctx)
  engine.createEffect('fx', REVERB, 120)

  const convolver = fake.nodes('convolver')[0] as {
    buffer: { getChannelData(c: number): Float32Array }
  }
  return fingerprint(convolver.buffer.getChannelData(0))
}

describe('seedFrom', () => {
  it('gives the same seed for the same text', () => {
    expect(seedFrom('K7M2QX')).toBe(seedFrom('K7M2QX'))
  })

  it('separates codes that differ in one character', () => {
    // Patch codes differ from each other in very little, so a hash that clustered them would make
    // two neighbouring patches share a noise grain.
    const a = seedFrom('AAAAAAAAAAAAAAAA')
    const b = seedFrom('AAAAAAAAAAAAAAAB')
    expect(a).not.toBe(b)
    expect(Math.abs(a - b)).toBeGreaterThan(1000)
  })

  it('never returns zero, which would stick some generators at zero forever', () => {
    // The empty string hashes to the FNV offset, but a hash that cancelled would be the dangerous one.
    expect(seedFrom('')).not.toBe(0)
  })
})

describe('seeded', () => {
  it('repeats itself exactly for one seed', () => {
    const a = seeded(12345)
    const b = seeded(12345)
    expect(Array.from({ length: 50 }, a)).toEqual(Array.from({ length: 50 }, b))
  })

  it('diverges for a different seed', () => {
    const a = Array.from({ length: 50 }, seeded(1))
    const b = Array.from({ length: 50 }, seeded(2))
    expect(a).not.toEqual(b)
  })

  it('stays inside the range everything downstream assumes', () => {
    const random = seeded(seedFrom('castillon'))
    for (let i = 0; i < 2000; i++) {
      const value = random()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('spreads across that range rather than sitting in one corner', () => {
    // A generator that returned 0.5 forever would pass every test above and make silent noise.
    const random = seeded(99)
    const buckets = new Array(10).fill(0)
    for (let i = 0; i < 10000; i++) buckets[Math.floor(random() * 10)]++
    for (const count of buckets) expect(count).toBeGreaterThan(500)
  })
})

describe('the engine uses the source it was given', () => {
  it('writes the same noise twice for one seed', () => {
    const code = 'K7M2QX'
    expect(noiseFrom(seeded(seedFrom(code)))).toBe(noiseFrom(seeded(seedFrom(code))))
  })

  it('writes different noise for a different patch', () => {
    expect(noiseFrom(seeded(seedFrom('AAAA')))).not.toBe(noiseFrom(seeded(seedFrom('BBBB'))))
  })

  it('writes the same reverb tail twice for one seed', () => {
    // The half the plan called expensive: an impulse response is built inside an effect's `create`,
    // so the source had to reach through the descriptor to get there.
    expect(impulseFrom(seeded(1))).toBe(impulseFrom(seeded(1)))
  })

  it('writes a different reverb tail for a different seed', () => {
    expect(impulseFrom(seeded(1))).not.toBe(impulseFrom(seeded(2)))
  })

  it('is unseeded by default, so live playback is not identical every time', () => {
    // Seeding the live engine would mean rebuilding every buffer whenever the patch changed, since
    // the seed would have to follow the patch. Only the export needs two runs to match.
    const fake = fakeAudio()
    const engine = new AudioEngine()
    engine.adopt(fake.ctx)
    engine.playNote(NOISE)

    const source = fake.nodes('bufferSource')[0] as {
      buffer: { getChannelData(c: number): Float32Array }
    }
    const samples = source.buffer.getChannelData(0)
    // Filled with something, and not all one value.
    expect(new Set(Array.from(samples.slice(0, 200))).size).toBeGreaterThan(100)
  })
})
