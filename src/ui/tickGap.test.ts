import { describe, expect, it } from 'vitest'
import styles from './styles.css?raw'

/**
 * Where the gap between a tickbox and its word is declared.
 *
 * On the row, in all three places, and never on the box — because the box loses. The shared rule is
 * `input[type='checkbox']`, an element with an attribute selector, and that outranks a class: a
 * `margin-right` on `.lock-check` was overruled by the `margin: 0` two hundred lines above it, so the
 * four lock boxes sat against their names while Mute and Glide, whose gap is on their row, sat right.
 * One declaration losing in one place and winning in another is what a specificity fight looks like
 * from the screen, and it is invisible to every other kind of test.
 */

/** The body of one rule, by its selector. */
function ruleFor(selector: string): string {
  const at = styles.indexOf(`${selector} {`)
  expect(at, `no rule for ${selector}`).toBeGreaterThan(-1)
  return styles.slice(at, styles.indexOf('}', at))
}

describe('the gap between a tickbox and its word', () => {
  it('is on the row, wherever there is one', () => {
    for (const row of ['.inspector-check', '.inspector-field.locked .inspector-label']) {
      expect(ruleFor(row), row).toContain('gap: var(--gap-tick)')
    }
  })

  it('is never a margin on the box, which would be overruled', () => {
    expect(ruleFor('.lock-check')).not.toContain('margin')
  })

  it('is one number, so the three boxes in a panel cannot drift apart', () => {
    // Two of them read as two kinds of thing, which is the whole reason this is a token.
    expect(styles.match(/gap: var\(--gap-tick\)/g)?.length).toBeGreaterThan(1)
  })
})
