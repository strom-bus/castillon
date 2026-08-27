import { describe, expect, it } from 'vitest'
import styles from './styles.css?raw'

/**
 * Hover rules that move something, and where they are allowed to live.
 *
 * On a touch screen `:hover` sticks after a tap. Every hover in this sheet does that, and most only
 * change a colour — which reads as "this one is selected" and is survivable. One that applies a
 * **transform** is not: the thing moves and then stays moved, which does not look like a hover state
 * left on, it looks like the control broke.
 *
 * That is how it was found. The die tilts twelve degrees on a hover, and on a phone it tilted once and
 * stayed there — reported as "the die jams", and blamed on Safari, which had nothing to do with it. The
 * argument for gating had already been written for the gallery button's label and not applied one
 * screen away, which is the recurring shape here: a fact stated once and not carried to its second case.
 */

/** Every rule whose selector mentions `:hover`, with whether a pointer-gated block encloses it. */
function hoverRules(): { selector: string; body: string; gated: boolean }[] {
  const found: { selector: string; body: string; gated: boolean }[] = []
  // Depths at which a `(hover: hover)` block was opened, so nesting is tracked rather than assumed.
  const gates: number[] = []
  let depth = 0
  let start = 0

  for (let i = 0; i < styles.length; i++) {
    if (styles[i] === '{') {
      const head = styles.slice(start, i)
      if (head.includes('@media') && /hover:\s*hover/.test(head)) gates.push(depth)
      else if (head.includes(':hover') && !head.includes('@media')) {
        const end = styles.indexOf('}', i)
        found.push({
          selector: head.trim().split('\n').at(-1)!.trim(),
          body: styles.slice(i + 1, end),
          gated: gates.length > 0,
        })
      }
      depth++
      start = i + 1
    }
    if (styles[i] === '}') {
      depth--
      if (gates.at(-1) === depth) gates.pop()
      start = i + 1
    }
  }
  return found
}

describe('a hover that moves something', () => {
  const rules = hoverRules()

  it('found hover rules at all, so a broken reader cannot pass by finding none', () => {
    // The failure this whole file would otherwise have: a parser that returns nothing and reports green.
    expect(rules.length).toBeGreaterThan(10)
    expect(rules.some((rule) => rule.gated)).toBe(true)
  })

  it('never sits outside a pointer-gated block', () => {
    const moving = rules
      .filter((rule) => /transform:/.test(rule.body) && !/transform:\s*none/.test(rule.body))
      .filter((rule) => !rule.gated)
      .map((rule) => rule.selector)

    expect(moving, `these stay moved after a tap: ${moving.join(', ')}`).toEqual([])
  })
})
