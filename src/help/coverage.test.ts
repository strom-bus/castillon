import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { detailTerms, MANUAL } from './manual'

/**
 * That the manual actually names every control the inspector shows.
 *
 * The manual claims to go control by control, and that claim rots the moment somebody adds a slider.
 * Nothing about adding one looks wrong: the panel gains a control, the manual keeps describing the
 * panel it used to be, and both files pass every test they had. So this reads the panel's own source
 * for the labels it renders and asks the manual to have said each of them.
 *
 * It reads the file as text rather than rendering the component, because a rendered panel only shows
 * the controls the current state calls for — Root appears with a scale, Roll with a second hit, and
 * every effect's parameters only under that effect. The labels that matter here are all of them.
 */

const PANEL = readFileSync('src/ui/Inspector.tsx', 'utf8')
/*
 * The effects table as well, and it is not an optional extra.
 *
 * An effect names itself there and may rename any control it borrows — Echo's Spread, Phaser's Centre,
 * the bitcrusher's Decimate. Reading only the panel found the generic name and missed every one of those,
 * which is exactly the drift this file exists to catch.
 */
const EFFECTS = readFileSync('src/audio/effects.ts', 'utf8')

/** Every label the panel puts on a control, however it happens to be written in the source. */
function labelsOn(source: string): string[] {
  const found = new Set<string>()
  const patterns = [
    // <Slider label="Gate" /> and its typed cousin.
    /\blabel="([^"]+)"/g,
    // An effect renaming one of its own: label={name('Decimate')}.
    /\bname\('([^']+)'\)/g,
    // A select or a checkbox, which says its name in a span rather than in a prop.
    /<span(?: className="inspector-label")?>([A-Z][^<{]*?)<\/span>/g,
    // An effect's own name, and any control it renames: labels: { width: 'Spread' }.
    /\blabel: '([^']+)'/g,
    /\blabels: \{([^}]*)\}/g,
  ]
  for (const pattern of patterns) {
    for (const [, label] of source.matchAll(pattern)) {
      // A rename block yields several at once, so each capture is split before it is taken.
      for (const clean of label.split(/[,:]/).map((part) => part.trim().replace(/^'|'$/g, ''))) {
        // Values, keys and running prose, none of which is the name of a control on screen.
        if (/^[A-Z]/.test(clean) && clean.length < 20) found.add(clean)
      }
    }
  }
  return [...found]
}

/**
 * Controls the manual is allowed not to name, each for a reason that would not apply to a slider.
 *
 * Kept short on purpose. A list like this is where coverage goes to die, so anything on it has to be
 * something a reader would not look up.
 */
const NOT_A_CONTROL = new Set([
  // The panel's own headings, which the manual carries as group titles rather than as entries.
  'SEQUENCE',
  'VOICE',
  'SHAPE',
  'FILTER',
  'NEXT',
  'THIS STEP',
  // A breadcrumb, not a control.
  'STP',
])

describe('the manual against the panel', () => {
  const written = MANUAL.flatMap((section) => [
    ...section.body.map((passage) => passage.en),
    ...(section.terms ?? []).flatMap((term) => [term.term.en, term.text.en]),
    ...detailTerms(section).flatMap((term) => [term.term.en, term.text.en]),
  ]).join('\n')

  it('names every control the inspector renders', () => {
    const missing = [...labelsOn(PANEL), ...labelsOn(EFFECTS)]
      .filter((label) => !NOT_A_CONTROL.has(label))
      .filter(
        (label) =>
          !new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(written),
      )

    expect(missing, `not in the manual: ${missing.join(', ')}`).toEqual([])
  })

  it('found labels to check, so a broken reader cannot pass by finding none', () => {
    // The failure this whole file would otherwise have: a regex that stops matching, an empty list, and
    // a green test that has checked nothing at all.
    expect(labelsOn(PANEL).length).toBeGreaterThan(40)
    expect(labelsOn(EFFECTS).length).toBeGreaterThan(10)
  })

  it('gives every chapter of a module its groups, in the panel order', () => {
    // A chapter whose entries are one flat list is a list. The point of the groups is that reading the
    // manual and looking at the panel are the same act, so the module with five groups has five.
    const osc = MANUAL.find((section) => section.id === 'osc')!
    const titled = (osc.detail ?? []).map((group) => group.title).filter(Boolean)
    expect(titled).toEqual(['SEQUENCE', 'VOICE', 'SHAPE', 'FILTER', 'NEXT'])
  })

  it('has a chapter for every kind of node', () => {
    const ids = MANUAL.map((section) => section.id)
    for (const node of ['ignite', 'osc', 'delay', 'fx', 'mod', 'warp']) {
      expect(ids, `no chapter for ${node}`).toContain(node)
    }
  })
})
