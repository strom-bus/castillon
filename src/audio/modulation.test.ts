import { describe, expect, it } from 'vitest'
import { EFFECTS } from './effects'
import {
  amountFor,
  PULSE_RATE_CEILING,
  resolveTarget,
  silentBecause,
  targetOf,
  targetsFor,
} from './modulation'

/**
 * What a MOD can point at, and what happens when the answer changes underneath it — which is the
 * problem PLAN §18.4 named: a target is a name, and a name can stop existing.
 */

describe('targetsFor', () => {
  it('offers an oscillator its output, its pitch and its filter', () => {
    expect(targetsFor('osc').map((t) => t.key)).toEqual(['level', 'pitch', 'cutoff', 'resonance'])
  })

  it('opens on level, since that is what a fallback lands on', () => {
    // Not decoration: `resolveTarget` picks `level` by name now, and a list whose first entry is
    // something else would put the panel and the fallback out of step with each other.
    expect(targetsFor('osc')[0]!.key).toBe('level')
  })

  it('offers level first from every destination there is', () => {
    /*
     * The invariant the fallback rests on, asserted over every list rather than over one.
     *
     * My first attempt at this reversed a *copy* of the oscillator's list and asserted against that,
     * which the function never sees — a test that could not fail for the thing it named. What actually
     * keeps a lost target landing somewhere audible is that level is on every destination and at the head
     * of every list, so this asks that of all thirteen.
     */
    const lists = [targetsFor('osc'), ...EFFECTS.map((effect) => targetsFor('fx', effect.kind))]
    expect(lists.length).toBeGreaterThan(10)
    for (const list of lists) {
      expect(list.map((target) => target.key)).toContain('level')
      expect(list[0]!.key).toBe('level')
    }
  })

  it("gives an oscillator's cutoff the same range an effect's has", () => {
    // One depth control, so the same name has to mean the same span wherever it is pointed.
    const onOsc = targetsFor('osc').find((t) => t.key === 'cutoff')!
    const onFx = targetsFor('fx', 'filter').find((t) => t.key === 'cutoff')!
    expect([onOsc.min, onOsc.max]).toEqual([onFx.min, onFx.max])
  })

  it("offers a reverb's own decay, which is the point of the whole table", () => {
    const keys = targetsFor('fx', 'reverb').map((t) => t.key)
    expect(keys).toContain('decay')
    expect(keys).toContain('cutoff')
  })

  it("offers a chorus its own sweep, and not a reverb's decay", () => {
    const keys = targetsFor('fx', 'chorus').map((t) => t.key)
    expect(keys).toContain('sweep')
    expect(keys).toContain('rate')
    expect(keys).not.toContain('decay')
  })

  it('always offers the two the engine owns', () => {
    for (const effect of ['reverb', 'chorus', 'pan', 'crush'] as const) {
      const keys = targetsFor('fx', effect).map((t) => t.key)
      expect(keys.slice(0, 2)).toEqual(['level', 'mix'])
    }
  })

  it('uses the name the effect gives a parameter, not the generic one', () => {
    // A phaser calls its cutoff Centre, and the panel should say what the effect says.
    const centre = targetsFor('fx', 'phaser').find((t) => t.key === 'cutoff')
    expect(centre?.label).toBe('Centre')
  })

  it('leaves out the parameters a wave has nothing to say to', () => {
    // Choices from a list: a smooth sweep cannot mean anything to a filter type.
    expect(targetsFor('fx', 'filter').map((t) => t.key)).not.toContain('filterType')
    expect(targetsFor('fx', 'distortion').map((t) => t.key)).not.toContain('shape')
  })

  it('says how each target is reached, since not all of them are AudioParams', () => {
    const decay = targetOf('decay', 'fx', 'reverb')
    const cutoff = targetOf('cutoff', 'fx', 'filter')
    // A decay rebuilds an impulse response, so nothing can be connected to it.
    expect(decay?.via).toBe('value')
    expect(cutoff?.via).toBe('audio')
  })

  it('carries a range for every target, because depth is a share of it', () => {
    for (const effect of ['reverb', 'echo', 'chorus', 'filter', 'pan', 'crush'] as const) {
      for (const target of targetsFor('fx', effect)) {
        expect(target.max).toBeGreaterThan(target.min)
      }
    }
  })

  it('offers nothing on anything else, so a MOD cannot point at a cascade', () => {
    expect(targetsFor('start')).toEqual([])
    expect(targetsFor('hold')).toEqual([])
    expect(targetsFor('mod')).toEqual([])
    expect(targetsFor(undefined)).toEqual([])
  })
})

