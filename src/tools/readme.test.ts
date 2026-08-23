import { describe, expect, it } from 'vitest'
import readme from '../../README.md?raw'
import { EFFECTS } from '../audio/effects'
import { WAVEFORMS } from '../audio/waveforms'
import { detailTerms, MANUAL } from '../help/manual'
import { NODE_DEFINITIONS } from '../nodes/registry'
import { PRESETS } from '../presets/presets'
import { encodePatch, decodePatch } from '../state/patchCode'
import { INITIAL_PATCH_CODE } from '../state/patchStore'
import { EDGE_KINDS_IN_ORDER } from './readmeFacts'

/**
 * That the README still describes this version of the instrument.
 *
 * Every count in it was written when it was true and none of them knows when it stops being. Auditing by
 * hand found four that had drifted — a ceiling described as fifty times its old value when it is
 * twenty-eight, a reverb priced at fifty voices when it is forty, a patch code quoted at 150 characters
 * when it is 127 against JSON quoted at 2700 when it is 3243, and a load-test patch still called
 * twenty-four oscillators after it became forty-eight. None of those broke anything. All of them told a
 * reader something that was not so.
 *
 * Only the mechanically checkable claims are here, which is the honest limit: a sentence about *why* a
 * decision was made cannot be tested, and pretending otherwise would mean writing prose to suit a
 * regular expression. What can be checked is every number that is really a fact about the code.
 */

/** Numbers as English, since that is how prose says them. */
const WORDS: Record<number, string> = {
  4: 'four',
  7: 'seven',
  14: 'fourteen',
  6: 'six',
  10: 'ten',
  11: 'eleven',
  13: 'thirteen',
}

const says = (text: string) => readme.toLowerCase().includes(text.toLowerCase())

/** Small numbers as English words, for reading a count out of prose and comparing it with a count. */
const UNITS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** Only the range prose here uses: a hundred and something. Anything else is a test that should change. */
function spellOut(value: number): string {
  expect(value, 'spellOut only covers 100 to 199').toBeGreaterThanOrEqual(100)
  expect(value, 'spellOut only covers 100 to 199').toBeLessThan(200)

  const rest = value - 100
  if (rest === 0) return 'hundred'
  const words =
    rest < 20
      ? UNITS[rest]!
      : rest % 10 === 0
        ? TENS[Math.floor(rest / 10)]!
        : `${TENS[Math.floor(rest / 10)]}-${UNITS[rest % 10]}`
  return `hundred and ${words}`
}

describe('the README against the code', () => {
  it.each([
    ['effects', EFFECTS.length, 'effects'],
    ['waveforms', WAVEFORMS.length, 'waveforms'],
    ['presets', PRESETS.length, 'presets'],
    ['overlaid graphs', EDGE_KINDS_IN_ORDER.length, 'overlaid graphs'],
  ])('says there are %s and there are', (_what, count, noun) => {
    const word = WORDS[count]
    expect(word, `no english word for ${count}`).toBeTruthy()
    expect(says(`${word} ${noun}`), `README does not say "${word} ${noun}"`).toBe(true)
  })

  it('names every kind of node, so the palette holds no surprises', () => {
    for (const definition of NODE_DEFINITIONS) {
      expect(says(definition.label), `README never mentions ${definition.label}`).toBe(true)
    }
  })

  it('names every effect it claims to list', () => {
    /*
     * What this guards is an effect nobody wrote a word about — the bullet enumerates them, so one added
     * in silence leaves a list that is wrong rather than merely short. It does not guard the wording: the
     * README saying "ring modulation" where the panel says "Ring mod" is prose, not staleness, and a
     * check strict enough to object would be a check that dictates sentences.
     *
     * Matched on the label as it stands, with no normalising. An earlier version stripped " mod" from
     * the label, which reduced Ring mod to "ring" — loose enough that an effect called Ring anything
     * would have passed for it.
     */
    for (const descriptor of EFFECTS) {
      expect(says(descriptor.label), `README never mentions the ${descriptor.label} effect`).toBe(
        true,
      )
    }
  })

  it('counts the manual right, in chapters and in entries', () => {
    /*
     * The entry count is *read out of the prose* rather than compared against a number written here.
     * Writing it here would be the same mistake in a second file — and this test caught its own author
     * doing it: adding one entry about the cables left the README at a hundred and fourteen when there
     * were a hundred and fifteen, and the first version of this test asserted 114 as though that were a
     * fact about the code.
     */
    expect(says(`${WORDS[MANUAL.length]} chapters`)).toBe(true)

    const written = /a (hundred(?: and [a-z-]+)?) entries/.exec(readme)?.[1]
    expect(written, 'the README does not say how many entries the manual has').toBeTruthy()

    const entries = MANUAL.reduce((sum, section) => sum + detailTerms(section).length, 0)
    expect(spellOut(entries), `the manual has ${entries} entries`).toBe(written)
  })

  it('quotes the starting patch at the size it actually is', () => {
    /*
     * Both halves drifted at once and in opposite directions, which is what makes this worth a test: the
     * code got shorter as fields learned to cost nothing at rest, and the JSON got longer as parameters
     * were added. A claim about a ratio is exactly the kind that rots quietly.
     */
    const patch = decodePatch(INITIAL_PATCH_CODE)!
    const code = encodePatch(patch).length
    const json = JSON.stringify(patch).length

    expect(says(`${code} characters`), `the code is ${code} characters`).toBe(true)
    expect(says(`${json} as JSON`), `the JSON is ${json} characters`).toBe(true)
  })

  it('quotes the ceiling multiple as the numbers give it', () => {
    // It was a hundred points before anybody measured. The multiple is a fact about MAX_LOAD, and it
    // was written as "about fifty times" while the ceiling was believed to be higher than it is.
    expect(says('twenty-eight times that')).toBe(true)
  })
})
