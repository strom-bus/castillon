/**
 * Rules that can never be seen.
 *
 * Every node paints its edge with a `border-image` built from how deep in the cascade it sits, and a
 * `border-image` covers a `border-color` completely. So a node that has no depth — anything that hangs
 * off the side rather than standing in the cascade — can declare an idle tone and a wired tone and show
 * neither, which is what the modulator did for as long as it existed. Nothing fails: the rule is there,
 * it parses, it applies, and it is painted over.
 *
 * Read from the stylesheet as text because that is the only place this exists. The test environment
 * renders no CSS, so nothing about a component can reveal it.
 */

import { describe, expect, it } from 'vitest'
// Imported through Vite rather than read off disk, the way `brand.test.ts` already does it: the test
// needs neither Node types nor a guess about the working directory.
import css from './styles.css?raw'
import { NODE_DEFINITIONS } from '../nodes/registry'

/**
 * The node classes, taken from the registry rather than matched by shape.
 *
 * A pattern over anything beginning `.node-` also catches the small things worn *by* a node — the badge
 * that says what a warp is moving it by, for one — which have borders of their own and no gradient to
 * be covered by. Asking the registry means the list is the real one and grows with it.
 */
const NODE_CLASSES = NODE_DEFINITIONS.map((definition) => `.node-${definition.type}`)

/**
 * Every rule in the sheet, as its selector and its body.
 *
 * Comments are stripped first, and that is not tidiness: the selector capture reaches back to the
 * previous `}`, so a rule with a comment above it — which is most of them here — comes out with the
 * comment glued to the front of its selector. Matching one by name then silently finds nothing, and a
 * test looking for a rule that "does not animate" passes because it found no rule at all.
 */
function rules(): Array<{ selector: string; body: string }> {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const found: Array<{ selector: string; body: string }> = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(bare))) {
    found.push({ selector: match[1]!.trim(), body: match[2]! })
  }
  return found
}

/** Every rule whose selector mentions a class, since a state often lives in a rule of its own. */
function rulesFor(className: string): Array<{ selector: string; body: string }> {
  return rules().filter((one) => new RegExp(`\\${className}(?![\\w-])`).test(one.selector))
}

describe('a node that sets its own border colour', () => {
  it('has switched off the gradient that would cover it', () => {
    const all = rules()

    /** Which node classes turn the depth gradient off anywhere at all. */
    const cleared = new Set<string>()
    for (const rule of all) {
      if (!rule.body.includes('border-image: none')) continue
      for (const name of NODE_CLASSES) if (rule.selector.includes(name)) cleared.add(name)
    }

    const masked: string[] = []
    for (const rule of all) {
      if (!/border-color:|border: 1px solid/.test(rule.body)) continue
      for (const name of NODE_CLASSES) {
        if (rule.selector.includes(name) && !cleared.has(name)) {
          masked.push(`${rule.selector} — ${name}`)
        }
      }
    }

    expect(masked).toEqual([])
  })
})

/**
 * That the cables look the way the manual says they look.
 *
 * Four kinds told apart by behaviour rather than by colour, which is a promise made in three places — the
 * README's table, the manual's chapter on reading the picture, and the type's own comment — and kept in
 * exactly one: this stylesheet. Nothing connects the two, so a dash length edited here quietly turns the
 * prose into a description of a previous version, and no test would notice.
 *
 * Read as text for the same reason the rules above are: the test environment renders no CSS, so nothing
 * about a component can reveal what it would have looked like.
 */
describe('the four cables, against what is written about them', () => {
  /** Everything declared for a class, its state rules included, as one body to read. */
  const rule = (className: string) =>
    rulesFor(className)
      .map((one) => one.body)
      .join('\n')
  const width = (selector: string) => Number(/stroke-width:\s*([\d.]+)/.exec(rule(selector))?.[1])
  const dashes = (selector: string) =>
    (/stroke-dasharray:\s*([^;]+)/.exec(rule(selector))?.[1] ?? '').trim().split(/\s+/).map(Number)

  it('draws audio thicker than the trigger it crosses', () => {
    // "Thin, and they flow" against "thicker, and they glow". A reader is told to tell them apart by
    // weight, so the weights have to differ in the direction claimed.
    expect(width('.edge-signal')).toBeGreaterThan(width('.edge-base'))
  })

  it('dots modulation and dashes a warp, which are different things to look at', () => {
    /*
     * Both are broken lines, and the prose promises they read differently: modulation is *dotted* and a
     * warp is *dashed*. That holds only while the mod gap is short and round and the warp dash is long —
     * two values in one file away from being the same picture with two names.
     */
    const [modOn, modOff] = dashes('.edge-mod')
    const [warpOn, warpOff] = dashes('.edge-warp')

    expect(modOn).toBeLessThan(2)
    expect(modOff).toBeGreaterThan(modOn! * 2)
    expect(rule('.edge-mod')).toContain('stroke-linecap: round')

    // A warp's marks are long enough to read as dashes, and much longer than a dot.
    expect(warpOn).toBeGreaterThan(4)
    expect(warpOn).toBeGreaterThan(modOn! * 4)
    expect(warpOff).toBeGreaterThan(1)
  })

  it('leaves the warp cable completely still', () => {
    /*
     * The one promise about a cable that is about what it does *not* do. Everything a WARP changes lands
     * on the next pass, so a cable that moved would be advertising something live — and the first version
     * of it breathed like a modulation cable for exactly that reason.
     */
    expect(rulesFor('.edge-warp').length).toBeGreaterThan(0)
    for (const { selector, body } of rulesFor('.edge-warp')) {
      expect(body, `${selector} animates`).not.toMatch(/animation/)
      expect(body, `${selector} transitions`).not.toMatch(/transition/)
    }
  })

  it('moves the other three, each in the way it is described as moving', () => {
    // The other half of the check above: if nothing animated, "completely still" would be true of the
    // warp cable and true of everything else, and would have stopped meaning anything.
    expect(rule('.edge-pulse')).toMatch(/animation:\s*travel/)
    expect(
      rules().some((one) => one.selector.includes('.edge-mod') && /animation/.test(one.body)),
    ).toBe(true)
    expect(rule('.edge-signal')).toMatch(/transition/)
  })

  it('colours the cascade and nothing else', () => {
    /*
     * The reading rule the manual now states: coloured lines are the order things happen in, grey ones
     * are everything else. A trigger cable takes its stroke from a gradient built per edge in
     * `CascadeEdge`, so the only thing this file can say about it is that the side cables do not paint
     * themselves anything but the neutral tones.
     */
    for (const selector of ['.edge-signal', '.edge-mod', '.edge-warp']) {
      const stroke = /stroke:\s*([^;]+)/.exec(rule(selector))?.[1]?.trim()
      expect(stroke, `${selector} is not neutral`).toMatch(/var\(--(muted|text|accent-dim)\)/)
    }
  })
})