describe('amountFor', () => {
  it('scales depth to the target, so one control means the same thing everywhere', () => {
    // Depth 1 on a cutoff has to be thousands of hertz; on a mix it has to be half of one.
    const cutoff = targetOf('cutoff', 'fx', 'filter')!
    const mix = targetOf('mix', 'fx', 'filter')!
    expect(amountFor(cutoff, 1)).toBeGreaterThan(1000)
    expect(amountFor(mix, 1)).toBeCloseTo(0.5, 3)
  })

  it('is nothing at depth zero and clamped past one', () => {
    const cutoff = targetOf('cutoff', 'fx', 'filter')!
    expect(amountFor(cutoff, 0)).toBe(0)
    expect(amountFor(cutoff, 5)).toBe(amountFor(cutoff, 1))
  })
})

describe('resolveTarget', () => {
  it('keeps a target the destination offers', () => {
    expect(resolveTarget('mix', 'fx', 'reverb')).toBe('mix')
    expect(resolveTarget('decay', 'fx', 'reverb')).toBe('decay')
    expect(resolveTarget('level', 'osc')).toBe('level')
  })

  it('falls back rather than going silent when the target is not there', () => {
    // A MOD set to Mix and wired to an oscillator: Mix does not exist on one, and doing nothing at
    // all would look like a broken cable rather than a mismatch.
    expect(resolveTarget('mix', 'osc')).toBe('level')
    // And the case that happens in practice: an effect changed under a MOD pointed at its decay.
    expect(resolveTarget('decay', 'fx', 'chorus')).toBe('level')
  })

  it('falls back when nothing was chosen at all', () => {
    expect(resolveTarget(undefined, 'fx', 'reverb')).toBe('level')
  })

  it('resolves to nothing where there is nothing to modulate', () => {
    // Which is how a cable to the wrong kind of node ends up doing nothing instead of throwing.
    expect(resolveTarget('level', 'hold')).toBeNull()
    expect(resolveTarget('level', undefined)).toBeNull()
  })
})

describe('the pulse ceiling', () => {
  it('stops well below where a cable would strobe', () => {
    // §18.6: past this nobody sees individual cycles, and a flashing cable reads as broken.
    expect(PULSE_RATE_CEILING).toBeGreaterThan(1)
    expect(PULSE_RATE_CEILING).toBeLessThan(15)
  })
})

describe('silentBecause', () => {
  const osc = (filterType: string) => ({ nodeType: 'osc', filterType })

  it('reports a filter target on an oscillator whose filter is off', () => {
    expect(silentBecause('cutoff', osc('off'))).toContain('filter is off')
    expect(silentBecause('resonance', osc('off'))).toContain('filter is off')
  })

  it('says nothing while the filter is on', () => {
    expect(silentBecause('cutoff', osc('lowpass'))).toBeNull()
    expect(silentBecause('resonance', osc('bandpass'))).toBeNull()
  })

  it('leaves the level alone, which does not pass through the filter', () => {
    expect(silentBecause('level', osc('off'))).toBeNull()
  })

  it("says nothing about an effect's cutoff, which is not per voice", () => {
    // An FX filter exists whatever the oscillator feeding it is doing.
    expect(silentBecause('cutoff', { nodeType: 'fx', effect: 'filter' })).toBeNull()
  })

  it('says nothing when there is no destination at all', () => {
    expect(silentBecause('cutoff', {})).toBeNull()
  })
})
