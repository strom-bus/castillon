import { describe, expect, it } from 'vitest'
import { defaultFxParams, defaultOscParams, defaultSenseParams } from '../nodes/registry'
import type { Patch, PatchEdge, PatchNode, SenseParams } from '../types/patch'
import { AudioEngine } from './engine'
import { fakeAudio, type FakeAudio } from './fakeAudio'
import { amountFor, targetsFor, targetsFrom } from './modulation'
import { diff, EMPTY_GRAPH, graphOf } from './router'

/**
 * The follower, from the patch down to the parameter.
 *
 * Two claims are worth this much care, because both fail quietly. **A tap is not a send:** feeding a
 * SENSE must leave the branch exactly as loud as it was, where feeding an effect takes the oscillator
 * off the master — get that wrong and every patch with a follower in it loses the sound it is listening
 * to. And **a follower reaches only what takes a connection:** its level lives on the audio thread, so a
 * target that is rebuilt from a timer would be a cable drawn, lit, and doing nothing at all.
 */

function osc(id: string): PatchNode {
  return { id, type: 'osc', position: { x: 0, y: 0 }, params: defaultOscParams() }
}

function fx(id: string, effect = 'reverb'): PatchNode {
  return {
    id,
    type: 'fx',
    position: { x: 0, y: 0 },
    params: { ...defaultFxParams(), effect } as PatchNode['params'],
  }
}

/**
 * Deliberately **not** merged over the defaults: a patch node may carry only what was set, and the
 * router is the place that completes it. A helper that filled in the gaps here would hide that.
 */
