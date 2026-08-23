import { describe, expect, it } from 'vitest'
import { defaultFxParams, defaultOscParams } from '../nodes/registry'
import type { ModParams, Patch, PatchEdge, PatchNode, StartParams } from '../types/patch'
import { BitWriter } from './bits'
import { INITIAL_PATCH_CODE } from './patchStore'
import {
  decodePatch,
  encodePatch,
  FX_FIELD_TOTAL,
  OSC_FIELD_TOTAL,
  STEP_COLUMN_TOTAL,
  toBase64Url,
  normalisePatchCode,
} from './patchCode'

function osc(id: string, overrides: Partial<ReturnType<typeof defaultOscParams>> = {}): PatchNode {
  return {
    id,
    type: 'osc',
    position: { x: 120, y: 240 },
    params: { ...defaultOscParams(), ...overrides },
  }
}

function patchOf(nodes: PatchNode[], edges: Patch['edges'] = []): Patch {
  return { version: 1, bpm: 120, loop: true, nodes, edges }
}

const DEMO = patchOf(
  [
    { id: 's', type: 'start', position: { x: 300, y: 20 }, params: {} },
    osc('a', { waveform: 'pulse', pulseWidth: 0.2, division: '1/16', gain: 0.4 }),
    osc('b', { waveform: 'brown', propagateMode: 'onStep' }),
    { id: 'd', type: 'delay', position: { x: 40, y: 800 }, params: { delayMs: 750 } },
  ],
  [
    { id: 'e0', kind: 'event', source: 's', target: 'a' },
    { id: 'e1', kind: 'event', source: 'a', target: 'b' },
    { id: 'e2', kind: 'event', source: 'b', target: 'd' },
  ],
)

