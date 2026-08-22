import { describe, expect, it } from 'vitest'
import { AudioEngine, type NoteRequest } from './engine'
import { fakeAudio } from './fakeAudio'
import { estimatePeakLoad } from './load'
import { MOD_COST, targetsFor } from './modulation'
import type { FxParams, ModParams, Patch, PatchNode } from '../types/patch'

/**
 * What a modulation cable costs the thing it is pointed at (PLAN §11.10).
 *
 * The measurement said something simple: **automating a gain is free and automating a filter is not.**
 * A `GainNode` reading a per-sample value instead of a constant costs nothing worth counting; a biquad
 * has to recompute its coefficients per sample rather than per block, which roughly triples it. So the
 * price is a property of the destination, not of the modulator, and that is what these check.
 */

const LFO: ModParams = { kind: 'lfo', wave: 'sine', rate: 2, depth: 0.6 }

function node(id: string, type: string, params: object): PatchNode {
  return { id, type, position: { x: 0, y: 0 }, params } as PatchNode
}

/** An Ignite, an oscillator under it, and optionally a MOD pointed somewhere. */
function patchWith(target?: string, destination?: PatchNode): Patch {
  const osc = node('o', 'osc', {
    waveform: 'square',
    filterType: 'lowpass',
    division: '1/8',
    gate: 0.6,
    release: 40,
    steps: [],
  })
  const nodes: PatchNode[] = [node('s', 'start', {}), osc]
  const edges = [{ id: 'e0', source: 's', target: 'o', kind: 'event' as const }]

  if (destination) nodes.push(destination)
  if (target) {
    nodes.push(node('m', 'mod', { ...LFO, target }))
    edges.push({
      id: 'e1',
      source: 'm',
      target: destination?.id ?? 'o',
      kind: 'mod' as never,
    })
  }
  return { version: 1, bpm: 120, loop: true, nodes, edges }
}

const fx = (effect: string): PatchNode =>
  node('f', 'fx', { effect, mix: 0.8, cutoff: 2000, resonance: 4, decay: 2.5 })

describe('the price of a sweep, in a patch estimate', () => {
  it('charges nothing for sweeping a level beyond the modulator itself', () => {
    // The common case by a wide margin, and free: a gain costs the same reading a signal as a constant.
    // Measured against a patch with no MOD in it at all, so what is pinned is that the *cable* adds
    // nothing — the modulator is still paid for, since it runs whether it is wired or not.
    const cable = estimatePeakLoad(patchWith('level')) - estimatePeakLoad(patchWith())
    expect(cable).toBeCloseTo(MOD_COST, 5)
  })

  it("charges for sweeping an oscillator's filter, once per voice in the air", () => {
    const swept = estimatePeakLoad(patchWith('cutoff'))
    const still = estimatePeakLoad(patchWith('level'))
    const surcharge = targetsFor('osc').find((target) => target.key === 'cutoff')?.surcharge ?? 0

    /*
     * Read from the table rather than pinned as a number.
     *
     * This used to assert that the difference beat a point, which is a claim about the surcharge's size
     * wearing the clothes of one about its shape. It held only while sweeping a cutoff happened to cost
     * 2, and it stopped holding when a sweep against a real dropout found 248 modulated cutoffs failing
     * at the same load as 240 unmodulated ones and brought the figure to half a point.
     */
    expect(surcharge).toBeGreaterThan(0)
    // One voice in the air here, so one surcharge. Per voice rather than per cable is the claim, and what
    // carries it is the multiplier being the voice count — which the effect case below does not have.
    expect(swept - still).toBeCloseTo(surcharge, 5)
  })

  it("charges for sweeping an effect's cutoff", () => {
    const swept = estimatePeakLoad(patchWith('cutoff', fx('filter')))
    const still = estimatePeakLoad(patchWith('level', fx('filter')))
    expect(swept).toBeGreaterThan(still)
  })

  it('charges nothing where a cutoff is not behind a filter of its own', () => {
    // A ring modulator's Freq is its carrier — an oscillator, free to automate. A phaser's stages are
    // already swept by its own LFO, so a second signal into them adds nothing.
    for (const effect of ['ring', 'phaser'] as const) {
      const swept = estimatePeakLoad(patchWith('cutoff', fx(effect)))
      const still = estimatePeakLoad(patchWith('level', fx(effect)))
      expect(swept).toBeCloseTo(still, 5)
    }
  })

  it('charges heavily for sweeping a reverb tail, which rebuilds a buffer', () => {
    // The one that measured at more than the whole budget before it was slowed down.
    const swept = estimatePeakLoad(patchWith('decay', fx('reverb')))
    const still = estimatePeakLoad(patchWith('level', fx('reverb')))
    expect(swept - still).toBeGreaterThan(10)
  })

  it('prices what a MOD will really be modulating, not what it says', () => {
    // A MOD set to a target its destination does not offer falls back to the level, and the price has
    // to follow the fallback rather than the stale name.
    const stale = estimatePeakLoad(patchWith('decay', fx('chorus')))
    const level = estimatePeakLoad(patchWith('level', fx('chorus')))
    expect(stale).toBeCloseTo(level, 5)
  })
})

