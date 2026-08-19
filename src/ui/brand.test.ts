import { describe, expect, it } from 'vitest'
import tokens from '../index.css?raw'
import styles from './styles.css?raw'
import { colorAt } from '../viz/depth'

/**
 * `_ON` is painted with the deepest colour on the cascade ramp — the hue of its furthest branch. The
 * token holding it and the ramp that generates it are two copies of one value, and two copies drift
 * apart silently: after a retune the wordmark would quietly stop matching the instrument.
 *
 * What is left of this file is small on purpose. The wordmark used to animate the whole ramp, and
 * the tests that guarded that are gone with it.
 */

function parse(color: string): { h: number; s: number; l: number } {
  const [h, s, l] = color
    .replace('hsl(', '')
    .replace(')', '')
    .replace(/%/g, '')
    .split(' ')
    .map(Number)
  return { h, s, l }
}

describe('the wordmark takes its colour from the cascade ramp', () => {
  it('is the ramp at its deepest, not a hue that merely looks like it', () => {
    const declared = tokens.match(/--brand-lit:\s*(hsl\([^)]*\))/)
    expect(declared).not.toBeNull()

    const mine = parse(declared![1])
    const deepest = parse(colorAt(1))
    expect(mine.h).toBeCloseTo(deepest.h, 0)
    expect(mine.s).toBeCloseTo(deepest.s, 0)
    expect(mine.l).toBeCloseTo(deepest.l, 0)
  })

  it('costs nothing to display, which is why the gradient went', () => {
    // A page keeping an audio scheduler fed should not repaint the titlebar every frame forever.
    // Bounded to the rule itself: the stylesheet has other animations, and they are all earned.
    const open = styles.indexOf('.brand-lit {')
    const rule = styles.slice(open, styles.indexOf('}', open))
    expect(rule).not.toContain('animation')
    expect(styles).not.toContain('brand-angle')
    expect(styles).not.toContain('background-clip')
  })
})