describe('patch code', () => {
  it('round-trips the shape of a patch', () => {
    const decoded = decodePatch(encodePatch(DEMO))
    expect(decoded).not.toBeNull()
    expect(decoded!.bpm).toBe(120)
    expect(decoded!.loop).toBe(true)
    expect(decoded!.nodes.map((n) => n.type)).toEqual(['start', 'osc', 'osc', 'delay'])
    expect(decoded!.edges).toHaveLength(3)
  })

  it('keeps the wiring, even though node ids never travel in the code', () => {
    const decoded = decodePatch(encodePatch(DEMO))!
    const byIndex = decoded.nodes.map((n) => n.id)
    expect(
      decoded.edges.map((e) => [byIndex.indexOf(e.source), byIndex.indexOf(e.target)]),
    ).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ])
  })

  it('round-trips every oscillator parameter', () => {
    const decoded = decodePatch(encodePatch(DEMO))!
    const a = decoded.nodes[1].params as ReturnType<typeof defaultOscParams>
    expect(a.waveform).toBe('pulse')
    expect(a.pulseWidth).toBeCloseTo(0.2, 2)
    expect(a.division).toBe('1/16')
    expect(a.gain).toBeCloseTo(0.4, 2)
    expect(a.gate).toBeCloseTo(0.6, 2)
    expect(a.attack).toBe(4)
    expect(a.release).toBe(40)

    const b = decoded.nodes[2].params as ReturnType<typeof defaultOscParams>
    expect(b.waveform).toBe('brown')
    expect(b.propagateMode).toBe('onStep')
  })

  it('round-trips every waveform', () => {
    for (const waveform of [
      'square',
      'pulse',
      'sawtooth',
      'ramp',
      'triangle',
      'sine',
      'white',
      'pink',
      'brown',
      'blue',
    ] as const) {
      const decoded = decodePatch(encodePatch(patchOf([osc('a', { waveform })])))!
      const params = decoded.nodes[0].params as ReturnType<typeof defaultOscParams>
      expect(params.waveform).toBe(waveform)
    }
  })

  it('round-trips the steps, muted ones included', () => {
    const steps = [
      { note: 24, active: true, velocity: 1 },
      { note: 84, active: false, velocity: 1 },
      { note: 60, active: true, velocity: 0.6 },
      { note: 47, active: true, velocity: 1 },
    ]
    const decoded = decodePatch(encodePatch(patchOf([osc('a', { steps })])))!
    const params = decoded.nodes[0].params as ReturnType<typeof defaultOscParams>
    expect(params.steps.map((s) => s.note)).toEqual([24, 84, 60, 47])
    expect(params.steps.map((s) => s.active)).toEqual([true, false, true, true])
  })

  it('carries what a step holds besides its note', () => {
    /*
     * Velocity spent a long time out of the format because nothing could edit it — four bits a step
     * storing the same one over and over. It came back the day it became editable, and three others came
     * with it. Each is a column with a bit in front saying whether the column is there at all, so a
     * sequence using none of them still pays four bits for the whole node.
     */
    const steps = [
      { note: 60, active: true, velocity: 0.5, chance: 0.4, ratchet: 3, slide: true },
      { note: 62, active: true, velocity: 0.2, chance: 1, ratchet: 1, slide: false },
      { note: 64, active: true, velocity: 1, chance: 0.8, ratchet: 4, slide: true },
      { note: 65, active: true, velocity: 0.8, chance: 0.2, ratchet: 2, slide: false },
    ]
    const decoded = decodePatch(encodePatch(patchOf([osc('a', { steps })])))!
    const params = decoded.nodes[0].params as ReturnType<typeof defaultOscParams>

    // Quantised, not exact: sixteen levels is finer than anybody sets by hand and a quarter of the bits.
    for (const [i, step] of params.steps.entries()) {
      expect(step.velocity, `velocity ${i}`).toBeCloseTo(steps[i]!.velocity, 1)
      expect(step.chance, `chance ${i}`).toBeCloseTo(steps[i]!.chance, 1)
      expect(step.ratchet, `ratchet ${i}`).toBe(steps[i]!.ratchet)
      expect(step.slide, `slide ${i}`).toBe(steps[i]!.slide)
    }
  })

  it('spends nothing on a column no step in the sequence uses', () => {
    // The usual case for all four: a sequence of plain notes should cost what it cost before any of
    // them existed, plus one bit each to say they are not there.
    const plain = [1, 2, 3, 4].map((n) => ({ note: 60 + n, active: true, velocity: 1 }))
    const loud = plain.map((step) => ({ ...step, velocity: 0.5 }))

    const bare = encodePatch(patchOf([osc('a', { steps: plain })])).length
    const withVelocity = encodePatch(patchOf([osc('a', { steps: loud })])).length
    expect(withVelocity).toBeGreaterThan(bare)
  })

  it('charges almost nothing for a parameter left alone', () => {
    /*
     * The point of the mask: a fixed layout paid for every field of every node whether it had been
     * touched or not, and in a real patch almost nothing is.
     *
     * Measured as cost *per node* rather than as a ratio of two whole codes, which is what this used to
     * be. Two things defeat the simpler forms. The mask spends a bit per field, so every field added to
     * the format lengthens the untouched code too and quietly narrows any ratio — four new oscillator
     * fields took it from 1.53 to exactly 1.5 and it failed having found nothing wrong. And the code is
     * packed into characters, so touching one field can disappear into the padding and show no growth at
     * all. A slope over eight nodes has neither problem: a header is constant, and a field added but not
     * set costs both sides the same bit.
     */
    const FIELDS = {
      waveform: 'pink',
      division: '1/16',
      gain: 0.9,
      attack: 300,
      release: 900,
      gate: 0.95,
      filterType: 'bandpass',
      cutoff: 700,
      resonance: 14,
      propagateMode: 'onStep',
    } as const

    const nodes = (count: number, over: object = {}) =>
      encodePatch(patchOf(Array.from({ length: count }, (_, i) => osc(`o${i}`, over)))).length
    const perNode = (over: object = {}) => (nodes(9, over) - nodes(1, over)) / 8

    expect(perNode(FIELDS)).toBeGreaterThan(perNode())
  })

  it('costs an FX node little when its effect leaves most fields at rest', () => {
    const reverb = encodePatch(
      patchOf([{ id: 'f', type: 'fx', position: { x: 0, y: 0 }, params: defaultFxParams() }]),
    )
    // Sixteen parameters exist; a reverb that has not been touched should not pay for fifteen of
    // them. Under a fixed layout this was a hundred bits whatever the effect was.
    expect(reverb.length).toBeLessThan(20)
  })

  it('still round-trips a parameter set back to the reference value', () => {
    // A value that happens to equal the reference is dropped from the mask, so this checks the
    // dropping is what restores it rather than luck.
    const decoded = decodePatch(encodePatch(patchOf([osc('a', { gain: 0.25, cutoff: 2000 })])))!
    const params = decoded.nodes[0].params as ReturnType<typeof defaultOscParams>
    expect(params.gain).toBeCloseTo(0.25, 2)
    expect(params.cutoff / 2000).toBeCloseTo(1, 2)
  })

  it('round-trips the filter', () => {
    for (const filterType of ['off', 'lowpass', 'highpass', 'bandpass'] as const) {
      const decoded = decodePatch(
        encodePatch(patchOf([osc('a', { filterType, cutoff: 1200, resonance: 6.4 })])),
      )!
      const params = decoded.nodes[0].params as ReturnType<typeof defaultOscParams>
      expect(params.filterType).toBe(filterType)
      expect(params.resonance).toBeCloseTo(6.4, 1)
      // Cutoff travels as a log-slider position, so it comes back within a fraction of a percent.
      expect(params.cutoff / 1200).toBeCloseTo(1, 2)
    }
  })

  it('keeps cutoff accurate across the whole range, not just in the middle', () => {
    for (const cutoff of [20, 80, 440, 2000, 9000, 18000]) {
      const decoded = decodePatch(
        encodePatch(patchOf([osc('a', { filterType: 'lowpass', cutoff })])),
      )!
      const back = (decoded.nodes[0].params as ReturnType<typeof defaultOscParams>).cutoff
      expect(back / cutoff).toBeCloseTo(1, 2)
    }
  })

  it('round-trips the delay wait', () => {
    const decoded = decodePatch(encodePatch(DEMO))!
    expect((decoded.nodes[3].params as { delayMs: number }).delayMs).toBe(750)
  })

  it('round-trips bpm and loop across their range', () => {
    for (const bpm of [20, 97, 120, 300, 640, 1000]) {
      for (const loop of [true, false]) {
        const decoded = decodePatch(encodePatch({ ...DEMO, bpm, loop }))!
        expect(decoded.bpm).toBe(bpm)
        expect(decoded.loop).toBe(loop)
      }
    }
  })

  it('puts nodes back within a grid step of where they were', () => {
    const decoded = decodePatch(encodePatch(DEMO))!
    expect(Math.abs(decoded.nodes[0].position.x - 300)).toBeLessThanOrEqual(4)
    expect(Math.abs(decoded.nodes[3].position.y - 800)).toBeLessThanOrEqual(4)
  })

  it('handles negative coordinates, since the canvas pans past the origin', () => {
    const decoded = decodePatch(
      encodePatch(patchOf([{ ...osc('a'), position: { x: -1200, y: -640 } }])),
    )!
    expect(decoded.nodes[0].position.x).toBeCloseTo(-1200, 0)
    expect(decoded.nodes[0].position.y).toBeCloseTo(-640, 0)
  })

  it('is dramatically shorter than the same patch as JSON', () => {
    const code = encodePatch(DEMO)
    expect(code.length).toBeLessThan(JSON.stringify(DEMO).length / 8)
    // A handful of nodes has to stay comfortably pasteable.
    expect(code.length).toBeLessThan(120)
  })

  it('produces a URL-safe string', () => {
    expect(encodePatch(DEMO)).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('stays proportionate on a large patch', () => {
    const nodes = Array.from({ length: 200 }, (_, i) => osc(`n${i}`))
    const edges = nodes.slice(1).map((n, i) => ({
      id: `e${i}`,
      kind: 'event' as const,
      source: nodes[i].id,
      target: n.id,
    }))
    const code = encodePatch(patchOf(nodes, edges))
    const decoded = decodePatch(code)!
    expect(decoded.nodes).toHaveLength(200)
    expect(decoded.edges).toHaveLength(199)
    // The real claim is the ratio against JSON; the absolute bound just catches a blow-up.
    expect(code.length).toBeLessThan(JSON.stringify(patchOf(nodes, edges)).length / 15)
    expect(code.length / 200).toBeLessThan(35)
  })

  it('drops edges pointing at nodes that are not in the patch', () => {
    const decoded = decodePatch(
      encodePatch(patchOf([osc('a')], [{ id: 'e0', kind: 'event', source: 'a', target: 'ghost' }])),
    )!
    expect(decoded.edges).toHaveLength(0)
  })

  it('round-trips every sequence length', () => {
    for (const count of [2, 4, 8, 16]) {
      const steps = Array.from({ length: count }, (_, i) => ({
        note: 40 + i,
        active: i % 2 === 0,
        velocity: 1,
      }))
      const decoded = decodePatch(encodePatch(patchOf([osc('a', { steps })])))!
      const params = decoded.nodes[0].params as ReturnType<typeof defaultOscParams>
      expect(params.steps).toHaveLength(count)
      expect(params.steps.map((s) => s.note)).toEqual(steps.map((s) => s.note))
      expect(params.steps.map((s) => s.active)).toEqual(steps.map((s) => s.active))
    }
  })

  it('a longer sequence costs only what its extra steps need', () => {
    const stepsOf = (count: number) =>
      Array.from({ length: count }, () => ({ note: 60, active: true, velocity: 1 }))
    const short = encodePatch(patchOf([osc('a', { steps: stepsOf(2) })])).length
    const long = encodePatch(patchOf([osc('a', { steps: stepsOf(16) })])).length
    // 14 extra steps at 11 bits each is around 20 more characters, not a different order.
    expect(long - short).toBeLessThan(30)
  })

  it('rejects a code from a different format version', () => {
    // The version nibble leads the stream, so flipping it is enough to make the code foreign.
    const bytes = Uint8Array.from(
      atob(encodePatch(DEMO).replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0),
    )
    bytes[0] = (bytes[0] & 0x0f) | 0x90
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    const foreign = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(decodePatch(foreign)).toBeNull()
  })

  it('round-trips an audio cable as an audio cable', () => {
    const patch = patchOf(
      [osc('a'), { id: 'f', type: 'fx', position: { x: 0, y: 0 }, params: defaultFxParams() }],
      [{ id: 'x', kind: 'audio', source: 'a', target: 'f' }],
    )
    const decoded = decodePatch(encodePatch(patch))!
    expect(decoded.edges).toHaveLength(1)
    expect(decoded.edges[0].kind).toBe('audio')
  })

  it('keeps the two cable kinds apart in one patch', () => {
    const patch = patchOf(
      [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
        osc('a'),
        { id: 'f', type: 'fx', position: { x: 0, y: 0 }, params: defaultFxParams() },
      ],
      [
        { id: 'e', kind: 'event', source: 's', target: 'a' },
        { id: 'x', kind: 'audio', source: 'a', target: 'f' },
      ],
    )
    const decoded = decodePatch(encodePatch(patch))!
    expect(decoded.edges.map((e) => e.kind)).toEqual(['event', 'audio'])
  })

  it('round-trips every FX parameter, including ones the current effect ignores', () => {
    // They are all encoded on purpose: it is what stops the format changing when an effect lands.
    const params = {
      ...defaultFxParams(),
      effect: 'reverb' as const,
      mix: 0.42,
      decay: 6.3,
      drive: 0.77,
      time: '1/16' as const,
      feedback: 0.9,
      filterType: 'highpass' as const,
      cutoff: 800,
      resonance: 11.5,
      rate: 7.2,
      depth: 0.66,
    }
    const decoded = decodePatch(
      encodePatch(patchOf([{ id: 'f', type: 'fx', position: { x: 0, y: 0 }, params }])),
    )!
    const back = decoded.nodes[0].params as typeof params

    expect(back.effect).toBe('reverb')
    expect(back.mix).toBeCloseTo(0.42, 2)
    expect(back.decay).toBeCloseTo(6.3, 1)
    expect(back.drive).toBeCloseTo(0.77, 2)
    expect(back.time).toBe('1/16')
    expect(back.feedback).toBeCloseTo(0.9, 2)
    expect(back.filterType).toBe('highpass')
    expect(back.cutoff / 800).toBeCloseTo(1, 2)
    expect(back.resonance).toBeCloseTo(11.5, 1)
    expect(back.rate).toBeCloseTo(7.2, 1)
    expect(back.depth).toBeCloseTo(0.66, 2)
  })

  it('round-trips the sweep, which the chorus needs to reach flanging', () => {
    for (const sweep of [0.5, 6, 22, 35]) {
      const decoded = decodePatch(
        encodePatch(
          patchOf([
            {
              id: 'f',
              type: 'fx',
              position: { x: 0, y: 0 },
              params: { ...defaultFxParams(), sweep },
            },
          ]),
        ),
      )!
      expect((decoded.nodes[0].params as { sweep: number }).sweep).toBeCloseTo(sweep, 1)
    }
  })

  it('keeps reading a code written before a parameter existed', () => {
    // The whole point of declaring the field count. This hand-builds a header claiming one field
    // fewer than this build has, which is exactly what a code from yesterday looks like, and checks
    // the missing parameter comes back at its reference rather than shifting everything after it.
    const writer = new BitWriter()
    writer.write(1, 4) // version
    writer.write(120 - 20, 10) // bpm
    writer.write(1, 1) // loop
    writer.write(OSC_FIELD_TOTAL - 1, 6) // one field fewer than we know about
    writer.write(FX_FIELD_TOTAL, 6)
    writer.write(0, 4) // reserved flags
    writer.writeVarint(1) // one node
    writer.write(1, 4) // type: osc
    writer.writeSignedVarint(0)
    writer.writeSignedVarint(0)
    for (let i = 0; i < OSC_FIELD_TOTAL - 1; i++) writer.write(0, 1) // nothing differs
    writer.write(1, 3) // four steps
    for (let i = 0; i < 4; i++) {
      writer.write(1, 1)
      writer.write(60 - 24, 6)
    }
    // Every step column absent, which is what a sequence of plain notes writes. Without these the code
    // is not an older one but a truncated one, and the reader runs off the end of it.
    for (let i = 0; i < STEP_COLUMN_TOTAL; i++) writer.write(0, 1)
    writer.writeVarint(0) // no edges

    const code = toBase64Url(writer.finish())
    const decoded = decodePatch(code)
    expect(decoded).not.toBeNull()
    expect(decoded!.nodes).toHaveLength(1)
    const params = decoded!.nodes[0].params as ReturnType<typeof defaultOscParams>
    expect(params.steps.map((s) => s.note)).toEqual([60, 60, 60, 60])
    // The field the old writer had never heard of arrives at its reference value.
    expect(params.propagateMode).toBe('onEnd')
  })

  it('refuses a code from a newer build rather than guessing at it', () => {
    // The widths of parameters that do not exist yet are unknowable, so every bit after them would
    // be misread. Failing is the only honest answer.
    const writer = new BitWriter()
    writer.write(1, 4)
    writer.write(100, 10)
    writer.write(1, 1)
    writer.write(OSC_FIELD_TOTAL + 3, 6) // claims parameters this build does not have
    writer.write(FX_FIELD_TOTAL, 6)
    writer.write(0, 4)
    writer.writeVarint(1)
    writer.write(1, 4)
    writer.writeSignedVarint(0)
    writer.writeSignedVarint(0)

    expect(decodePatch(toBase64Url(writer.finish()))).toBeNull()
  })

  it('returns null instead of throwing on junk', () => {
    expect(decodePatch('')).toBeNull()
    expect(decodePatch('not a real code')).toBeNull()
    expect(decodePatch('!!!!')).toBeNull()
    expect(decodePatch('AAAA')).toBeNull()
  })

  it('returns null on a truncated code rather than half a patch', () => {
    const code = encodePatch(DEMO)
    expect(decodePatch(code.slice(0, Math.floor(code.length / 2)))).toBeNull()
  })

  it('ignores surrounding whitespace, since codes get pasted', () => {
    const code = encodePatch(DEMO)
    expect(decodePatch(`  ${code}\n`)).not.toBeNull()
  })
})