describe('the price of a sweep, in the live meter', () => {
  const note = (over: Partial<NoteRequest> = {}): NoteRequest => ({
    nodeId: 'osc',
    time: 0,
    freq: 440,
    waveform: 'square',
    pulseWidth: 0.5,
    duration: 1,
    gain: 0.5,
    attack: 5,
    decay: 0,
    release: 20,
    filterType: 'lowpass',
    cutoff: 1200,
    resonance: 4,
    ...over,
  })

  function engineOn(): { engine: AudioEngine } {
    const engine = new AudioEngine()
    engine.adopt(fakeAudio().ctx)
    return { engine }
  }

  it("adds to an effect's standing cost when its filter is swept", () => {
    const { engine } = engineOn()
    engine.createEffect('fx', { effect: 'filter', mix: 0.8, cutoff: 2000 } as FxParams, 120)
    engine.createModulator('mod', LFO)
    const before = engine.effectLoad()

    engine.connectMod('mod', 'fx', 'cutoff', 0.6)
    expect(engine.effectLoad()).toBeGreaterThan(before)

    engine.disconnectMod('mod', 'fx')
    expect(engine.effectLoad()).toBeCloseTo(before, 5)
  })

  it('adds nothing when only a level is swept', () => {
    const { engine } = engineOn()
    engine.createEffect('fx', { effect: 'filter', mix: 0.8, cutoff: 2000 } as FxParams, 120)
    engine.createModulator('mod', LFO)
    const before = engine.effectLoad()

    engine.connectMod('mod', 'fx', 'level', 0.6)
    expect(engine.effectLoad()).toBeCloseTo(before, 5)
  })

  it('makes a voice cost more when its own filter is swept', () => {
    const { engine } = engineOn()
    engine.createModulator('mod', LFO)
    engine.playNote(note())
    const plain = engine.voiceLoadAt(0.5)

    const second = engineOn().engine
    second.createModulator('mod', LFO)
    second.connectMod('mod', 'osc', 'cutoff', 0.6)
    second.playNote(note())

    expect(second.voiceLoadAt(0.5)).toBeGreaterThan(plain)
  })

  it('charges a voice nothing when there is no filter to sweep', () => {
    // The cable is there and does nothing, which the panel already says. It should not be billed for.
    const { engine } = engineOn()
    engine.createModulator('mod', LFO)
    engine.playNote(note({ filterType: 'off' }))
    const plain = engine.voiceLoadAt(0.5)

    const second = engineOn().engine
    second.createModulator('mod', LFO)
    second.connectMod('mod', 'osc', 'cutoff', 0.6)
    second.playNote(note({ filterType: 'off' }))

    expect(second.voiceLoadAt(0.5)).toBeCloseTo(plain, 5)
  })

  it('gives a per-voice charge back when the cable goes', () => {
    const { engine } = engineOn()
    engine.createModulator('mod', LFO)
    engine.connectMod('mod', 'osc', 'cutoff', 0.6)
    engine.disconnectMod('mod', 'osc')
    engine.playNote(note())

    const bare = engineOn().engine
    bare.playNote(note())
    expect(engine.voiceLoadAt(0.5)).toBeCloseTo(bare.voiceLoadAt(0.5), 5)
  })
})

describe('every target carries a price', () => {
  it('names one for each of them, so a new parameter cannot arrive unpriced', () => {
    for (const nodeType of ['osc', 'fx'] as const) {
      for (const effect of ['reverb', 'echo', 'filter', 'chorus', 'crush'] as const) {
        for (const target of targetsFor(nodeType, effect)) {
          expect(typeof target.surcharge).toBe('number')
          expect(target.surcharge).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })
})

describe('how often an expensive rebuild is allowed', () => {
  /** How many times a parameter actually moved over a second of stepping at twenty a second. */
  function rebuilds(effect: string, target: string, params: object): number {
    const fake = fakeAudio()
    const engine = new AudioEngine()
    engine.adopt(fake.ctx)
    engine.createEffect('fx', { effect, mix: 0.8, ...params } as FxParams, 120)
    engine.createModulator('mod', LFO)
    engine.connectMod('mod', 'fx', target, 0.9)

    let moved = 0
    for (let i = 0; i < 20; i++) {
      const before = fake.journal.length
      fake.advance(0.05)
      engine.advanceValueModulation()
      if (fake.journal.length > before) moved++
    }
    engine.dispose()
    return moved
  }

  it('rebuilds a reverb tail four times a second, not twenty', () => {
    // An impulse response is two channels of up to ten seconds. Rebuilding it every turn of the driver
    // measured at more than the entire budget — one parameter costing more than a hundred voices. Four
    // a second is ample for a gesture nobody sweeps quickly.
    const moved = rebuilds('reverb', 'decay', { decay: 2.5, cutoff: 4000 })
    expect(moved).toBeGreaterThan(1)
    expect(moved).toBeLessThanOrEqual(5)
  })

  it('leaves the cheap rebuilds alone, since a curve is not a buffer', () => {
    // A bitcrusher rebuilds a few hundred floats. Slowing that down would buy nothing and cost the
    // smoothness of the sweep.
    const moved = rebuilds('crush', 'bits', { bits: 8, cutoff: 4000 })
    expect(moved).toBeGreaterThan(10)
  })
})
