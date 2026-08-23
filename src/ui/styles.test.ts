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

/** Every rule in the sheet, as its selector and its body. */
function rules(): Array<{ selector: string; body: string }> {
  const found: Array<{ selector: string; body: string }> = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(css))) {
    found.push({ selector: match[1]!.trim(), body: match[2]! })
  }
  return found
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
