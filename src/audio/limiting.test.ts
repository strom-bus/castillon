import { describe, expect, it } from 'vitest'
import { AudioEngine } from './engine'
import { fakeAudio } from './fakeAudio'

/**
 * What the engine reports about the limiter, which is the one honest reading of "too loud".
 *
 * The output never clips: the master runs into a limiter before the speakers, so a signal past what
 * fits is squashed rather than torn. Asking the limiter how hard it is working costs nothing — it is
 * already in the chain and already knows — where measuring the signal would mean an analyser and a
 * window of samples to look at.
 */

/** The limiter the engine builds, which is the only compressor on the output chain. */
function outputChain() {
  const fake = fakeAudio()
  const engine = new AudioEngine()
  engine.adopt(fake.ctx)
  const limiter = fake.nodes('compressor').at(-1) as Record<string, unknown>
  return { fake, engine, limiter }
}

describe('what the engine says about being held back', () => {
  it('reports nothing before there is a context at all', () => {
    // A silent instrument is not being limited, and null would make every reader handle a case that
    // means the same as nought.
    expect(new AudioEngine().limiting()).toBe(0)
  })

  it('reports nothing while the limiter is doing nothing', () => {
    expect(outputChain().engine.limiting()).toBe(0)
  })

  it('reports the reduction the limiter is applying', () => {
    const { engine, limiter } = outputChain()
    limiter.reduction = -4.5
    expect(engine.limiting()).toBe(-4.5)
  })

  it('builds a limiter that catches before the output does', () => {
    /*
     * The threshold is what makes the reading mean anything: a limiter set at nought would only ever
     * report *after* the output had already gone past one, which is too late to be a warning. Below it,
     * so there is room between "the limiter is working" and "something is actually broken".
     */
    const { fake } = outputChain()
    const threshold = fake.params('threshold').at(-1)!
    expect(threshold.value).toBeLessThan(0)
  })
})
