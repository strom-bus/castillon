import { describe, expect, it } from 'vitest'
import { EFFECTS, effectOr } from './effects'
import { planRender } from './render'
import { PRESETS } from '../presets/presets'
import { MAX_DECAY, type FxParams, type Patch, type PatchNode } from '../types/patch'

/**
 * How long an export waits for an effect that is still sounding.
 *
 * This is the third time the tail of a render has been found short, and the first two fixes were both
 * right and both incomplete. It began as the last lap and nothing after it. Then a note's release was
 * added, because a two-second release lost 1.69 seconds of music. What stayed wrong for longer than
 * either is subtler: the effects were allowed `releaseTime`, and `releaseTime` answers a **different
 * question** — how long to fade a node out when somebody deletes it, so that it does not click.
 *
 * A reverb's is four tenths of a second and its decay is up to ten. So every export this instrument
 * had ever produced was missing the end of its reverb: 2.8 seconds on most of the presets, 7.6 on the
 * stress patch, and 3.4 on the resonator preset that made the gap obvious.
 *
 * The lesson worth keeping is not about tails. Two numbers with the same units and adjacent names
 * answered two different questions, and using one for the other is invisible in every test that does not
 * ask how long the sound goes on.
 */

const start = (id: string): PatchNode => ({
  id,
  type: 'start',
  position: { x: 0, y: 0 },
  params: {},
})

function withEffect(params: FxParams, bpm = 120): Patch {
  return {
    version: 1,
    bpm,
    loop: true,
    nodes: [
      start('s'),
      {
        id: 'a',
        type: 'osc',
        position: { x: 0, y: 0 },
        params: {
          waveform: 'square',
          pulseWidth: 0.5,
          detune: 0,
          steps: [{ note: 60, active: true, velocity: 1 }],
          division: '1/8',
          gain: 0.3,
          attack: 2,
          decay: 0,
          release: 20,
          glide: 0,
          gate: 0.5,
          filterType: 'off',
          cutoff: 2000,
          resonance: 1,
          keyTrack: 0,
          propagateMode: 'onEnd',
        },
      },
      { id: 'f', type: 'fx', position: { x: 0, y: 0 }, params },
    ],
    edges: [
      { id: 's->a', kind: 'event', source: 's', target: 'a' },
      { id: 'a->f', kind: 'audio', source: 'a', target: 'f' },
    ],
  }
}

/** Seconds the plan adds after the last lap, which is the whole subject. */
const tailOf = (params: FxParams, bpm = 120) => {
  const plan = planRender(withEffect(params, bpm), 1)
  return plan.seconds - plan.until
}

describe('an export waiting for an effect', () => {
  it('waits the whole of a reverb decay, not the length of its disposal fade', () => {
    /*
     * The bug, stated as a number. A reverb set to eight seconds got four tenths, because the render
     * asked the field that says how long to fade the node out when it is deleted.
     */
    const long = tailOf({ effect: 'reverb', mix: 0.5, decay: 8 } as FxParams)
    expect(long).toBeGreaterThan(7.9)

    // And it tracks the setting rather than being one generous constant for every reverb.
    const short = tailOf({ effect: 'reverb', mix: 0.5, decay: 1 } as FxParams)
    expect(short).toBeLessThan(long - 5)
    expect(short).toBeGreaterThan(0.9)
  })

  it('waits the whole of a resonator ring', () => {
    // Ring is defined as the time to fall sixty decibels, so it is exactly the tail — and the resonator
    // is the effect where the tail *is* the content.
    const ring = tailOf({ effect: 'comb', mix: 0.9, decay: 4, pitch: 45 } as FxParams)
    expect(ring).toBeGreaterThan(3.9)
  })

  it('waits for an echo to run out of repeats, and does not wait for ever', () => {
    /*
     * The one effect whose tail is neither a setting nor a constant: it is however many repeats it takes
     * to fall sixty decibels. At 0.95 that is 135 round trips, which at a slow tempo is two minutes —
     * not a tail but the rest of the file — so it is capped.
     */
    const quiet = tailOf({ effect: 'echo', mix: 0.5, time: '1/8', feedback: 0.2 } as FxParams)
    const loud = tailOf({ effect: 'echo', mix: 0.5, time: '1/8', feedback: 0.9 } as FxParams)
    expect(loud).toBeGreaterThan(quiet)
    expect(loud).toBeLessThan(11)

    // And slower repeats take longer to die than fast ones at the same feedback.
    const slow = tailOf({ effect: 'echo', mix: 0.5, time: '1/4', feedback: 0.5 } as FxParams)
    const fast = tailOf({ effect: 'echo', mix: 0.5, time: '1/16', feedback: 0.5 } as FxParams)
    expect(slow).toBeGreaterThan(fast)
  })

  it('never waits less than the fade it would take to remove the node', () => {
    /*
     * The floor, for the nine effects built from a curve or a gain and holding nothing. Their tail *is*
     * the release, and answering less than it would cut the fade itself off the end.
     */
    for (const descriptor of EFFECTS) {
      const params = { effect: descriptor.kind, mix: 0.5, ...descriptor.defaults } as FxParams
      const answered = descriptor.tail?.(params, 120) ?? descriptor.releaseTime
      expect(answered, `${descriptor.kind} waits less than its own fade`).toBeGreaterThanOrEqual(
        descriptor.releaseTime,
      )
    }
  })

  it('never asks for more than the longest decay the format can store', () => {
    // A tail is bounded by what a control can be set to, or a patch could ask a render for a minute of
    // silence. The echo is the only one that could exceed it, which is why it is capped.
    for (const descriptor of EFFECTS) {
      const worst = {
        effect: descriptor.kind,
        mix: 1,
        ...descriptor.defaults,
        decay: MAX_DECAY,
        feedback: 0.95,
        time: '1/4',
      } as FxParams
      const answered = descriptor.tail?.(worst, 40) ?? descriptor.releaseTime
      expect(answered, `${descriptor.kind} asks for ${answered}s`).toBeLessThanOrEqual(MAX_DECAY)
    }
  })

  it('leaves every preset room for the effect it actually carries', () => {
    /*
     * The end-to-end statement, over the patches somebody will export first. Asked of the presets rather
     * than of a case built here, because that is where the missing 2.8 seconds actually was.
     */
    for (const preset of PRESETS) {
      const effects = preset.patch.nodes.filter((node) => node.type === 'fx')
      if (effects.length === 0) continue

      const needed = Math.max(
        ...effects.map((node) => {
          const params = node.params as FxParams
          const descriptor = effectOr(params.effect)
          return descriptor.tail?.(params, preset.patch.bpm) ?? descriptor.releaseTime
        }),
      )
      const plan = planRender(preset.patch, 2)
      expect(plan.seconds - plan.until, `${preset.name} is cut short`).toBeGreaterThanOrEqual(
        needed,
      )
    }
  })
})
