import { describe, expect, it } from 'vitest'
import styles from './styles.css?raw'

/**
 * What a phone gets, asserted by reading the sheet.
 *
 * No other kind of test can see this. jsdom does no layout and evaluates no media query, so a component
 * test renders the desktop and the phone identically — the rules are either in the file or they are
 * not, and that is the whole of what is checkable here.
 *
 * Which makes the one real risk worth naming: this proves the rules exist and says nothing about how
 * they look. A phone is the only thing that can answer that.
 */

/** The block that turns the instrument into a player, and everything inside it. */
function narrowBlock(): string {
  const at = styles.indexOf('@media (max-width: 700px)')
  expect(at, 'no width breakpoint in the sheet at all').toBeGreaterThan(-1)
  // To the closing brace of the media query, which is the last one before the file ends or the next
  // top-level rule begins. Counting braces rather than guessing, since the block holds nested rules.
  let depth = 0
  for (let i = styles.indexOf('{', at); i < styles.length; i++) {
    if (styles[i] === '{') depth++
    if (styles[i] === '}' && --depth === 0) return styles.slice(at, i)
  }
  throw new Error('the narrow block is never closed')
}

describe('a narrow screen', () => {
  const block = narrowBlock()

  it('takes away the two things that are only for building', () => {
    /*
     * The inspector is controls for a node you cannot wire, and the palette adds nodes you cannot
     * connect. Both are removed rather than shrunk: a control that is gone asks no questions, where a
     * cramped one invites an attempt that the touch screen then loses.
     */
    expect(block).toMatch(/\.inspector,\s*\.palette\s*\{\s*display:\s*none/)
  })

  it('leaves everything that is playing or reading', () => {
    // Named one by one, because the value of the block is what it does *not* take: play, the tempo, the
    // volume, the field a shared code arrives in, the manual and the gallery are all still there.
    for (const kept of ['.transport', '.titlebar']) {
      expect(block).toContain(kept)
      expect(block).not.toMatch(new RegExp(`\\${kept}[^{]*\\{[^}]*display:\\s*none`))
    }
  })

  it('wraps those rows rather than letting them run off the side', () => {
    /*
     * The specific loss this avoids: the transport ends with the code field, so a row that overflows
     * hides the one control that takes a patch somebody sent you — which is the entire reason a phone
     * has this open.
     */
    expect(block).toMatch(/\.titlebar,\s*\.transport\s*\{\s*flex-wrap:\s*wrap/)
  })

  it('is the only place the layout is told about a screen width', () => {
    /*
     * One breakpoint, so "what a phone gets" is a paragraph somebody can read rather than a behaviour
     * assembled from rules scattered through two thousand lines. The other media queries in this sheet
     * ask about the pointer and about motion, which are different questions.
     */
    const widths = styles.match(/@media[^{]*(max-width|min-width)[^{]*\{/g) ?? []
    expect(widths).toHaveLength(1)
  })
})
