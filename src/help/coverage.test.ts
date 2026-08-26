import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { EFFECTS as EFFECT_TABLE } from '../audio/effects'
import { NODE_DEFINITIONS } from '../nodes/registry'
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

describe('the build the manual names', () => {
  /**
   * The one line in the manual that is not written by hand.
   *
   * It exists so that a report can name a build, which means the failure mode is not a wrong answer but
   * a *placeholder* — a substitution that stopped happening leaves the manual telling a stranger that
   * this build is called `__BUILD__`, and nothing else in the project would notice. Every other test
   * here reads prose that a person typed.
   */
  const entry = MANUAL.at(-1)!
    .detail?.flatMap((group) => group.terms)
    .find((term) => term.term.en === 'Which build this is')

  it('is in the manual at all', () => {
    expect(entry, 'the last chapter no longer names the build').toBeTruthy()
  })

  it('was substituted, in both languages', () => {
    for (const text of [entry!.text.en, entry!.text.es]) {
      expect(text).not.toContain('__BUILD__')
      expect(text).not.toContain('${')
    }
  })

  it('names something rather than nothing', () => {
    /*
     * `dev` is a legitimate answer — a checkout with no history is a real way to run this — so what is
     * asserted is that the name is *there*, not what it says. An empty one would read as "This one is
     * ** —" and mean nothing to whoever was asked to read it out.
     */
    const named = /\*\*(.+?)\*\*/.exec(entry!.text.en)?.[1] ?? ''
    expect(named.length).toBeGreaterThan(2)
  })
})

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

  it('gives every chapter the groups its panel has, in the panel order', () => {
    /*
     * A chapter whose entries are one flat list is a list. The point of the groups is that reading the
     * manual and looking at the panel are the same act.
     *
     * Asked of the panel's own source rather than of a list. This used to name the oscillator's five
     * groups by hand, which was every group there was — so the day two more panels were grouped it went
     * on passing and said nothing about either. The same fault as every other coverage list in this
     * repository, in the file whose whole job is catching it.
     *
     * Every branch of the panel, and where each begins. The oscillator is the **fallback** rather than a
     * branch — what the function returns once every other type is ruled out — so it has no `node.type ===`
     * test of its own, and the last real branch would otherwise swallow it and inherit its five groups.
     * Found by the line that begins it instead, which is where the panel stops asking what the node is.
     */
    const branches = [...PANEL.matchAll(/if \(node\.type === '(\w+)'\)/g)].map((m) => ({
      type: m[1],
      at: m.index ?? 0,
    }))
    const oscAt = PANEL.indexOf('const params = node.data.params as OscParams')
    expect(oscAt, 'the oscillator panel could not be found').toBeGreaterThan(0)
    branches.push({ type: 'osc', at: oscAt })
    branches.sort((a, b) => a.at - b.at)

    expect(
      branches.length,
      'no panel branches found — the reader has stopped working',
    ).toBeGreaterThan(4)

    for (const [index, branch] of branches.entries()) {
      const to = branches[index + 1]?.at ?? PANEL.length
      const drawn = [...PANEL.slice(branch.at, to).matchAll(/<Group title="([^"]+)">/g)].map(
        (m) => m[1],
      )

      // `start` in the registry, `ignite` on the page: the type reads better in a stack trace and the
      // label reads better on screen, and the registry holds both on purpose.
      const chapter = MANUAL.find(
        (section) => section.id === (branch.type === 'start' ? 'ignite' : branch.type),
      )
      if (!chapter) continue
      const written = (chapter.detail ?? []).map((group) => group.title).filter(Boolean)

      /*
       * Every group the panel has must be in the manual, in the same order. **One direction only**: the
       * manual is allowed more, because it has room to explain what a control cannot — the FX chapter
       * documents fifteen effects as a section of their own where the panel packs them into a select, and
       * demanding an exact match would mean deleting that.
       *
       * What this catches is the direction that matters: a heading somebody added to a panel and never
       * wrote up, or wrote up in a different order. Those are the two ways looking at the panel and
       * reading the page stop being the same act.
       */
      let at = 0
      for (const title of drawn) {
        const found = written.indexOf(title, at)
        expect(
          found,
          `${branch.type}: the panel's ${title} group is not in the manual, in order`,
        ).toBeGreaterThanOrEqual(0)
        at = found + 1
      }
    }
  })

  it('renders a control for every parameter an effect declares', () => {
    /*
     * The mirror of the manual check above, and the direction nothing was looking in. That one asks
     * *panel → manual*: every label on screen must be written up. Nothing asked *effect → panel*, so a
     * parameter could be declared, stored in the patch code, reachable by a MOD and have **no control at
     * all** — which is exactly what the EQ's three bands shipped as, and the whole suite stayed green
     * because a control that does not exist renders no label to check.
     *
     * Read out of the source for the same reason the labels are: the panel only renders the parameters
     * the current effect declares, and the ones that matter here are all of them.
     */
    const missing: string[] = []
    for (const descriptor of EFFECT_TABLE) {
      for (const param of descriptor.params) {
        if (!new RegExp(`case '${String(param)}':`).test(PANEL)) {
          missing.push(`${descriptor.kind}.${String(param)}`)
        }
      }
    }
    expect(missing, `declared but not shown: ${missing.join(', ')}`).toEqual([])
  })

  it('found effects with parameters to check, so an empty table cannot pass', () => {
    expect(EFFECT_TABLE.flatMap((descriptor) => descriptor.params).length).toBeGreaterThan(20)
  })

  it("reads its node chapters in the palette's own order", () => {
    /*
     * The manual says in as many words that each node "has its own chapter here, in the order the palette
     * is in". That sentence was true when it was written and nothing was holding it to the palette — so
     * reordering one and not the other leaves a claim that reads as fact and is not, which is this file's
     * whole subject.
     *
     * Only the chapters that *are* nodes take part. The manual has others between them — the step editor
     * sits inside the oscillator's half of the book — and demanding they line up would be demanding the
     * manual be a list of nodes, which it is not.
     */
    const chapters = MANUAL.map((section) => section.id)
    const wanted = NODE_DEFINITIONS.map((definition) =>
      definition.type === 'start' ? 'ignite' : definition.type,
    ).filter((id) => chapters.includes(id))
    const written = chapters.filter((id) => wanted.includes(id))

    expect(written, 'the manual orders its node chapters differently from the palette').toEqual(
      wanted,
    )
    expect(wanted.length).toBeGreaterThan(5)
  })

  it('has a chapter for every kind of node, asked of the registry and not of a list', () => {
    /*
     * The list this replaced had six entries and the registry had seven — the SIEVE shipped, the list
     * was never extended, and a test named "for every kind of node" happily checked six of them. Every
     * hand-written list in a coverage test is a second declaration of what exists, and this file exists
     * because a second declaration always falls behind the first.
     *
     * The manual keys its chapters by name rather than by node type, so the one mapping that cannot be
     * derived is `start` → `ignite`: the type reads better in a stack trace and the label reads better
     * on screen, and the registry deliberately holds both.
     */
    const ids = new Set(MANUAL.map((section) => section.id))
    const missing = NODE_DEFINITIONS.map((definition) =>
      definition.type === 'start' ? 'ignite' : definition.type,
    ).filter((id) => !ids.has(id))

    expect(missing, `no chapter for: ${missing.join(', ')}`).toEqual([])
    expect(NODE_DEFINITIONS.length).toBeGreaterThan(5)
  })
})
