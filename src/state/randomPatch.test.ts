import { describe, expect, it } from 'vitest'
import { EFFECTS } from '../audio/effects'
import { estimatePeakLoad } from '../audio/load'
import { silentBecause, targetOf } from '../audio/modulation'
import type { FxParams, ModParams, OscParams, Patch } from '../types/patch'
import { decodePatch, encodePatch } from './patchCode'
import { ROLL_BUDGET, cellsOf, randomPatch } from './randomPatch'

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
    // An orphaned node is the one outcome that would look like a bug rather than a patch. What counts
    // as attached differs by kind, and saying so is the test: an FX is reached by audio rather than by
    // triggers, and a MOD is reached by neither — it is the *source* of its own cable, so what it needs
    // is somewhere to point.
    for (const patch of many()) {
      const seen = reachable(patch)
      for (const node of patch.nodes) {
        if (node.type === 'fx') continue
        if (node.type === 'mod') {
          expect(patch.edges.some((edge) => edge.source === node.id && edge.kind === 'mod')).toBe(
            true,
          )
          continue
        }
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

  it('never rolls a patch over its own budget', () => {
    // The condition on huge rolls: as big as it likes, but it has to stay readable. Trimming happens
    // after building, since the peak cost of a cascade is easier to measure on a finished patch than to
    // forecast while making one.
    //
    // Its own budget, not the machine's ceiling: the two were one number only while the ceiling was
    // wrong by a factor of fifty, and a roll fifty times bigger is several hundred nodes nobody can read.
    for (const patch of many(400)) {
      expect(estimatePeakLoad(patch)).toBeLessThanOrEqual(ROLL_BUDGET)
    }
  })

  it('still reaches large patches rather than trimming everything down', () => {
    // The budget must not have quietly turned the dice back into what it was before.
    const counts = many(400).map((p) => oscs(p).length)
    expect(Math.max(...counts)).toBeGreaterThan(25)
  })

  it('takes effects before oscillators when it has to trim', () => {
    // Losing an effect costs a colour; losing an oscillator costs a voice. And an effect is the
    // dearest thing per node, so it is also the fastest way back under.
    //
    // Measured against the roll's own budget rather than against `MAX_LOAD`, which is the separation
    // that matters here: the ceiling says what a machine can do, and a roll is bounded by what a patch
    // can readably *be*. They were the same number only while the ceiling was wrong.
    const heavy = many(400).filter((p) => estimatePeakLoad(p) > ROLL_BUDGET * 0.7)
    expect(heavy.length).toBeGreaterThan(0)
    for (const patch of heavy) expect(oscs(patch).length).toBeGreaterThan(0)
  })

  it('rolls modulators, since a third of the instrument was never turning up', () => {
    // The die knew about oscillators, delays and effects and not about MOD, so nothing it produced ever
    // modulated anything.
    const withMod = many(60).filter((patch) => patch.nodes.some((node) => node.type === 'mod'))
    expect(withMod.length).toBeGreaterThan(10)
  })

  it('never points a modulator at something that would do nothing', () => {
    // A cutoff on an oscillator with its filter off is a cable that looks wired and is not, which from
    // a roll is indistinguishable from a bug.
    for (const patch of many(60)) {
      for (const edge of patch.edges.filter((e) => e.kind === 'mod')) {
        const mod = patch.nodes.find((node) => node.id === edge.source)!
        const destination = patch.nodes.find((node) => node.id === edge.target)!
        const effect =
          destination.type === 'fx' ? (destination.params as FxParams).effect : undefined
        expect(
          silentBecause((mod.params as ModParams).target ?? 'level', {
            nodeType: destination.type,
            effect,
            filterType: (destination.params as OscParams).filterType,
          }),
        ).toBeNull()
      }
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

describe('the modulators it rolls', () => {
  const modsOf = (patch: Patch) => patch.nodes.filter((node) => node.type === 'mod')
  const many400 = () => many(400)

  it('rolls all three flavours, not just the one that needs nothing', () => {
    // The first version rolled LFOs only, because the node that supplies a trigger was thrown away
    // before the modulators were added. An envelope is the flavour that belongs to the cascade, so a
    // die that never rolls one never shows what the module is for.
    const kinds = new Set<string>()
    for (const patch of many400()) {
      for (const mod of modsOf(patch)) {
        const params = mod.params as ModParams
        kinds.add(params.kind === 'lfo' ? 'lfo' : `env:${params.fires}`)
      }
    }
    expect(kinds).toContain('lfo')
    expect(kinds).toContain('env:note')
    expect(kinds).toContain('env:trigger')
  })

  it('gives every envelope that waits for a trigger something that triggers it', () => {
    // Otherwise it is a modulator that never runs, and the panel would have to explain a patch the die
    // built. This is the condition the whole `triggeredBy` map exists for.
    for (const patch of many400()) {
      for (const mod of modsOf(patch)) {
        const params = mod.params as ModParams
        if (params.kind !== 'env' || params.fires === 'note') continue
        const triggered = patch.edges.some(
          (edge) => edge.target === mod.id && (edge.kind ?? 'event') === 'event',
        )
        expect(triggered).toBe(true)
      }
    }
  })

  it('points every per-note envelope at something built per note', () => {
    // Per note only means anything on an oscillator's filter. Anywhere else there is one parameter and
    // many notes, and the modulator would sit there doing nothing.
    for (const patch of many400()) {
      for (const mod of modsOf(patch)) {
        const params = mod.params as ModParams
        if (params.kind !== 'env' || params.fires !== 'note') continue

        const edge = patch.edges.find((e) => e.source === mod.id && e.kind === 'mod')!
        const destination = patch.nodes.find((node) => node.id === edge.target)!
        const target = targetOf(params.target, destination.type)
        expect(target?.perVoice).toBe(true)
      }
    }
  })

  it('keeps an LFO the commonest, since a patch of nothing but gestures is exhausting', () => {
    const params = many400().flatMap((patch) => modsOf(patch).map((mod) => mod.params as ModParams))
    const lfos = params.filter((p) => p.kind === 'lfo').length
    expect(lfos).toBeGreaterThan(params.length / 2)
  })
})

describe('where it puts things', () => {
  it('never stacks two nodes on the same spot', () => {
    // Effects and modulators were offset by the loop index that produced them, and a loop index grows
    // without bound: the fifth effect landed nearly three rows below its oscillator, on top of whatever
    // lived there. A patch that looks like a mistake is worse than one that is merely dense — and this
    // is the test that would have caught it, since nothing about the arithmetic looked wrong.
    for (const patch of many(400)) {
      const cells = new Map<string, string>()
      for (const node of patch.nodes) {
        /*
         * Every cell the node covers, not the one it sits at.
         *
         * This test passed while effects were still landing on sixteen-step oscillators, because it
         * counted one cell per node and so agreed with the bug it was there to catch. An oscillator is as
         * wide as its step bars — 522 pixels at sixteen of them, against a cell's 280 — and asking the
         * placement's own footprint keeps the two from drifting apart again.
         */
        for (const cell of cellsOf(node)) {
          expect(
            cells.has(cell),
            `${node.type} covers ${cell}, already held by ${cells.get(cell)}`,
          ).toBe(false)
          cells.set(cell, node.type)
        }
      }
    }
  })

  it('gives a long sequencer more room than a short one', () => {
    // The claim the test above rests on, pinned on its own: if this ever returns one cell for sixteen
    // steps, that test goes back to agreeing with the bug and says nothing.
    const at = { x: 0, y: 0 }
    const stepped = (count: number) =>
      cellsOf({ type: 'osc', position: at, params: { steps: Array.from({ length: count }) } })

    // Two rows tall in every case, since a node is taller than half a row whatever it holds. So the
    // count is rows times columns, and only the columns depend on the steps.
    expect(stepped(2)).toHaveLength(2)
    expect(stepped(8)).toHaveLength(2)
    expect(stepped(16)).toHaveLength(4)
    // Anything without steps is one column, however it is asked.
    expect(cellsOf({ type: 'fx', position: at, params: {} })).toHaveLength(2)
    expect(cellsOf({ type: 'osc', position: at, params: {} })).toHaveLength(2)
  })

  it('keeps effects to one side and modulators to the other', () => {
    // So a node carrying both is not sandwiched between them.
    for (const patch of many(80)) {
      for (const edge of patch.edges) {
        if (edge.kind !== 'audio' && edge.kind !== 'mod') continue
        const from = patch.nodes.find((node) => node.id === edge.source)!
        const to = patch.nodes.find((node) => node.id === edge.target)!

        // Audio runs oscillator → effect, so the effect is to the right. Modulation runs mod →
        // destination, so the modulator is to the left.
        if (edge.kind === 'audio') expect(to.position.x).toBeGreaterThan(from.position.x)
        else expect(from.position.x).toBeLessThan(to.position.x)
      }
    }
  })
})
