import { describe, expect, it } from 'vitest'
import { colorAt, computeDepths } from './depth'

const start = { id: 's', type: 'start' }
const osc = (id: string) => ({ id, type: 'osc' })

describe('computeDepths', () => {
  it('measures the distance to Start', () => {
    const { depths, max } = computeDepths(
      [start, osc('a'), osc('b')],
      [
        { source: 's', target: 'a' },
        { source: 'a', target: 'b' },
      ],
    )
    expect(depths.get('s')).toBe(0)
    expect(depths.get('a')).toBe(1)
    expect(depths.get('b')).toBe(2)
    expect(max).toBe(2)
  })

  it('sibling branches share a depth', () => {
    const { depths } = computeDepths(
      [start, osc('a'), osc('b'), osc('c')],
      [
        { source: 's', target: 'a' },
        { source: 'a', target: 'b' },
        { source: 'a', target: 'c' },
      ],
    )
    expect(depths.get('b')).toBe(1 + 1)
    expect(depths.get('c')).toBe(depths.get('b'))
  })

  it('when two paths reach the same node the shortest wins', () => {
    const { depths } = computeDepths(
      [start, osc('a'), osc('b'), osc('c')],
      [
        { source: 's', target: 'a' },
        { source: 's', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'a', target: 'c' },
      ],
    )
    expect(depths.get('c')).toBe(2)
  })

  it('leaves out nodes no Start can reach', () => {
    const { depths } = computeDepths(
      [start, osc('a'), osc('orphan')],
      [{ source: 's', target: 'a' }],
    )
    expect(depths.has('orphan')).toBe(false)
  })

  it('does not hang on a cycle', () => {
    const { depths, max } = computeDepths(
      [start, osc('a'), osc('b')],
      [
        { source: 's', target: 'a' },
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
    )
    expect(max).toBe(2)
    expect(depths.size).toBe(3)
  })
})

/** Pulls the three numbers back out of an `hsl(h s% l%)` string. */
function parse(color: string): { h: number; s: number; l: number } {
  const [h, s, l] = color
    .replace('hsl(', '')
    .replace(')', '')
    .replace(/%/g, '')
    .split(' ')
    .map(Number)
  return { h, s, l }
}

describe('what counts as part of the cascade', () => {
  const audio = (source: string, target: string) => ({
    source,
    target,
    data: { kind: 'audio' },
  })

  it('leaves an Ignite with nothing wired below it out, so it reads as disconnected', () => {
    const { depths } = computeDepths([start, osc('a')], [])
    expect(depths.has('s')).toBe(false)
    expect(depths.has('a')).toBe(false)
  })

  it('counts an Ignite the moment something hangs off it', () => {
    const { depths } = computeDepths([start, osc('a')], [{ source: 's', target: 'a' }])
    expect(depths.get('s')).toBe(0)
    expect(depths.get('a')).toBe(1)
  })

  it('does not treat an audio cable as another level of cascade', () => {
    // Without this, an effect wired to an oscillator became a cascade level of its own, pushing
    // `max` up and compressing the colour ramp across the whole patch.
    const withoutFx = computeDepths([start, osc('a')], [{ source: 's', target: 'a' }])
    const withFx = computeDepths(
      [start, osc('a'), { id: 'f', type: 'fx' }],
      [{ source: 's', target: 'a' }, audio('a', 'f')],
    )

    expect(withFx.max).toBe(withoutFx.max)
    expect(withFx.depths.has('f')).toBe(false)
  })

  it('so the hues of a patch do not shift when an effect is attached', () => {
    const bare = computeDepths(
      [start, osc('a'), osc('b')],
      [
        { source: 's', target: 'a' },
        { source: 'a', target: 'b' },
      ],
    )
    const wired = computeDepths(
      [start, osc('a'), osc('b'), { id: 'f', type: 'fx' }],
      [{ source: 's', target: 'a' }, { source: 'a', target: 'b' }, audio('b', 'f')],
    )

    const hueOf = (g: { depths: Map<string, number>; max: number }, id: string) =>
      colorAt(g.depths.get(id)! / g.max)

    expect(hueOf(wired, 'b')).toBe(hueOf(bare, 'b'))
  })
})

describe('the fluorescent ramp', () => {
  it('starts fluo green and ends hot orange', () => {
    expect(colorAt(0)).toBe('hsl(148.0 82.0% 44.0%)')
    expect(colorAt(1)).toBe('hsl(14.0 100.0% 56.0%)')
  })

  it('a single-level graph stays at the green end', () => {
    expect(colorAt(0)).toBe('hsl(148.0 82.0% 44.0%)')
  })

  it('marches through the hues without ever going back', () => {
    let previous = Infinity
    for (let i = 0; i <= 40; i++) {
      const { h } = parse(colorAt(i / 40))
      expect(h).toBeLessThanOrEqual(previous)
      previous = h
    }
  })

  it('stays saturated and bright enough to read as fluorescent on black', () => {
    for (let i = 0; i <= 20; i++) {
      const { s, l } = parse(colorAt(i / 20))
      expect(s).toBeGreaterThanOrEqual(80)
      expect(l).toBeGreaterThanOrEqual(42)
      expect(l).toBeLessThanOrEqual(60)
    }
  })

  it('lifts lightness through the yellows, which is why the ramp has middle stops', () => {
    // A plain two-endpoint sweep at fixed lightness goes muddy here.
    expect(parse(colorAt(0.52)).l).toBeGreaterThan(parse(colorAt(0)).l)
  })

  it('sweeps continuously, not one flat colour per level', () => {
    // A node covers the first part of its level and its cable the rest, so the hue keeps
    // moving between whole depths instead of stepping.
    expect(colorAt(0.25)).not.toBe(colorAt(0.3))
    expect(colorAt(-1)).toBe(colorAt(0))
    expect(colorAt(9)).toBe(colorAt(1))
  })
})
