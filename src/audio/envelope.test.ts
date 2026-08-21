import { describe, expect, it } from 'vitest'
import { AudioEngine } from './engine'
import { fakeAudio, type FakeAudio } from './fakeAudio'
import { getDefinition } from '../nodes/registry'
import { encodePatch, decodePatch } from '../state/patchCode'
import { connectionFor, EVENT_IN, EVENT_OUT, SIGNAL_LEFT } from '../state/connections'
import type { ModParams, Patch, PatchNode } from '../types/patch'
import { ActivityBus } from '../viz/activity'

/**
 * The envelope modulator: a MOD that runs once when the cascade triggers it (PLAN §18.7).
 *
 * The point of it is not the shape but the **clock**. An LFO keeps its own rate and is indifferent to
 * the music; an envelope runs when a trigger reaches it, so the modulation becomes part of the
 * structure of the piece. That is why the trigger is a cable rather than an inferred relationship —
 * and why the wiring alone gives three behaviours with no modes: under an Ignite it runs once per pass,
 * under a deep node it runs when that branch lights up, behind a Delay it runs late.
 */

const ENV: ModParams = { kind: 'env', target: 'level', depth: 0.6, attack: 40, decay: 600 }
const LFO: ModParams = { kind: 'lfo', target: 'level', depth: 0.6, rate: 2, wave: 'sine' }

function modNode(params: ModParams): PatchNode {
  return { id: 'm', type: 'mod', position: { x: 0, y: 0 }, params }
}

/** A scheduler-shaped call into the node definition, recording what it asked the engine for. */
function scheduleMod(params: ModParams) {
  const fired: Array<{ nodeId: string; at: number }> = []
  const engine = {
    fireEnvelope: (nodeId: string, at: number) => fired.push({ nodeId, at }),
  } as never
  const activity = new ActivityBus(() => 0)
  const result = getDefinition('mod')!.schedule!({
    node: modNode(params),
    time: 4,
    bpm: 120,
    engine,
    activity,
  })
  return { fired, result }
}

describe('a MOD in the cascade', () => {
  it('runs its envelope when a trigger reaches it', () => {
    const { fired } = scheduleMod(ENV)
    // At the absolute time the trigger arrives, like everything else the scheduler does.
    expect(fired).toEqual([{ nodeId: 'm', at: 4 }])
  })

  it('ignores the trigger when it is an LFO, which keeps its own clock', () => {
    expect(scheduleMod(LFO).fired).toEqual([])
  })

  it('passes the trigger on, whichever kind it is', () => {
    // A MOD in the middle of a chain has to be transparent. Without this, wiring one there would
    // silence everything below it and nothing on screen would say why.
    for (const params of [ENV, LFO]) {
      const { result } = scheduleMod(params)
      expect(result.outgoing).toEqual([4])
      expect(result.endTime).toBe(4)
    }
  })

  it('takes no time of its own, so it cannot stretch a cascade', () => {
    // Unlike a Delay, which is the other node that only forwards: this one forwards immediately.
    expect(scheduleMod(ENV).result.endTime).toBe(4)
  })
})