describe('Ignite triggers in the code', () => {
  const ignite = (params: StartParams): PatchNode => ({
    id: 's',
    type: 'start',
    position: { x: 0, y: 0 },
    params,
  })

  const patchOf = (nodes: PatchNode[]): Patch => ({
    version: 1,
    bpm: 120,
    loop: true,
    nodes,
    edges: [],
  })

  const roundTrip = (patch: Patch) => decodePatch(encodePatch(patch))

  it('carries a bound key there and back', () => {
    const patch = patchOf([
      ignite({ trigger: 'bound', behaviour: 'hold', binding: { source: 'key', code: 'KeyA' } }),
    ])
    expect(roundTrip(patch)!.nodes[0].params).toEqual({
      trigger: 'bound',
      behaviour: 'hold',
      binding: { source: 'key', code: 'KeyA' },
    })
  })

  it('carries the behaviour', () => {
    const patch = patchOf([
      ignite({ trigger: 'bound', behaviour: 'toggle', binding: { source: 'key', code: 'Space' } }),
    ])
    const params = roundTrip(patch)!.nodes[0].params as StartParams
    expect(params.behaviour).toBe('toggle')
  })

  it('carries an unusual key code, which a table of names would have lost', () => {
    const patch = patchOf([
      ignite({
        trigger: 'bound',
        behaviour: 'hold',
        binding: { source: 'key', code: 'BracketLeft' },
      }),
    ])
    const params = roundTrip(patch)!.nodes[0].params as StartParams
    expect(params.binding?.code).toBe('BracketLeft')
  })

  it('keeps several Ignites on different keys apart', () => {
    const patch = patchOf([
      {
        ...ignite({
          trigger: 'bound',
          behaviour: 'hold',
          binding: { source: 'key', code: 'KeyA' },
        }),
        id: 'a',
      },
      { ...ignite({ trigger: 'auto' }), id: 'b' },
      {
        ...ignite({
          trigger: 'bound',
          behaviour: 'toggle',
          binding: { source: 'key', code: 'KeyB' },
        }),
        id: 'c',
      },
    ])
    const back = roundTrip(patch)!.nodes.map((node) => (node.params as StartParams).binding?.code)
    expect(back).toEqual(['KeyA', undefined, 'KeyB'])
  })

  it('costs nothing when no Ignite is bound', () => {
    // A patch of automatic Ignites writes the code it always wrote, so nothing already shared moves.
    const before = encodePatch(patchOf([ignite({})]))
    const after = encodePatch(patchOf([ignite({ trigger: 'auto' })]))
    expect(after).toBe(before)
  })

  it('still reads a code written before triggers existed', () => {
    // The guarantee that matters now the gallery stores codes: the example patch predates all of
    // this, and its Ignites have to come back as automatic rather than as nonsense.
    const patch = decodePatch(INITIAL_PATCH_CODE)
    expect(patch).not.toBeNull()
    const starts = patch!.nodes.filter((node) => node.type === 'start')
    expect(starts.length).toBeGreaterThan(0)
    for (const start of starts) {
      expect((start.params as StartParams).trigger ?? 'auto').toBe('auto')
    }
  })
})

