import { describe, expect, it } from 'vitest'
import { defaultFmParams, defaultOscParams } from '../nodes/registry'
import {
  MAX_FM_HZ,
  type FmParams,
  type Patch,
  type PatchEdge,
  type PatchNode,
} from '../types/patch'
import { AudioEngine, type NoteRequest } from './engine'
import { fakeAudio, type FakeAudio } from './fakeAudio'
import { amountFor, MAX_FM_CENTS, silentBecause, targetOf, targetsFrom } from './modulation'
import { diff, EMPTY_GRAPH, graphOf } from './router'

/**
 * One oscillator bending another's pitch, from the patch down to the parameter.
 *
 * Two claims carry the node and both fail quietly. **The index is the cable's**, so an FM node that
 * looked like every other modulator would be one whose control changes nothing until something else is
 * touched. And **the span is four octaves where Pitch's is a semitone** — a target resolved against the
 * wrong entry gives a vibrato where FM was asked for, forty-eight times too small, on a patch that plays
 * and looks right. That exact fault has already happened once here, to the comb.
 */

function osc(id: string): PatchNode {
  return { id, type: 'osc', position: { x: 0, y: 0 }, params: defaultOscParams() }
}

/** Deliberately unmerged: a patch node may carry only what was set, and the router completes it. */
function fm(id: string, params: Partial<FmParams> = {}): PatchNode {
  return { id, type: 'fm', position: { x: 0, y: 0 }, params }
}

const audio = (source: string, target: string): PatchEdge => ({
  id: `${source}>${target}`,
  kind: 'audio',
  source,
  target,
})

const mod = (source: string, target: string): PatchEdge => ({
  id: `${source}~${target}`,
  kind: 'mod',
  source,
  target,
})

function patchOf(nodes: PatchNode[], edges: PatchEdge[] = []): Patch {
  return { version: 1, bpm: 120, loop: true, nodes, edges }
}