describe('the engine side', () => {
  function envelopeEngine(): { fake: FakeAudio; engine: AudioEngine } {
    const fake = fakeAudio()
    const engine = new AudioEngine()
    engine.adopt(fake.ctx)
    engine.createModulator('m', ENV)
    return { fake, engine }
  }

  it('builds a constant rather than an oscillator', () => {
    const { fake } = envelopeEngine()
    // An envelope has no cycle of its own: a constant 1 through a gain the cascade draws the shape on.
    expect(fake.nodes('constant')).toHaveLength(1)
    expect(fake.nodes('osc')).toHaveLength(0)
  })

  it('starts silent, so it never steps a parameter before it runs', () => {
    // Found by identity rather than by value: the depth gain also sits at zero, so looking for "a gain
    // at zero" passes whatever the shape is doing. Which is how this test was caught being vacuous.
    const { fake } = envelopeEngine()
    const [constant] = fake.nodes('constant')
    const shape = fake
      .nodes('gain')
      .find((candidate) => (candidate.incoming as unknown[]).includes(constant))

    expect(shape).toBeDefined()
    expect((shape!.gain as { value: number }).value).toBe(0)
  })

  it('opens and closes when fired', () => {
    const { fake, engine } = envelopeEngine()
    const before = fake.journal.length
    engine.fireEnvelope('m', 1)

    // Two ramps: up to the peak, then back to nothing.
    const written = fake.journal.slice(before)
    expect(written.map((w) => w.value)).toEqual([1, 0])
  })

  it('does nothing when asked to fire an LFO', () => {
    const fake = fakeAudio()
    const engine = new AudioEngine()
    engine.adopt(fake.ctx)
    engine.createModulator('m', LFO)

    const before = fake.journal.length
    engine.fireEnvelope('m', 1)
    expect(fake.journal.length).toBe(before)
  })

  it('reaches a parameter through the same path an LFO uses', () => {
    // The whole reason the envelope is a *signal* rather than a schedule of values: everything
    // downstream — the depth gain, the per-voice links, the inverter on a mix — is unchanged.
    const { fake, engine } = envelopeEngine()
    const before = fake.wires()
    engine.connectMod('m', 'osc', 'level', 0.6)
    expect(fake.wires()).toBeGreaterThan(before)
  })

  it("reaches an oscillator's per-voice filter too", () => {
    const { fake, engine } = envelopeEngine()
    engine.connectMod('m', 'osc', 'cutoff', 0.6)
    engine.playNote({
      nodeId: 'osc',
      time: 0,
      freq: 440,
      waveform: 'square',
      pulseWidth: 0.5,
      duration: 1,
      gain: 0.5,
      attack: 5,
      release: 20,
      filterType: 'lowpass',
      cutoff: 1200,
      resonance: 4,
    })
    expect(fake.drivers('frequency')).toHaveLength(1)
  })

  it('stops its constant when disposed, not just the gain in front of it', () => {
    const { fake, engine } = envelopeEngine()
    engine.disposeModulator('m')
    // The constant is what was started, so it is what has to be stopped. Stopping the shape would
    // stop nothing and leave a source running for the rest of the session.
    const constant = fake.nodes('constant')[0] as { stopped: boolean }
    expect(constant.stopped).toBe(true)
    expect(engine.effectLoad()).toBe(0)
  })
})

describe('wiring', () => {
  const rules = () => ({
    nodes: [
      { id: 's', type: 'start' },
      { id: 'm', type: 'mod' },
      { id: 'f', type: 'fx' },
    ],
    edges: [],
  })

  it('takes a trigger into its top port', () => {
    const decided = connectionFor(rules(), {
      source: 's',
      target: 'm',
      sourceHandle: EVENT_OUT,
      targetHandle: EVENT_IN,
    })
    expect(decided?.kind).toBe('event')
  })

  it('still sends modulation out of its side', () => {
    const decided = connectionFor(rules(), {
      source: 'm',
      target: 'f',
      sourceHandle: SIGNAL_LEFT,
      targetHandle: SIGNAL_LEFT,
    })
    expect(decided?.kind).toBe('mod')
  })
})

describe('the patch code', () => {
  it('carries an envelope and its times there and back', () => {
    const patch: Patch = {
      version: 1,
      bpm: 120,
      loop: true,
      nodes: [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
        modNode({ ...ENV, attack: 250, decay: 3000 }),
      ],
      edges: [{ id: 'e', source: 's', target: 'm', kind: 'event' }],
    }
    const back = decodePatch(encodePatch(patch))
    const params = back?.nodes.find((n) => n.type === 'mod')?.params as ModParams
    expect(params.kind).toBe('env')
    expect(params.attack).toBe(250)
    expect(params.decay).toBe(3000)
  })

  it('keeps an LFO an LFO', () => {
    const patch: Patch = {
      version: 1,
      bpm: 120,
      loop: true,
      nodes: [modNode(LFO)],
      edges: [],
    }
    const back = decodePatch(encodePatch(patch))!
    expect((back.nodes[0].params as ModParams).kind).toBe('lfo')
  })

  it('carries the trigger cable into a MOD, handles and all', () => {
    const patch: Patch = {
      version: 1,
      bpm: 120,
      loop: true,
      nodes: [{ id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }, modNode(ENV)],
      edges: [{ id: 'e', source: 's', target: 'm', kind: 'event' }],
    }
    const back = decodePatch(encodePatch(patch))!
    expect(back.edges).toHaveLength(1)
    expect(back.edges[0].kind).toBe('event')
    // Ids are positional after decoding, so the cable is checked by what it lands on.
    const landedOn = back.nodes.find((n) => n.id === back.edges[0].target)
    expect(landedOn?.type).toBe('mod')
  })
})