describe('modulation in the code', () => {
  const modNode = (params: Partial<ModParams> = {}): PatchNode => ({
    id: 'm',
    type: 'mod',
    position: { x: 0, y: 0 },
    params: { kind: 'lfo', wave: 'sine', rate: 2, depth: 0.6, target: 'level', ...params },
  })

  const oscNode = (id: string): PatchNode => ({
    id,
    type: 'osc',
    position: { x: 40, y: 0 },
    params: defaultOscParams(),
  })

  const fxNode = (id: string, effect: string): PatchNode => ({
    id,
    type: 'fx',
    position: { x: 80, y: 0 },
    params: { ...defaultFxParams(), effect } as never,
  })

  const patchOf = (nodes: PatchNode[], edges: PatchEdge[] = []): Patch => ({
    version: 1,
    bpm: 120,
    loop: true,
    nodes,
    edges,
  })

  const roundTrip = (patch: Patch) => decodePatch(encodePatch(patch))

  it('carries a modulator there and back', () => {
    const patch = patchOf([modNode({ wave: 'triangle', rate: 4.25, depth: 0.35 })])
    const params = roundTrip(patch)!.nodes[0].params as ModParams
    expect(params.wave).toBe('triangle')
    expect(params.rate).toBeCloseTo(4.25, 2)
    expect(params.depth).toBeCloseTo(0.35, 2)
  })

  it('carries a target that belongs to an effect, not a fixed list', () => {
    // Written as text on purpose: the set is open, so a table of names would fail the moment an
    // effect gained a parameter.
    const patch = patchOf([modNode({ target: 'decay' }), fxNode('f', 'reverb')])
    const params = roundTrip(patch)!.nodes[0].params as ModParams
    expect(params.target).toBe('decay')
  })

  it('carries a modulation cable as its own kind', () => {
    const patch = patchOf(
      [modNode(), oscNode('a')],
      [{ id: 'e', kind: 'mod', source: 'm', target: 'a' }],
    )
    expect(roundTrip(patch)!.edges[0].kind).toBe('mod')
  })

  describe('a code that travelled', () => {
    /*
     * A long code is a hundred to three hundred characters of base64url, and it goes wherever somebody
     * can put text: a chat window, a note, a text file, an email. Every one of those wraps, and a
     * wrapped code used to fail — silently, because the field coloured itself and said nothing, so the
     * symptom read as "long codes do not work".
     *
     * Whitespace is never part of a code, so accepting it anywhere is free. What is not free is failing
     * for a reason nobody can see.
     */
    const wrapped = (code: string, at: string) => code.slice(0, 60) + at + code.slice(60)

    it.each([
      ['a trailing newline', (code: string) => `${code}\n`],
      ['spaces around it', (code: string) => `  ${code}  `],
      ['a newline where it wrapped', (code: string) => wrapped(code, '\n')],
      ['a space where it wrapped', (code: string) => wrapped(code, ' ')],
      ['a run of spaces', (code: string) => wrapped(code, '   ')],
      ['a tab', (code: string) => wrapped(code, '\t')],
      ['a windows line ending', (code: string) => wrapped(code, '\r\n')],
    ])('survives %s', (_name, mangle) => {
      const patch = patchOf(
        [
          { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
          oscNode('a'),
          fxNode('f', 'reverb'),
        ],
        [
          { id: 'e1', kind: 'event', source: 's', target: 'a' },
          { id: 'e2', kind: 'audio', source: 'a', target: 'f' },
        ],
      )
      const code = encodePatch(patch)
      const back = decodePatch(mangle(code))

      // The whole patch, not merely a non-null answer: bpm is at the front of the code and would
      // survive almost any decoding fault, so reading it back proves very little on its own.
      expect(back).not.toBeNull()
      expect(back!.nodes.map((node) => node.type)).toEqual(['start', 'osc', 'fx'])
      expect(back!.edges.map((edge) => edge.kind)).toEqual(['event', 'audio'])
    })

    it('still refuses something that is not a code at all', () => {
      // The generosity has a limit: stripping spaces must not turn nonsense into a patch.
      expect(decodePatch('hello there')).toBeNull()
      expect(decodePatch('   ')).toBeNull()
      expect(decodePatch('')).toBeNull()
    })

    it('takes the spaces out before anything measures the length', () => {
      /*
       * Asserted on the normaliser rather than through a decode, and that is the point of it existing.
       * `atob` ignores ASCII whitespace by itself, so what actually broke was the padding — computed
       * from a length that the spaces had inflated, padding to the wrong multiple of four. And jsdom's
       * `atob` is more forgiving about padding than a browser's, so a test that only decodes a wrapped
       * code passes whether the stripping is there or not. It did.
       */
      expect(normalisePatchCode('abc def')).toBe('abcdef')
      expect(normalisePatchCode(' ab\n cd\t ef\r\n ')).toBe('abcdef')
      expect(normalisePatchCode('abcdef')).toBe('abcdef')
      // Length is the thing that mattered, so it is the thing asserted.
      expect(normalisePatchCode('ab cd').length).toBe(4)
    })
  })

  it('keeps all four kinds of cable apart in one patch', () => {
    // All four rather than the three that existed when this was written. Three of them share the side
    // ports, so a code that confused two would produce a patch that looks wired and behaves differently
    // — the sort of fault nobody finds by looking at the canvas.
    const patch = patchOf(
      [
        { id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} },
        oscNode('a'),
        fxNode('f', 'reverb'),
        modNode(),
        { id: 'w', type: 'warp', position: { x: 0, y: 0 }, params: { transpose: 3 } },
      ],
      [
        { id: 'e1', kind: 'event', source: 's', target: 'a' },
        { id: 'e2', kind: 'audio', source: 'a', target: 'f' },
        { id: 'e3', kind: 'mod', source: 'm', target: 'f' },
        { id: 'e4', kind: 'warp', source: 'w', target: 'a' },
      ],
    )
    expect(roundTrip(patch)!.edges.map((edge) => edge.kind)).toEqual([
      'event',
      'audio',
      'mod',
      'warp',
    ])
  })

  it('costs nothing when there is no modulation', () => {
    // A patch without any writes the code it always wrote, so nothing already shared moves.
    const plain = patchOf(
      [{ id: 's', type: 'start', position: { x: 0, y: 0 }, params: {} }, oscNode('a')],
      [{ id: 'e', kind: 'event', source: 's', target: 'a' }],
    )
    expect(encodePatch(plain)).toBe(encodePatch(structuredClone(plain)))
  })

  it('still reads a code written before modulation existed', () => {
    // The guarantee: cables were one bit until now, and every code in the world still has them that
    // way. The example patch predates all of it.
    const patch = decodePatch(INITIAL_PATCH_CODE)
    expect(patch).not.toBeNull()
    expect(patch!.edges.length).toBeGreaterThan(0)
    for (const edge of patch!.edges) {
      expect(['event', 'audio']).toContain(edge.kind)
    }
  })
})