function sense(id: string, params: Partial<SenseParams> = {}): PatchNode {
  return { id, type: 'sense', position: { x: 0, y: 0 }, params }
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

describe('a follower in the graph', () => {
  it('hears a branch without taking it off the master', () => {
    // The claim that would fail silently the other way: an oscillator feeding an effect is heard
    // through it, and one feeding a follower is heard exactly as it was.
    const graph = graphOf(patchOf([osc('a'), sense('s')], [audio('a', 's')]))
    expect(graph.direct.get('a')).toBe(1)
    expect([...graph.taps]).toEqual(['a>s'])
    expect(graph.sends.size).toBe(0)
  })

  it('is fed by an effect as readily as by an oscillator', () => {
    // Listening to the end of a chain is a different sound from listening to what went into it.
    const graph = graphOf(
      patchOf([osc('a'), fx('f'), sense('s')], [audio('a', 'f'), audio('f', 's')]),
    )
    expect([...graph.taps]).toEqual(['f>s'])
    // And the effect is still the end of its chain: a tap is not a link in one.
    expect(graph.terminals.get('f')).toBe(true)
  })

  it('carries its own settings, merged over the defaults', () => {
    const graph = graphOf(patchOf([sense('s', { attack: 12 })]))
    const params = graph.followers.get('s')
    expect(params?.attack).toBe(12)
    // The one that matters: a follower's resting depth is *negative*, so an absent key must not fall
    // back to a modulator's generic 0.6 — that would turn a duck into a swell.
    expect(params?.depth).toBeLessThan(0)
  })

  it('points at a parameter the same way a modulator does', () => {
    const graph = graphOf(
      patchOf([osc('a'), sense('s', { target: 'level', depth: -0.4 })], [mod('s', 'a')]),
    )
    expect(graph.mods.get('s>a')).toEqual({ target: 'level', depth: -0.4 })
  })

  it('cannot be pointed at a parameter that is rebuilt rather than connected', () => {
    /*
     * A reverb's decay is `via: 'value'` — driven from a timer that computes the modulator's phase, and
     * a follower has none. So it falls back to level rather than resolving to a cable that would be
     * drawn, lit and inert.
     */
    const graph = graphOf(
      patchOf([fx('r', 'reverb'), sense('s', { target: 'decay' })], [mod('s', 'r')]),
    )
    expect(graph.mods.get('s>r')?.target).toBe('level')

    // And a MOD, which can drive one, keeps it — so this is the follower's limit and not the table's.
    const modulator: PatchNode = {
      id: 'm',
      type: 'mod',
      position: { x: 0, y: 0 },
      params: { kind: 'lfo', target: 'decay', depth: 0.5 },
    }
    const other = graphOf(patchOf([fx('r', 'reverb'), modulator], [mod('m', 'r')]))
    expect(other.mods.get('m>r')?.target).toBe('decay')
  })

  it('is built, tapped and taken down in an order that never leaves a dangling end', () => {
    const before = EMPTY_GRAPH
    const wired = graphOf(patchOf([osc('a'), sense('s')], [audio('a', 's'), mod('s', 'a')]))
    const ops = diff(before, wired)
    const kinds = ops.map((op) => op.op)
    expect(kinds).toContain('createFollow')
    expect(kinds).toContain('tap')
    // Built before it is fed, as with every other node the router creates.
    expect(kinds.indexOf('createFollow')).toBeLessThan(kinds.indexOf('tap'))

    const gone = diff(wired, EMPTY_GRAPH).map((op) => op.op)
    expect(gone).toEqual(['disconnectMod', 'untap', 'disposeFollow'])
  })

  it('takes a time change as an update and a depth change as a rewiring', () => {
    // The same division a MOD has, and for the same reason: depth is scaled to the target, so it is
    // carried by the cable rather than held on the node.
    const first = graphOf(patchOf([osc('a'), sense('s')], [mod('s', 'a')]))
    const slower = graphOf(patchOf([osc('a'), sense('s', { release: 900 })], [mod('s', 'a')]))
    expect(diff(first, slower).map((op) => op.op)).toEqual(['updateFollow'])

    const deeper = graphOf(patchOf([osc('a'), sense('s', { depth: -0.2 })], [mod('s', 'a')]))
    expect(diff(first, deeper).map((op) => op.op)).toEqual(['disconnectMod', 'connectMod'])
  })

  it('offers fewer targets than a modulator, and only the ones it can serve', () => {
    const all = targetsFor('fx', 'reverb')
    const signal = targetsFrom('sense', 'fx', 'reverb')
    expect(signal.length).toBeGreaterThan(0)
    expect(signal.length).toBeLessThan(all.length)
    expect(signal.every((target) => target.via !== 'value')).toBe(true)
  })
})

describe('a follower in the engine', () => {
  /** An engine with one follower listening to `a` and pointed at it, plus the fake it was built on. */
  function built(over: Partial<SenseParams> = {}) {
    const fake: FakeAudio = fakeAudio()
    const engine = new AudioEngine()
    engine.adopt(fake.ctx)
    const params = { ...defaultSenseParams(), ...over }
    // The two gains the follower builds, in the order it builds them: the tap it listens through and
    // the depth everything downstream hangs off.
    const already = fake.nodes('gain').length
    engine.createFollower('s', params)
    const input = fake.nodes('gain')[already] as { incoming: unknown[] }
    const depth = fake.nodes('gain')[already + 1] as { incoming: unknown[] }
    return { fake, engine, params, input, depth }
  }

  it('puts the processor between what it hears and what it moves', () => {
    /*
     * Both halves of one chain, and the second half is the one that can be dropped without anything
     * looking wrong: depth is set, the cable to the parameter is made, and the parameter sits at its
     * offset for ever because nothing is arriving to move it.
     */
    const { fake, engine, depth } = built()
    engine.connectTap('a', 's')
    const processor = fake.nodes('gain')
    expect(processor.length).toBeGreaterThan(0)
    expect(depth.incoming).toHaveLength(1)
  })

  it('writes all three of its settings to the processor', () => {
    const { fake } = built({ attack: 7, release: 350, sensitivity: 2.5 })
    const written = new Map(fake.journal.map((one) => [one.what, one.value]))
    expect(written.get('attack')).toBe(7)
    expect(written.get('release')).toBe(350)
    expect(written.get('sensitivity')).toBe(2.5)
  })

  it('takes a change to any of them while it is running', () => {
    const { fake, engine, params } = built()
    fake.journal.length = 0
    engine.updateFollower('s', { ...params, attack: 40, release: 800, sensitivity: 0.5 })
    const written = new Map(fake.journal.map((one) => [one.what, one.value]))
    expect(written.get('attack')).toBe(40)
    expect(written.get('release')).toBe(800)
    expect(written.get('sensitivity')).toBe(0.5)
  })

  it('drives the level it is pointed at, and downward at a negative depth', () => {
    /*
     * The whole point of registering it as a modulator: `connectMod` was not touched, and a follower
     * reaches an oscillator's level by the same path an envelope does. A dropped sign here turns every
     * duck into a swell on a patch that still plays.
     */
    const { fake, engine } = built({ depth: -0.6 })
    engine.connectMod('s', 'a', 'level', -0.6)
    const level = targetsFor('osc').find((one) => one.key === 'level')!
    const gains = fake.params('gain').map((one) => one.value)
    expect(gains).toContain(amountFor(level, -0.6))
    expect(amountFor(level, -0.6)).toBeLessThan(0)
  })

  it('feeds a per-note parameter from the processor and not from the tap', () => {
    /*
     * A per-voice target — an oscillator's filter, built fresh for every note — is reached by connecting
     * the modulator's *source* to one gain per voice. For a follower that source is the processor. Take
     * the tap instead and what arrives at the cutoff is the raw audio of the branch rather than a
     * reading of how loud it is: a cable that is connected, lit, and carrying the wrong thing entirely.
     */
    const { fake, engine, depth, input } = built({ target: 'cutoff' })
    const processor = depth.incoming[0]
    expect(processor).toBeTruthy()

    engine.connectMod('s', 'a', 'cutoff', -0.5)
    const amount = fake.nodes('gain').at(-1) as { incoming: unknown[] }
    expect(amount.incoming).toContain(processor)
    expect(amount.incoming).not.toContain(input)
  })

  it('refuses a target that is rebuilt rather than connected', () => {
    /*
     * The floor under `targetsFrom`: even handed one directly, nothing is set up for it. Watched
     * through the disconnect rather than the connect, because that is where a link nobody meant to make
     * shows itself — letting go of a value link puts the parameter back where it was, which for a reverb
     * means building a fresh impulse response. Nothing was ever connected, so nothing should be rebuilt.
     */
    const { fake, engine } = built({ target: 'decay' })
    engine.createEffect('r', { ...defaultFxParams(), effect: 'reverb' }, 120)
    const before = fake.wires()
    engine.connectMod('s', 'r', 'decay', 0.5)
    expect(fake.wires()).toBe(before)

    const written = fake.journal.length
    engine.disconnectMod('s', 'r')
    expect(fake.journal.slice(written)).toEqual([])
  })

  it('lets go of everything when it is disposed', () => {
    const { fake, engine } = built({ depth: -0.6 })
    engine.connectMod('s', 'a', 'level', -0.6)
    const wired = fake.wires()
    expect(wired).toBeGreaterThan(0)
    engine.disposeModulator('s')
    expect(fake.wires()).toBeLessThan(wired)
  })

  it('takes the branch into its input, and lets go of it again', () => {
    const { fake, engine, input } = built()
    engine.connectTap('a', 's')
    expect(input.incoming).toHaveLength(1)
    engine.disconnectTap('a', 's')
    expect(input.incoming).toHaveLength(0)
    // A tap that was never made, which is what a half-torn-down patch asks for.
    expect(() => engine.disconnectTap('nowhere', 's')).not.toThrow()
    expect(fake.nodes('gain').length).toBeGreaterThan(0)
  })

  it('listens to an effect through its output, not through a bus conjured for it', () => {
    /*
     * The order inside `connectTap`: `busFor` builds a bus and a direct gain **on demand**, so asking it
     * before the effect table would hang two new nodes off an effect's id and listen to the silence
     * coming out of them. The same fault `connectSend` had, found when a second effect in a chain
     * neither sounded nor lit up.
     */
    const { fake, engine, input } = built()
    engine.createEffect('r', { ...defaultFxParams(), effect: 'reverb' }, 120)
    const before = fake.nodes('gain').length
    engine.connectTap('r', 's')
    expect(input.incoming).toHaveLength(1)
    expect(fake.nodes('gain').length).toBe(before)
    engine.disconnectTap('r', 's')
    expect(input.incoming).toHaveLength(0)
  })
})
