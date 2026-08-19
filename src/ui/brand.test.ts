import { describe, expect, it } from 'vitest'
import styles from './styles.css?raw'
import { colorAt } from '../viz/depth'

/**
 * The wordmark's `_ON` carries the same ramp as the cables, but it gets it from a CSS gradient while
 * the cables get theirs from `colorAt`. Two copies of one ramp drift apart silently: after a retune
 * the logo would quietly stop matching the instrument, and nobody would notice for months.
 *
 * The stop positions are the ramp's own, so the two can be compared directly.
 */

interface Stop {
  /** Position along the gradient, 0 to 1. */
  at: number
  h: number
  s: number
  l: number
}

/** The stylesheet region that styles the wordmark, so a match cannot come from elsewhere. */
function brandRegion(): string {
  const start = styles.indexOf('@property --brand-angle')
  expect(start).toBeGreaterThan(-1)
  return styles.slice(start, styles.indexOf('.transport {', start))
}

function gradientStops(region: string): Stop[] {
  const open = region.indexOf('linear-gradient')
  const gradient = region.slice(open, region.indexOf(');', open))
  const matches = gradient.matchAll(/hsl\(([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\)\s+([\d.]+)%/g)
  return [...matches].map((m) => ({
    h: Number(m[1]),
    s: Number(m[2]),
    l: Number(m[3]),
    at: Number(m[4]) / 100,
  }))
}

function parse(color: string): { h: number; s: number; l: number } {
  const [h, s, l] = color
    .replace('hsl(', '')
    .replace(')', '')
    .replace(/%/g, '')
    .split(' ')
    .map(Number)
  return { h, s, l }
}

/**
 * The position on the ramp that produces this colour, or null if no position does. Lets the test
 * check a stop belongs to the ramp without hardcoding which window of it the wordmark shows.
 */
function rampPosition(stop: Stop): number | null {
  for (let i = 0; i <= 1000; i++) {
    const t = i / 1000
    const { h, s, l } = parse(colorAt(t))
    if (Math.abs(h - stop.h) < 0.5 && Math.abs(s - stop.s) < 0.5 && Math.abs(l - stop.l) < 0.5) {
      return t
    }
  }
  return null
}

describe('the wordmark is made of the cascade ramp', () => {
  const region = brandRegion()
  const stops = gradientStops(region)

  it('declares every stop the ramp has', () => {
    // Two would reintroduce the muddy yellows that FLUO_RAMP's middle stops exist to avoid.
    expect(stops).toHaveLength(5)
  })

  it('spreads its stops evenly across the box', () => {
    expect(stops[0].at).toBe(0)
    expect(stops[stops.length - 1].at).toBe(1)
    const gaps = stops.slice(1).map((stop, i) => stop.at - stops[i].at)
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 3)
  })

  it('paints colours that sit on the ramp, not near it', () => {
    // Every stop is matched back to the position on the ramp that produced it. A hand-picked hue
    // that merely looks similar would find no position within tolerance, which is the drift this
    // guards against: the logo must be made of the same ramp the cables are.
    for (const stop of stops) {
      expect(rampPosition(stop)).not.toBeNull()
    }
  })

  it('reads a window onto the ramp rather than its full sweep', () => {
    // Deep green against hot orange across three glyphs reads as two colours fighting. The window
    // may be retuned, but it should stay a window — this fails if the ends creep back out.
    const first = rampPosition(stops[0])!
    const last = rampPosition(stops[stops.length - 1])!
    expect(first).toBeGreaterThan(0.05)
    expect(last).toBeLessThan(0.95)
    expect(last).toBeGreaterThan(first)
  })

  it('samples that window in order, so the gradient never doubles back', () => {
    const positions = stops.map((stop) => rampPosition(stop)!)
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1])
    }
  })

  it('turns a whole revolution, which is what lets the loop close without a seam', () => {
    // Anything other than a full turn lands on a different angle than it started from, and the jump
    // back is exactly the visible stripe this replaced.
    const initial = region.match(/initial-value:\s*(-?[\d.]+)deg/)
    const target = region.match(/--brand-angle:\s*(-?[\d.]+)deg/)
    expect(initial).not.toBeNull()
    expect(target).not.toBeNull()
    expect(Math.abs(Number(target![1]) - Number(initial![1])) % 360).toBe(0)
    expect(Number(target![1])).not.toBe(Number(initial![1]))
  })

  it('registers the angle, or the browser would snap it instead of sweeping it', () => {
    // An unregistered custom property is not interpolable: it flips at the halfway mark.
    expect(region).toContain('@property --brand-angle')
    expect(region).toMatch(/syntax:\s*'<angle>'/)
  })

  it('keeps the gradient visible where @property is missing', () => {
    // Without a fallback the whole background-image is invalid, and transparent text over no
    // background is an invisible wordmark.
    expect(region).toMatch(/var\(--brand-angle,\s*[\d.]+deg\)/)
  })

  it('does not tile, because a tiled ramp shows a crease where it turns round', () => {
    expect(region).not.toContain('repeating-linear-gradient')
  })

  it('holds still for anyone who asked for less motion', () => {
    expect(region).toContain('prefers-reduced-motion')
  })
})
