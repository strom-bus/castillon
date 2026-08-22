/**
 * What an effect lets go of, and when.
 *
 * Disconnecting is not releasing, and deferring is not disposing. Neither difference shows in a patch
 * somebody is playing; both show in a sweep, which builds a subject, measures it, tears it down and does
 * the whole thing again a dozen times over.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine } from './engine'
import { fakeAudio } from './fakeAudio'
import { defaultFxParams } from '../nodes/registry'

/** Long enough to outlast any effect's release. */
const PAST_THE_RELEASE = 2000

function withReverb() {
  const fake = fakeAudio()
  const engine = new AudioEngine()
  engine.adopt(fake.ctx)
  engine.createEffect('r', { ...defaultFxParams(), effect: 'reverb', decay: 2.5 }, 120)
  return { fake, engine, convolver: fake.nodes('convolver')[0]! }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('taking an effect out of a patch that is playing', () => {
  it('holds on until the release has run, then lets go', () => {
    /*
     * The courtesy, and it is worth its cost here: cutting an effect that is sounding clicks. So the
     * teardown waits out the release on a timer, and until it fires the buffer is still owned.
     */
    vi.useFakeTimers()
    const { engine, convolver } = withReverb()

    engine.disposeEffect('r')
    expect(convolver.buffer).not.toBeNull()

    vi.advanceTimersByTime(PAST_THE_RELEASE)
    expect(convolver.buffer).toBeNull()
  })
})

describe('an engine going away', () => {
  it('lets go of an impulse response at once, without waiting out a release', () => {
    /*
     * Because there is nobody left to click at. Deferring meant the old graph stood while the next was
     * built — a trial tears down and the one after it starts fifty milliseconds later, against a reverb's
     * four hundred and fifty. Sixty-six reverbs is sixty-three megabytes held by nothing, per trial, and a
     * sweep repeats a subject a dozen times.
     */
    vi.useFakeTimers()
    const { engine, convolver } = withReverb()

    engine.dispose()
    expect(convolver.buffer).toBeNull()
  })

  it('lets go when asked to be quick about one effect, too', () => {
    vi.useFakeTimers()
    const { engine, convolver } = withReverb()

    engine.disposeEffect('r', true)
    expect(convolver.buffer).toBeNull()
  })

  it('leaves no teardown pending behind it', () => {
    // A timer outliving the engine keeps the whole chain reachable, which is the leak wearing a disguise.
    vi.useFakeTimers()
    const { engine } = withReverb()

    engine.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})