describe('an FM node in the graph', () => {
  it('hears a branch without taking it off the master', () => {
    // A tap, like a follower's. A modulator you can also hear is a sound somebody may want, so Level is
    // what silences it rather than the cable.
    const graph = graphOf(patchOf([osc('m'), fm('f')], [audio('m', 'f')]))
    expect(graph.direct.get('m')).toBe(1)
    expect([...graph.taps]).toEqual(['m>f'])
    expect(graph.sends.size).toBe(0)
  })

  it('points at the carrier with no target of its own to choose', () => {
    // It has one destination and the cable is what says so, which is why it carries an index and no
    // target. The depth is that index as a share of the target's span.
    const graph = graphOf(patchOf([osc('c'), fm('f', { index: 2400 })], [mod('f', 'c')]))
    expect(graph.mods.get('f>c')).toEqual({ target: 'fm', depth: 2400 / MAX_FM_CENTS })
  })

  it('completes a node that carries nothing', () => {
    // The defaults are not neutral on purpose: an FM node at nought is wired at both ends and silent,
    // which from the canvas is indistinguishable from one that is broken.
    const graph = graphOf(patchOf([osc('c'), fm('f')], [mod('f', 'c')]))
    expect(graph.fms.get('f')?.index).toBe(defaultFmParams().index)
    expect(graph.mods.get('f>c')?.depth).toBeGreaterThan(0)
  })

  it('bends downward as readily as up', () => {
    const graph = graphOf(patchOf([osc('c'), fm('f', { index: -1200 })], [mod('f', 'c')]))
    expect(graph.mods.get('f>c')?.depth).toBeLessThan(0)
  })

  it('is built and taken down in an order that never leaves a dangling end', () => {
    const wired = graphOf(patchOf([osc('m'), osc('c'), fm('f')], [audio('m', 'f'), mod('f', 'c')]))
    const kinds = diff(EMPTY_GRAPH, wired).map((op) => op.op)
    expect(kinds).toContain('createFm')
    expect(kinds).toContain('tap')
    expect(kinds.indexOf('createFm')).toBeLessThan(kinds.indexOf('tap'))

    expect(diff(wired, EMPTY_GRAPH).map((op) => op.op)).toEqual([
      'disconnectMod',
      'untap',
      'disposeFm',
    ])
  })

  it('takes a change to its index as a rewiring and nothing else', () => {
    /*
     * The whole setting rides on the cable, so there is no update operation at all — the same rule a
     * MOD's depth follows. An `updateFm` would be an operation with nothing to do.
     */
    const before = graphOf(patchOf([osc('c'), fm('f', { index: 400 })], [mod('f', 'c')]))
    const after = graphOf(patchOf([osc('c'), fm('f', { index: 900 })], [mod('f', 'c')]))
    expect(diff(before, after).map((op) => op.op)).toEqual(['disconnectMod', 'connectMod'])
  })

  it('reaches four octaves where a vibrato reaches a semitone', () => {
    /*
     * The number that makes it FM rather than a wobble, and the one that would fail silently: `pitch`
     * and `fm` are the same parameter and differ only in span, so a target resolved against the wrong
     * entry is forty-eight times too small and nothing about it looks wrong.
     */
    const vibrato = targetOf('pitch', 'osc')!
    const index = targetOf('fm', 'osc')!
    expect(amountFor(index, 1)).toBe(MAX_FM_CENTS)
    expect(amountFor(index, 1) / amountFor(vibrato, 1)).toBe(48)
  })

  it('is offered to nothing but an FM node, in both modes', () => {
    // Sitting in a MOD's list beside Pitch, either of them would be a siren offered as a vibrato.
    const forMod = targetsFrom('mod', 'osc').map((one) => one.key)
    const forSense = targetsFrom('follow', 'osc').map((one) => one.key)
    const forFm = targetsFrom('fm', 'osc').map((one) => one.key)

    for (const list of [forMod, forSense]) {
      expect(list).not.toContain('fm')
      expect(list).not.toContain('fmHz')
    }
    // Two entries and one node: which of them a cable carries is the node's mode, decided in the router.
    expect(forFm).toEqual(['fm', 'fmHz'])
  })

  it('measures the linear mode in hertz, symmetrically', () => {
    /*
     * The whole reason the mode exists. Cents are a ratio, so a symmetric swing in cents is asymmetric in
     * hertz and its average is above where it started — the carrier sharpens as the index opens. Hertz
     * are hertz in both directions.
     */
    const linear = targetOf('fmHz', 'osc')!
    expect(amountFor(linear, 1)).toBe(MAX_FM_HZ)
    expect(amountFor(linear, -1)).toBe(-MAX_FM_HZ)
    expect(linear.min).toBe(-linear.max)
  })

  it('says so rather than going quiet on a noise carrier', () => {
    /*
     * A noise voice is a buffer being played: it has a detune and no frequency, so there is nothing for
     * hertz to be added to. Exponential works on every waveform, which is what makes this a mode worth
     * warning about rather than a mode worth removing.
     */
    expect(silentBecause('fmHz', { nodeType: 'osc', waveform: 'white' })).toContain('noise carrier')
    expect(silentBecause('fmHz', { nodeType: 'osc', waveform: 'sine' })).toBeNull()
    // And the exponential mode is fine with noise, which is the asymmetry the warning is about.
    expect(silentBecause('fm', { nodeType: 'osc', waveform: 'white' })).toBeNull()
  })
})

/** One note on the carrier, so a per-voice target has a voice to reach. */
function sounding(): NoteRequest {
  return {
    nodeId: 'c',
    time: 1,
    freq: 440,
    waveform: 'sine',
    pulseWidth: 0.5,
    duration: 1,
    gain: 0.5,
    attack: 5,
    decay: 0,
    release: 50,
    glide: 0,
    velocity: 1,
    filterType: 'off',
    cutoff: 1000,
    resonance: 2,
  }
}

