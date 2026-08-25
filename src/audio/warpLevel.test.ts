import { describe, expect, it } from 'vitest'
import { defaultOscParams, defaultWarpParams, NO_WARPING, warpingOf } from '../nodes/registry'
import type { NodeId, Patch, PatchEdge, PatchNode, WarpParams } from '../types/patch'
import { ActivityBus } from '../viz/activity'
import { CascadeScheduler } from './scheduler'
import type { Engine, NoteRequest } from './engine'

/**
 * A WARP's Level: how loud the branch below it is.
 *
 * The control this instrument was missing, and the one most reached for — balancing a branch. Turning
 * four oscillators down by hand is four edits, which is the argument WARP exists on.
 *
 * The whole difficulty is that it looks like `velocity`, which was already there and already multiplies.
 * They are not the same control, and the tests below are mostly about the difference: velocity is a
 * **source**, so it decides how loud a note is *and* how far a per-note envelope opens, which is why it is
 * clamped at one. Level is a **level** — it scales the oscillator's own gain and touches nothing else, so
 * it can go above one where velocity cannot.
 */

class Recorder implements Engine {
  notes: NoteRequest[] = []
  now() {
    return 0
  }
  chance() {
    return 0
  }
  playNote(req: NoteRequest) {
    this.notes.push({ ...req })
  }
  voiceLoadAt() {
    return 0
  }
  effectLoad() {
    return 0
  }
  nodeBusyUntil() {
    return 0
  }
  releaseNodeVoices() {}
  restartLfo() {}
  fireEnvelope() {}
}

const warp = (id: NodeId, params: Partial<WarpParams>): PatchNode => ({
  id,
  type: 'warp',
  position: { x: 0, y: 0 },
  params: { ...defaultWarpParams(), ...params },
})

/** One oscillator under an Ignite, with however many warps attached to it. */
function played(warps: PatchNode[], over: Partial<ReturnType<typeof defaultOscParams>> = {}) {
  const engine = new Recorder()
  const activity = new ActivityBus(() => 0)
  activity.push = () => {}
  const edges: PatchEdge[] = [{ id: 'i->o', kind: 'event', source: 'i', target: 'o' }]
  for (const one of warps) {
    edges.push({ id: `${one.id}->o`, kind: 'warp', source: one.id, target: 'o' })
  }
  const patch: Patch = {
    version: 1,
    bpm: 120,
    loop: false,
    nodes: [
      { id: 'i', type: 'start', position: { x: 0, y: 0 }, params: {} },
      {
        id: 'o',
        type: 'osc',
        position: { x: 0, y: 0 },
        params: {
          ...defaultOscParams(),
          gain: 0.2,
          steps: [{ note: 60, active: true, velocity: 1 }],
          ...over,
        },
      },
      ...warps,
    ],
    edges,
  }
  const scheduler = new CascadeScheduler({ engine, activity, getPatch: () => patch })
  scheduler.start()
  scheduler.drain(2)
  scheduler.stop()
  return engine.notes
}

const gainOf = (warps: PatchNode[], over = {}) => played(warps, over)[0].gain

describe('a WARP’s Level', () => {
  it('leaves a branch alone at one, so a warp added is not yet a change', () => {
    expect(gainOf([])).toBeCloseTo(0.2, 6)
    expect(gainOf([warp('w', { level: 1 })])).toBeCloseTo(0.2, 6)
    expect(defaultWarpParams().level).toBe(1)
    expect(NO_WARPING.level).toBe(1)
  })

  it('turns a branch down', () => {
    expect(gainOf([warp('w', { level: 0.5 })])).toBeCloseTo(0.1, 6)
  })

  it('turns a branch up, which velocity cannot', () => {
    /*
     * The reason for having both. Velocity is clamped at one because it feeds an envelope's depth as well
     * as a note's loudness, and past one the loudness would only clip while the depth went on climbing.
     * Level has no second job, so it can push — and most oscillators sit around a quarter of full scale,
     * which leaves somewhere to push to.
     */
    expect(gainOf([warp('w', { level: 2 })])).toBeCloseTo(0.4, 6)
    // Velocity at two changes nothing, since a step at full velocity is already at the ceiling.
    expect(gainOf([warp('w', { velocity: 2 })])).toBeCloseTo(0.2, 6)
  })

  it('stacks by multiplying, as every ratio here does', () => {
    // Two warps each halving come to a quarter, which is the property that lets them stack without
    // anybody deciding which one wins.
    expect(gainOf([warp('a', { level: 0.5 }), warp('b', { level: 0.5 })])).toBeCloseTo(0.05, 6)
    expect(
      warpingOf([warp('a', { level: 0.5 }), warp('b', { level: 0.5 })], ['a', 'b']).level,
    ).toBeCloseTo(0.25, 6)
  })

  it('stops at full scale rather than asking for more than there is', () => {
    /*
     * Clamped on the note and not in the warp: two warps each asking for double is a fourfold ask, and
     * whether that fits depends on how loud the oscillator was to begin with. A branch already at full
     * scale cannot be made louder; one at a fifth has five times to give.
     */
    expect(gainOf([warp('w', { level: 4 })], { gain: 0.5 })).toBeCloseTo(1, 6)
    expect(gainOf([warp('a', { level: 2 }), warp('b', { level: 2 })], { gain: 0.5 })).toBeCloseTo(
      1,
      6,
    )
    // And never negative, whatever a hand-built patch or an older code carries.
    expect(gainOf([warp('w', { level: -3 })])).toBe(0)
  })

  it('leaves the note’s velocity alone, which is the whole point of it being a second control', () => {
    /*
     * The claim that separates them, and the one a level-shaped control gets wrong by being folded into
     * velocity: a MOD taking its depth from velocity must not close its filter because somebody balanced
     * the branch. Level changes how loud it is and nothing else.
     */
    const [note] = played([warp('w', { level: 0.25 })])
    expect(note.velocity).toBe(1)
    expect(note.gain).toBeCloseTo(0.05, 6)

    // Where velocity is what was turned down, both move — which is what velocity is for.
    const [soft] = played([warp('w', { velocity: 0.5 })])
    expect(soft.velocity).toBeCloseTo(0.5, 6)
  })

  it('composes with velocity rather than replacing it', () => {
    // Both at a half is a quarter of the loudness, and the velocity is still reported as a half so
    // anything reading it still can.
    const [note] = played([warp('w', { level: 0.5, velocity: 0.5 })])
    expect(note.gain).toBeCloseTo(0.05, 6)
    expect(note.velocity).toBeCloseTo(0.5, 6)
  })
})