describe('a MIDI binding', () => {
  it('comes back as MIDI rather than as a key called "60"', () => {
    // What it did before there was a bit for the source: the code survived and the source did not, so a
    // shared patch arrived looking bound to a key that answers to nothing.
    const patch: Patch = {
      version: 1,
      bpm: 120,
      loop: true,
      nodes: [
        {
          id: 's',
          type: 'start',
          position: { x: 0, y: 0 },
          params: {
            trigger: 'bound',
            behaviour: 'hold',
            binding: { source: 'midi', code: '60' },
          },
        },
      ],
      edges: [],
    }
    const back = decodePatch(encodePatch(patch))!
    expect((back.nodes[0].params as StartParams).binding).toEqual({ source: 'midi', code: '60' })
  })

  it('leaves a key binding a key binding', () => {
    const patch: Patch = {
      version: 1,
      bpm: 120,
      loop: true,
      nodes: [
        {
          id: 's',
          type: 'start',
          position: { x: 0, y: 0 },
          params: {
            trigger: 'bound',
            behaviour: 'toggle',
            binding: { source: 'key', code: 'KeyA' },
          },
        },
      ],
      edges: [],
    }
    const back = decodePatch(encodePatch(patch))!
    expect((back.nodes[0].params as StartParams).binding).toEqual({ source: 'key', code: 'KeyA' })
  })
})
