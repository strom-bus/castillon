import { describe, expect, it } from 'vitest'
import { defaultOscParams } from '../nodes/registry'
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
      'triangle',
      'sine',
      'white',
      'pink',
      'brown',
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
    expect(params.steps[2].velocity).toBeCloseTo(0.6, 1)
  })

  it('round-trips the delay wait', () => {
    const decoded = decodePatch(encodePatch(DEMO))!
    expect((decoded.nodes[3].params as { delayMs: number }).delayMs).toBe(750)
  })

  it('round-trips bpm and loop across their range', () => {
    for (const bpm of [20, 97, 120, 300]) {
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
    // Roughly 20 characters a node, versus several hundred as JSON.
    expect(code.length / 200).toBeLessThan(25)
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
