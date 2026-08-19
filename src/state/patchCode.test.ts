import { describe, expect, it } from 'vitest'
import { defaultFxParams, defaultOscParams } from '../nodes/registry'
import type { Patch, PatchNode } from '../types/patch'
import { decodePatch, encodePatch } from './patchCode'

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

  it('does not carry per-step velocity, which nothing edits yet', () => {
    // Four bits a step went on storing the same one over and over. It comes back the day per-step
    // velocity is editable; until then it is the largest thing in the format buying nothing.
    const steps = [
      { note: 60, active: true, velocity: 0.5 },
      { note: 62, active: true, velocity: 0.2 },
      { note: 64, active: true, velocity: 1 },
      { note: 65, active: true, velocity: 0.8 },
    ]
    const decoded = decodePatch(encodePatch(patchOf([osc('a', { steps })])))!
    const params = decoded.nodes[0].params as ReturnType<typeof defaultOscParams>
    expect(params.steps.map((s) => s.velocity)).toEqual([1, 1, 1, 1])
  })

  it('charges almost nothing for a parameter left alone', () => {
    // The point of the mask. A fixed layout paid for every field of every node whether it had been
    // touched or not, and in a real patch almost nothing is.
    const plain = encodePatch(patchOf([osc('a')]))
    const fiddled = encodePatch(
      patchOf([
        osc('a', {
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
        }),
      ]),
    )
    expect(fiddled.length).toBeGreaterThan(plain.length * 1.5)
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