describe('an FM node in the engine', () => {
  /** An engine with one FM node built, plus the two gains it builds, in order. */
  function built() {
    const fake: FakeAudio = fakeAudio()
    const engine = new AudioEngine()
    engine.adopt(fake.ctx)
    const already = fake.nodes('gain').length
    engine.createFmNode('f')
    return {
      fake,
      engine,
      input: fake.nodes('gain')[already] as { incoming: unknown[] },
      depth: fake.nodes('gain')[already + 1] as { incoming: unknown[] },
    }
  }

  it('puts nothing between what it hears and what it moves', () => {
    /*
     * The whole difference from a follower, which puts a processor there. Passing the waveform through
     * unchanged is what makes this frequency modulation rather than a control signal — anything in the
     * middle that rectified or smoothed it would turn it back into a follower.
     */
    const { input, depth } = built()
    expect(depth.incoming).toEqual([input])
  })

  it('takes the branch into its input and lets go of it again', () => {
    const { engine, input } = built()
    engine.connectTap('m', 'f')
    expect(input.incoming).toHaveLength(1)
    engine.disconnectTap('m', 'f')
    expect(input.incoming).toHaveLength(0)
  })

  it('drives the carrier’s detune, at the span the target names', () => {
    /*
     * Per voice, because an oscillator's detune is built per note — the same path a vibrato takes. What
     * is checked here is the amount: a full-depth index must set four octaves of cents on the way to the
     * parameter, and a target resolved against `pitch` instead would set a hundred.
     */
    const { fake, engine, depth } = built()
    engine.connectMod('f', 'c', 'fm', 1)
    const amount = fake.nodes('gain').at(-1) as { incoming: unknown[]; gain: { value: number } }
    expect(amount.gain.value).toBe(MAX_FM_CENTS)
    // Fed from the node's own signal, which for an FM node is the tap itself.
    expect(amount.incoming).toEqual(depth.incoming)
  })

  it('reaches the detune of a note that is already sounding', () => {
    /*
     * The per-voice half, and the one the checks above cannot see: the amount gain is built when the
     * cable is drawn, but it only reaches anything when a voice is there to reach. `pitch` and `fm` are
     * the same parameter, and a lookup that knew about one and not the other would build the whole chain
     * and connect it to nothing — silent, with every other assertion still passing.
     */
    const { fake, engine } = built()
    engine.playNote(sounding())

    const before = fake.drivers('detune').length
    engine.connectMod('f', 'c', 'fm', 1)
    const amount = fake.nodes('gain').at(-1)
    expect(fake.drivers('detune').length).toBe(before + 1)
    expect(fake.drivers('detune')).toContain(amount)
  })

  it('drives the frequency in the linear mode, and not the detune', () => {
    /*
     * The whole of the mode, at the level where it could fail silently. Both targets are per-voice, both
     * build the same chain, and both look identical from every angle except which parameter the last
     * gain is connected to — so a lookup that answered `detune` for `fmHz` would be exponential FM
     * wearing a label that says linear, at a hundred and forty *cents* instead of hertz.
     */
    const { fake, engine } = built()
    engine.playNote(sounding())

    const detunes = fake.drivers('detune').length
    engine.connectMod('f', 'c', 'fmHz', 1)
    const amount = fake.nodes('gain').at(-1)

    /*
     * `oscFrequency` rather than `frequency`, which is the stub's own name for it: a biquad has a
     * `frequency` too, and naming them apart is what keeps a filter sweep from reading as a pitch one.
     */
    expect(fake.drivers('oscFrequency')).toContain(amount)
    expect(fake.drivers('detune').length, 'the linear mode reached the detune').toBe(detunes)
    // And at the linear span, which is a different number from the exponential one on purpose.
    expect((amount as { gain: { value: number } }).gain.value).toBe(MAX_FM_HZ)
  })

  it('connects nothing at all on a noise carrier', () => {
    /*
     * A noise voice is a buffer being played: it has a detune and no frequency. There is nothing to add
     * hertz to, so the chain is built and reaches no parameter — which is why the panel says so before a
     * cable is drawn. What matters here is that it does not instead land on something else.
     */
    const { fake, engine } = built()
    engine.playNote({ ...sounding(), waveform: 'white' })

    const before = fake.drivers('detune').length
    engine.connectMod('f', 'c', 'fmHz', 1)
    expect(fake.drivers('oscFrequency')).toHaveLength(0)
    expect(fake.drivers('detune').length, 'linear FM fell back to the detune').toBe(before)
  })

  it('lets go of everything when it is disposed', () => {
    const { fake, engine } = built()
    engine.connectMod('f', 'c', 'fm', 1)
    const wired = fake.nodes('gain').length
    expect(() => engine.disposeModulator('f')).not.toThrow()
    // And it is gone: a second dispose finds nothing rather than throwing.
    expect(() => engine.disposeModulator('f')).not.toThrow()
    expect(fake.nodes('gain').length).toBe(wired)
  })
})
