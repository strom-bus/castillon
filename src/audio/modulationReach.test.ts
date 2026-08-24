import { describe, expect, it } from 'vitest'
import { EFFECTS, effectOr } from './effects'
import { fakeAudio } from './fakeAudio'
import { targetsFor } from './modulation'
import { indexedTables } from '../state/patchCode'
import type { EffectKind, FxParams } from '../types/patch'

/**
 * The agreement between what a MOD offers and what a chain hands over.
 *
 * `modulationCoverage.test.ts` asks the end-to-end question — does the engine reach this parameter —
 * and this one asks the narrower one it rests on: for each target the chain claims by name, is there
 * an `AudioParam` behind the name, and for each one that rebuilds something, is there deliberately
 * none? Getting that second half wrong is worse than the first: an `AudioParam` handed over for a
 * decay would connect a modulator to something that is not the value being modulated.
 */

const paramsFor = (kind: EffectKind): FxParams =>
  ({ effect: kind, mix: 0.8, ...effectOr(kind).defaults }) as FxParams

/**
 * Every control an effect shows, against every target a MOD offers on it.
 *
 * The gap this closes is the one the SIEVE had and the presets' coverage map had: a thing can exist,
 * be shown, and be unreachable, and every test around it passes because they all iterate the list that
 * does not mention it. The wavefolder shipped its Bias control with no entry in the parameter table, so
 * `targetsFor` quietly dropped it and no case was ever generated for it — an effect whose best control
 * could not be automated, and 1412 green tests.
 *
 * Which parameters are exempt is **derived**: a value stored as an index into a table is a choice from a
 * fixed set, and a choice is not something a signal can be added to. The wire format already records
 * exactly which fields those are, so nothing has to be listed here.
 */
describe('every control an effect shows', () => {
  const enumerated = new Set(indexedTables().map((table) => table.key))

  it('is a parameter a MOD can point at, unless it is a choice from a fixed set', () => {
    const unreachable: string[] = []
    for (const descriptor of EFFECTS) {
      const offered = new Set(targetsFor('fx', descriptor.kind).map((target) => target.key))
      for (const key of descriptor.params) {
        if (enumerated.has(key)) continue
        if (!offered.has(key)) unreachable.push(`${descriptor.kind}.${String(key)}`)
      }
    }
    expect(unreachable, `shown but unmodulatable: ${unreachable.join(', ')}`).toEqual([])
  })

  it('leaves the choices out, which is the other half of the same claim', () => {
    // Or the check above would pass by exempting everything. A filter's type and a distortion's shape are
    // switches, and offering them as modulation destinations would be offering a nonsense.
    expect(targetsFor('fx', 'filter').map((t) => t.key)).not.toContain('filterType')
    expect(targetsFor('fx', 'distortion').map((t) => t.key)).not.toContain('shape')
    expect(enumerated.size).toBeGreaterThan(5)
  })
})

describe('every offered target is reachable', () => {
  for (const descriptor of EFFECTS) {
    describe(descriptor.kind, () => {
      const offered = targetsFor('fx', descriptor.kind)

      it('offers something beyond the two the engine owns', () => {
        // Otherwise the parameter table has nothing to say about this effect, which for anything with
        // its own controls would mean the list was never wired up.
        expect(offered.length).toBeGreaterThanOrEqual(2)
      })

      it('hands over an AudioParam for each of its audio-rate targets', () => {
        const chain = descriptor.create(fakeAudio().ctx)
        chain.update(paramsFor(descriptor.kind), { at: 0, bpm: 120 })

        const missing: string[] = []
        for (const target of offered) {
          // Level and mix belong to the engine's own nodes, not to the chain.
          if (target.key === 'level' || target.key === 'mix') continue
          if (target.via !== 'audio') continue

          const reached = chain.paramFor?.(target.key) ?? null
          const any = Array.isArray(reached) ? reached.length > 0 : reached !== null
          if (!any) missing.push(target.key)
        }

        expect(missing).toEqual([])
      })

      it('answers nothing for the targets that rebuild something', () => {
        // A decay rebuilds an impulse response and a bit depth rebuilds a curve. Handing back an
        // `AudioParam` for one of those would connect a modulator to something that is not the value
        // being modulated.
        const chain = descriptor.create(fakeAudio().ctx)
        for (const target of offered) {
          if (target.via !== 'value') continue
          expect(chain.paramFor?.(target.key) ?? null).toBeNull()
        }
      })
    })
  }
})

describe('the oscillator', () => {
  it('offers its filter, which is what a modulator is usually pointed at', () => {
    const keys = targetsFor('osc').map((target) => target.key)
    expect(keys).toContain('level')
    expect(keys).toContain('cutoff')
    expect(keys).toContain('resonance')
  })
})
