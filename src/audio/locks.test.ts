import { describe, expect, it } from 'vitest'
import { defaultOscParams, lockedFor } from '../nodes/registry'
import { oscVoiceCost, voiceCost } from './load'
import { decodePatch, encodePatch } from '../state/patchCode'
import type { OscParams, Patch, PatchNode, Step } from '../types/patch'

/**
 * A step that takes one of its oscillator's settings over for itself.
 *
 * Four things can be locked and the whole feature rests on one rule: **absent means the node's.** Get
 * that wrong in either direction and nothing looks broken — a lock that is ignored plays the node's
 * value on a step that was set differently, and a lock that is invented plays a step's value on fifteen
 * steps that never asked for one. Both are silent, and both are a sequence that is not what is written.
 */

const step = (over: Partial<Step> = {}): Step => ({
  note: 60,
  active: true,
  velocity: 1,
  ...over,
})

const params = (over: Partial<OscParams> = {}): OscParams => ({
  ...defaultOscParams(),
  waveform: 'square',
  cutoff: 1200,
  gate: 0.4,
  decay: 200,
  ...over,
})

describe('what a step takes over', () => {
  it('follows the oscillator in all four where it says nothing', () => {
    expect(lockedFor(params(), step())).toEqual({
      waveform: 'square',
      cutoff: 1200,
      gate: 0.4,
      decay: 200,
    })
  })

  it('overrules it, one at a time and independently', () => {
    // Independently is the half that would fail quietly: one `??` chain reaching for the wrong key gives
    // three parameters from the step and the fourth from the node, for ever.
    expect(lockedFor(params(), step({ waveform: 'sawtooth' })).waveform).toBe('sawtooth')
    expect(lockedFor(params(), step({ cutoff: 6000 })).cutoff).toBe(6000)
    expect(lockedFor(params(), step({ gate: 1 })).gate).toBe(1)
    expect(lockedFor(params(), step({ decay: 40 })).decay).toBe(40)

    // And a step that locks one leaves the other three alone.
    const one = lockedFor(params(), step({ cutoff: 6000 }))
    expect(one.waveform).toBe('square')
    expect(one.gate).toBe(0.4)
    expect(one.decay).toBe(200)
  })

  it('takes a locked nought as a value rather than as silence', () => {
    /*
     * The case that decides whether the rule is "absent" or "falsy", and the two come apart on exactly
     * one setting: a decay of nought means *hold the peak until the note ends*, which is a thing people
     * want on one step of sixteen. Read as "unset" it would silently play the node's decay instead.
     */
    expect(lockedFor(params({ decay: 900 }), step({ decay: 0 })).decay).toBe(0)
  })
})

describe('a locked step through the wire format', () => {
  function roundTrip(steps: Step[]): Step[] {
    const osc: PatchNode = {
      id: 'o',
      type: 'osc',
      position: { x: 0, y: 0 },
      params: params({ steps }),
    }
    const patch: Patch = { version: 1, bpm: 120, loop: true, nodes: [osc], edges: [] }
    const back = decodePatch(encodePatch(patch))
    return (back!.nodes[0]!.params as OscParams).steps
  }

  it('carries all four, and carries them on the right steps', () => {
    const [first, second, third] = roundTrip([
      step({ waveform: 'white', cutoff: 5000 }),
      step({ gate: 0.85, decay: 640 }),
      step(),
    ])

    expect(first!.waveform).toBe('white')
    expect(Math.round(first!.cutoff!)).toBeGreaterThan(4000)
    expect(second!.gate).toBeCloseTo(0.85, 2)
    expect(second!.decay).toBe(640)
    // And the one that locked nothing comes back locking nothing, rather than inheriting a neighbour's.
    expect(third!.waveform).toBeUndefined()
    expect(third!.cutoff).toBeUndefined()
    expect(third!.gate).toBeUndefined()
    expect(third!.decay).toBeUndefined()
  })

  it('keeps a locked nought, which is the one value the column has to work for', () => {
    // Everything is stored shifted by one so that nought is free to mean absent. Without the shift this
    // decay comes back undefined and the step quietly plays the node's.
    expect(roundTrip([step({ decay: 0 })])[0]!.decay).toBe(0)
  })

  it('costs a sequence that locks nothing nothing at all', () => {
    /*
     * The reason four more columns were affordable: a column every step leaves at rest is written as one
     * bit for the whole node. Four locks that nobody uses are four bits, not four per step.
     */
    const plain = { note: 60, active: true, velocity: 1 }
    const sixteen = Array.from({ length: 16 }, () => ({ ...plain }))
    const osc = (steps: Step[]): Patch => ({
      version: 1,
      bpm: 120,
      loop: true,
      nodes: [{ id: 'o', type: 'osc', position: { x: 0, y: 0 }, params: params({ steps }) }],
      edges: [],
    })

    const bare = encodePatch(osc(sixteen)).length
    const one = encodePatch(
      osc(sixteen.map((s, i) => (i === 3 ? { ...s, cutoff: 5000 } : s))),
    ).length
    const every = encodePatch(osc(sixteen.map((s, i) => ({ ...s, cutoff: 1000 + i * 200 })))).length

    // A column is written whole or not at all, so the first lock buys the column and the other fifteen
    // are free. That is the trade this design makes, and it is the right way round: locks are rare
    // across a patch and clustered within the sequence that has them.
    expect(one).toBeGreaterThan(bare)
    expect(every).toBe(one)

    // And the three columns nobody touched still cost one bit each for the whole node, which is why
    // adding four of these to every step in the format was affordable at all.
    const three = encodePatch(
      osc(sixteen.map((s, i) => (i === 3 ? { ...s, cutoff: 5000, gate: 1, decay: 0 } : s))),
    ).length
    expect(three).toBeGreaterThan(one)
  })
})

describe('what a locked waveform costs', () => {
  it('prices a sequence at its dearest step, not at its node', () => {
    /*
     * The budget is a ceiling, so the honest reading of a sequence that plays a noise on one step of
     * sixteen is the noise. Priced at the node's own waveform it is a patch that fits until the pass
     * that reaches that step.
     */
    const quiet = params({ waveform: 'square', filterType: 'off', steps: [step()] })
    const one = params({
      waveform: 'square',
      filterType: 'off',
      steps: [step(), step({ waveform: 'white' })],
    })

    expect(oscVoiceCost(quiet)).toBe(voiceCost('square', false))
    expect(oscVoiceCost(one)).toBe(voiceCost('white', false))
    expect(oscVoiceCost(one)).toBeGreaterThan(oscVoiceCost(quiet))
  })
})
