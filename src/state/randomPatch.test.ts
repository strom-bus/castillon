import { describe, expect, it } from 'vitest'
import { EFFECTS } from '../audio/effects'
import type { FxParams, OscParams } from '../types/patch'
import { decodePatch, encodePatch } from './patchCode'
import { randomPatch } from './randomPatch'

/** Deterministic, so a claim about a thousand patches means the same thing on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

const many = (count = 200) => Array.from({ length: count }, (_, i) => randomPatch(seeded(i + 1)))

function reachable(patch: ReturnType<typeof randomPatch>): Set<string> {
  const seen = new Set(patch.nodes.filter((n) => n.type === 'start').map((n) => n.id))
  for (let pass = 0; pass < patch.nodes.length; pass++) {
    for (const edge of patch.edges) {
      if (edge.kind === 'event' && seen.has(edge.source)) seen.add(edge.target)
    }
  }
  return seen
}

const oscs = (patch: ReturnType<typeof randomPatch>) =>
  patch.nodes.filter((n) => n.type === 'osc').map((n) => n.params as OscParams)

describe('randomPatch', () => {
  it('always makes something that plays', () => {
    for (const patch of many()) {
      expect(patch.nodes.filter((n) => n.type === 'start').length).toBeGreaterThan(0)
      expect(oscs(patch).length).toBeGreaterThan(0)
    }
  })

  it('leaves nothing grey and silent', () => {
    // An orphaned node is the one outcome that would look like a bug rather than a patch.
    for (const patch of many()) {
      const seen = reachable(patch)
      for (const node of patch.nodes) {
        if (node.type === 'fx') continue // reached by audio, not by triggers
        expect(seen.has(node.id)).toBe(true)
      }
    }
  })

  it('reaches every effect it places from an oscillator', () => {
    for (const patch of many()) {
      const fx = patch.nodes.filter((n) => n.type === 'fx')
      const fed = new Set(patch.edges.filter((e) => e.kind === 'audio').map((e) => e.target))
      for (const node of fx) expect(fed.has(node.id)).toBe(true)
    }
  })

  it('draws its notes from one scale, so a patch sounds deliberate', () => {
    for (const patch of many(60)) {
      const pitches = new Set(
        oscs(patch)
          .flatMap((p) => p.steps)
          .map((s) => s.note % 12),
      )
      // Chromatic would be twelve. A scale is at most seven, whichever octaves it lands in.
      expect(pitches.size).toBeLessThanOrEqual(7)
    }
  })

  it('keeps notes inside the range the sequencer can edit', () => {
    for (const patch of many()) {
      for (const step of oscs(patch).flatMap((p) => p.steps)) {
        expect(step.note).toBeGreaterThanOrEqual(24)
        expect(step.note).toBeLessThanOrEqual(84)
      }
    }
  })

  it('shares the level out, so a wall of oscillators is not louder than one', () => {
    // Measured as the power sum, since sources that are not in phase add in power rather than in
    // amplitude. That is the quantity the level scaling is designed to hold still, and it holds it
    // across patches from one oscillator to sixty.
    const powers = many().map((patch) =>
      Math.sqrt(oscs(patch).reduce((sum, p) => sum + p.gain * p.gain, 0)),
    )
    for (const power of powers) {
      expect(power).toBeGreaterThan(0.15)
      expect(power).toBeLessThan(0.55)
    }
  })

  it('spans small patches and large ones rather than always landing in the middle', () => {
    // The point of a dice button is the spread. Always getting five oscillators would be the one
    // outcome that gets boring.
    const counts = many(400).map((p) => oscs(p).length)
    expect(Math.min(...counts)).toBeLessThanOrEqual(3)
    expect(Math.max(...counts)).toBeGreaterThan(25)

    const share = (test: (n: number) => boolean) => counts.filter(test).length / counts.length
    expect(share((n) => n <= 4)).toBeGreaterThan(0.15)
    expect(share((n) => n >= 15)).toBeGreaterThan(0.15)
  })

  it('gives a big patch a rack of effects and a small one a pedal', () => {
    const patches = many(400)
    const big = patches.filter((p) => oscs(p).length >= 15)
    const small = patches.filter((p) => oscs(p).length <= 4)
    const fx = (p: (typeof patches)[number]) => p.nodes.filter((n) => n.type === 'fx').length

    const average = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(average(big.map(fx))).toBeGreaterThan(average(small.map(fx)) * 2)
  })

  it('usually places at least one effect', () => {
    const patches = many(300)
    const withNone = patches.filter((p) => p.nodes.every((n) => n.type !== 'fx'))
    expect(withNone.length / patches.length).toBeLessThan(0.3)
  })

  it('leaves rests in the sequences rather than filling every step', () => {
    // A phrase needs holes. Across this many patches some step has to be muted.
    const steps = many(40).flatMap((p) => oscs(p).flatMap((o) => o.steps))
    expect(steps.some((s) => !s.active)).toBe(true)
    // And most of them are not, or the patch would be mostly silence.
    expect(steps.filter((s) => s.active).length / steps.length).toBeGreaterThan(0.6)
  })

  it('favours pitch over noise', () => {
    const waveforms = many(120).flatMap((p) => oscs(p).map((o) => o.waveform))
    const noise = waveforms.filter((w) => ['white', 'pink', 'brown', 'blue'].includes(w))
    expect(noise.length / waveforms.length).toBeLessThan(0.25)
    // But it does reach for them.
    expect(noise.length).toBeGreaterThan(0)
  })

  it('only ever names an effect that is actually built', () => {
    const built = new Set(EFFECTS.map((e) => e.kind))
    for (const patch of many()) {
      for (const node of patch.nodes.filter((n) => n.type === 'fx')) {
        expect(built.has((node.params as FxParams).effect)).toBe(true)
      }
    }
  })

  it('keeps the tempo somewhere usable', () => {
    for (const patch of many()) {
      expect(patch.bpm).toBeGreaterThanOrEqual(70)
      expect(patch.bpm).toBeLessThanOrEqual(170)
    }
  })

  it('survives a round trip through the patch code', () => {
    // Anything it can build has to be shareable, or the dice would produce patches you cannot pass on.
    for (const patch of many(60)) {
      const decoded = decodePatch(encodePatch(patch))
      expect(decoded).not.toBeNull()
      expect(decoded!.nodes).toHaveLength(patch.nodes.length)
      expect(decoded!.edges).toHaveLength(patch.edges.length)
    }
  })

  it('gives a different patch each time', () => {
    const codes = new Set(many(80).map(encodePatch))
    expect(codes.size).toBeGreaterThan(70)
  })

  it('does not pile nodes on top of each other', () => {
    for (const patch of many(60)) {
      const spots = new Set(patch.nodes.map((n) => `${n.position.x},${n.position.y}`))
      expect(spots.size).toBe(patch.nodes.length)
    }
  })
})
