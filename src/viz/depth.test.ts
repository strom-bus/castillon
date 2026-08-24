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

  it('follows a climbing wave, so an upward branch is coloured too', () => {
    /*
     * Depth is distance from the Ignite **along the wave**, and a wave can run either way. Skipping
     * upward cables — which the first version did, on the grounds that a climb is not a step down — was
     * wrong twice: the Ignite had no children at all, so it fell out of the map and read as
     * *disconnected*, and the branch it fires had no path from any start, so a whole working cascade
     * came out grey.
     */
    const { depths, max } = computeDepths(
      [start, osc('a'), osc('b'), osc('c')],
      [
        // A chain drawn downward, with nothing joining the Ignite to the top of it.
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
        // And the Ignite firing the bottom, so the wave climbs c → b → a.
        { source: 's', target: 'c', data: { kind: 'event', up: true } },
      ],
    )
    expect(depths.get('s'), 'the Ignite reads as disconnected').toBe(0)
    expect(depths.get('c')).toBe(1)
    expect(depths.get('b')).toBe(2)
    expect(depths.get('a')).toBe(3)
    expect(max).toBe(3)
  })

  it('does not let a climb use an upward cable as a rung', () => {
    /*
     * The same exclusion the scheduler makes: an upward cable is the entrance to a climb, not a step in
     * one. Counted as a rung it would give the Ignite a second depth through the back door and the ramp
     * would run out of one end of itself.
     */
    const { depths } = computeDepths(
      [start, osc('a'), osc('b')],
      [
        { source: 's', target: 'a' },
        { source: 'a', target: 'b' },
        { source: 's', target: 'b', data: { kind: 'event', up: true } },
      ],
    )
    // Reached both ways and coloured by the shorter, which is the rule everywhere else here.
    expect(depths.get('b')).toBe(1)
    expect(depths.get('s')).toBe(0)
    expect(depths.size).toBe(3)
  })

  it('does not let a climb walk back down an ordinary cable', () => {
    /*
     * The other half of the same rule, and the half a small graph cannot show. A climb follows a cable
     * from its *target* to its *source*; indexing it the other way as well would let the wave turn round
     * and descend again, so anything hanging below the node a climb starts at would light up as part of
     * it.
     *
     * `d` hangs below `c` and nothing points at `c`, so the climb has nowhere to go and `d` is unreached.
     */
    const { depths } = computeDepths(
      [start, osc('c'), osc('d')],
      [
        { source: 'c', target: 'd' },
        { source: 's', target: 'c', data: { kind: 'event', up: true } },
      ],
    )
    expect(depths.get('s')).toBe(0)
    expect(depths.get('c')).toBe(1)
    expect(depths.has('d'), 'a climb walked back down').toBe(false)
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
