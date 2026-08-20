import { describe, expect, it } from 'vitest'
import { defaultOscParams } from '../nodes/registry'
import type { FxParams, Patch, PatchEdge, PatchNode } from '../types/patch'
import { MAX_PASSES, MAX_RENDER_SECONDS, planRender } from './render'

/**
 * `planRender` is the half of the export that needs no Web Audio: it measures a lap by running the
 * real scheduler against an engine that makes no sound. So the arithmetic that decides how long a
 * file will be — the part a mistake in would silently truncate someone's music — is testable.
 */

function start(id: string): PatchNode {
  return { id, type: 'start', position: { x: 0, y: 0 }, params: {} }
}

function osc(id: string, steps?: number): PatchNode {
  const params = defaultOscParams()
  return {
    id,
    type: 'osc',
    position: { x: 0, y: 0 },
    params: steps ? { ...params, steps: params.steps.slice(0, steps) } : params,
  }
}

function edge(source: string, target: string): PatchEdge {
  return { id: `${source}->${target}`, kind: 'event', source, target }
}

function patchOf(nodes: PatchNode[], edges: PatchEdge[]): Patch {
  return { version: 1, bpm: 120, loop: true, nodes, edges }
}

/** At 120 BPM with a 1/8 division a step lasts 0.25 s, so four steps are one second. */
const SEQUENCE = 1

describe('planRender', () => {
  it('measures a lap from one Ignite firing twice', () => {
    const plan = planRender(patchOf([start('s'), osc('a')], [edge('s', 'a')]), 1)
    expect(plan.passSeconds).toBeCloseTo(SEQUENCE, 2)
  })

  it('counts a chain of oscillators as one lap, not two', () => {
    // b starts when a finishes, so the cascade is two sequences long and comes round once.
    const plan = planRender(
      patchOf([start('s'), osc('a'), osc('b')], [edge('s', 'a'), edge('a', 'b')]),
      1,
    )
    expect(plan.passSeconds).toBeCloseTo(SEQUENCE * 2, 2)
  })

  it('takes the longest cascade as the lap, so the short ones simply come round more often', () => {
    // Exactly what happens on playback: the branches drift apart, which is where the polyrhythms
    // come from. The file has to be long enough for the slowest of them.
    const plan = planRender(
      patchOf(
        [start('s1'), osc('a'), osc('b'), start('s2'), osc('c')],
        [edge('s1', 'a'), edge('a', 'b'), edge('s2', 'c')],
      ),
      1,
    )
    expect(plan.passSeconds).toBeCloseTo(SEQUENCE * 2, 2)
  })

  it('grows the file by one lap per pass asked for', () => {
    const patch = patchOf([start('s'), osc('a')], [edge('s', 'a')])
    const one = planRender(patch, 1)
    const four = planRender(patch, 4)
    expect(four.passes).toBe(4)
    expect(four.until - one.until).toBeCloseTo(SEQUENCE * 3, 2)
  })

  it('stops the scheduler short of the boundary, so no extra lap begins in the tail', () => {
    const plan = planRender(patchOf([start('s'), osc('a')], [edge('s', 'a')]), 2)
    expect(plan.until).toBeLessThan(plan.passSeconds * 2 + 0.06)
  })

  it('leaves room after the last note for tails to decay', () => {
    const plan = planRender(patchOf([start('s'), osc('a')], [edge('s', 'a')]), 1)
    expect(plan.seconds).toBeGreaterThan(plan.until)
  })

  it('gives a reverb longer to ring out than a patch without one', () => {
    const dry = planRender(patchOf([start('s'), osc('a')], [edge('s', 'a')]), 1)
    const wet = planRender(
      patchOf(
        [
          start('s'),
          osc('a'),
          {
            id: 'f',
            type: 'fx',
            position: { x: 0, y: 0 },
            params: { effect: 'reverb' } as FxParams,
          },
        ],
        [edge('s', 'a'), { id: 'a->f', kind: 'audio', source: 'a', target: 'f' }],
      ),
      1,
    )
    expect(wet.seconds).toBeGreaterThan(dry.seconds)
  })

  it('has nothing to render without an Ignite', () => {
    expect(planRender(patchOf([osc('a')], []), 4).passes).toBe(0)
  })

  it('has nothing to render when the Ignite leads nowhere', () => {
    // An Ignite with no children never starts a cascade, so there is no lap to measure.
    expect(planRender(patchOf([start('s')], []), 4).passes).toBe(0)
  })

  it('never exceeds the memory ceiling, however many passes are asked for', () => {
    const long = patchOf(
      [start('s'), osc('a'), osc('b'), osc('c'), osc('d')],
      [edge('s', 'a'), edge('a', 'b'), edge('b', 'c'), edge('c', 'd')],
    )
    const plan = planRender(long, MAX_PASSES)
    expect(plan.seconds).toBeLessThanOrEqual(MAX_RENDER_SECONDS)
    // Trimmed rather than refused: as many laps as fit.
    expect(plan.passes).toBeGreaterThan(0)
  })

  it('renders at least one pass even when a single lap fills the ceiling', () => {
    const plan = planRender(patchOf([start('s'), osc('a')], [edge('s', 'a')]), 0)
    expect(plan.passes).toBe(1)
  })
})
