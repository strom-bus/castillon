import { describe, expect, it } from 'vitest'
import { defaultOscParams } from '../nodes/registry'
import type { FxParams, Patch, PatchEdge, PatchNode } from '../types/patch'
import { MAX_PASSES, MAX_RENDER_SECONDS, planRender } from './render'
import { CascadeScheduler } from './scheduler'
import { ActivityBus } from '../viz/activity'
import { seeded, seedFrom } from './random'
import type { Engine, NoteRequest } from './engine'
import { MAX_SLOP, type OscParams } from '../types/patch'

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

/**
 * That a file holds everything the patch plays, and holds the same thing twice.
 *
 * Two promises an export makes, one of which was quietly broken and the other never checked.
 */
/**
 * The scheduler's decisions for one render, against an engine seeded the way a render seeds one.
 *
 * Not the audio — jsdom has no `OfflineAudioContext` — but the thing that decides the audio. Identical
 * note streams into an identical graph give an identical file, and the note stream is where every roll
 * of the dice ends up: which steps sound, and how far slop throws each one.
 */
function scheduledNotes(patch: Patch, identity: string): NoteRequest[] {
  const notes: NoteRequest[] = []
  const random = seeded(seedFrom(identity))
  const engine: Engine = {
    now: () => 0,
    playNote: (req: NoteRequest) => notes.push(req),
    voiceLoadAt: () => 0,
    effectLoad: () => 0,
    nodeBusyUntil: () => 0,
    releaseNodeVoices: () => {},
    chance: () => random(),
  } as unknown as Engine

  const scheduler = new CascadeScheduler({
    engine,
    activity: new ActivityBus(() => 0),
    getPatch: () => ({ ...patch, loop: true }),
  })
  scheduler.start()
  scheduler.drain(4)
  scheduler.stop()
  return notes
}

describe('what the file has room for', () => {
  const withRelease = (release: number, over: Partial<OscParams> = {}): Patch => ({
    version: 1,
    bpm: 120,
    loop: true,
    nodes: [
      start('s'),
      {
        id: 'o',
        type: 'osc',
        position: { x: 0, y: 0 },
        params: { ...defaultOscParams(), release, ...over },
      },
    ],
    edges: [edge('s', 'o')],
  })

  /** When the last note of a one-second lap stops: it starts at 0.75 s and holds for its gate. */
  const lastNoteEnds = (release: number) =>
    0.75 + 0.25 * (defaultOscParams().gate ?? 1) + release / 1000

  it.each([50, 500, 2000])('leaves room for a %i ms release to finish', (release) => {
    /*
     * It did not. The tail allowed for an *effect's* release and never for a note's, which is the one
     * release most patches have — so anything over about two tenths of a second had its final decay cut
     * off the file. At two seconds, one and seven tenths of the music was simply missing.
     */
    const plan = planRender(withRelease(release), 1)
    expect(plan.seconds, `${release} ms`).toBeGreaterThanOrEqual(lastNoteEnds(release))
  })

  it('grows the tail with the release rather than using one fixed pad', () => {
    // The check that a passing figure is not an accident of one generous constant.
    const short = planRender(withRelease(50), 1).seconds
    const long = planRender(withRelease(2000), 1).seconds
    expect(long - short).toBeGreaterThan(1.5)
  })

  it('leaves room for a note thrown late by slop', () => {
    // Slop moves a note's start, and its life goes with it — so the bound has to hold there too.
    const loose = planRender(withRelease(500, { slop: MAX_SLOP, useSlop: true }), 1)
    expect(loose.seconds).toBeGreaterThanOrEqual(lastNoteEnds(500))
  })

  it('gives a short patch a short tail, not a fixed slab of silence', () => {
    /*
     * The proportion, which the room checks cannot see. Erring long is cheap and erring *always* long is
     * a file that is mostly nothing — a mutant that simply widened the pad to five seconds passed every
     * other check here, because they all ask whether there is enough room and none whether there is too
     * much. A one-second lap ending in a fifty-millisecond release should give about a second of file.
     */
    const plan = planRender(withRelease(50), 1)
    expect(plan.seconds).toBeLessThan(plan.passSeconds + 0.5)
  })

  it('still stops somewhere, rather than padding without limit', () => {
    // The other direction: erring long is cheap and erring unbounded is a 46 MB buffer per two minutes.
    expect(planRender(withRelease(2000), MAX_PASSES).seconds).toBeLessThanOrEqual(
      MAX_RENDER_SECONDS,
    )
  })
})

describe('rendering the same patch twice', () => {
  /*
   * The promise the export is *for*, asserted in three comments across the engine and checked by nothing
   * until now — and it has three consumers rather than one: which steps sound, the grain of the noise,
   * and now how far slop throws each note. The engine draws all of them from a stream seeded from the
   * patch itself, so two renders agree; live playback keeps `Math.random` and keeps breathing.
   *
   * The audio cannot be rendered here — jsdom has no `OfflineAudioContext` — so what is compared is the
   * thing that decides the audio: every note the scheduler asks for, in order, with its time and its
   * velocity. Identical note streams into an identical graph give an identical file.
   */
  const chancy = (): Patch => ({
    version: 1,
    bpm: 120,
    loop: true,
    nodes: [
      start('s'),
      {
        id: 'o',
        type: 'osc',
        position: { x: 0, y: 0 },
        params: {
          ...defaultOscParams(),
          useChance: true,
          slop: 0.4,
          useSlop: true,
          steps: defaultOscParams().steps.map((step) => ({ ...step, chance: 0.5 })),
        },
      },
    ],
    edges: [edge('s', 'o')],
  })

  const notesOf = (patch: Patch, identity: string) =>
    scheduledNotes(patch, identity).map((note) => `${note.time.toFixed(6)}@${note.velocity}`)

  it('asks for exactly the same notes, slop and chance included', () => {
    const patch = chancy()
    expect(notesOf(patch, 'the-same-patch')).toEqual(notesOf(patch, 'the-same-patch'))
  })

  it('asks for different ones from a different seed, or the check above proves nothing', () => {
    // If the stream were ignored rather than seeded, both sides would match here too and the test
    // above would be measuring a constant.
    const patch = chancy()
    expect(notesOf(patch, 'one-patch')).not.toEqual(notesOf(patch, 'another-patch'))
  })

  it('draws something worth seeding at all', () => {
    // A patch whose steps all sound and never move would compare equal however the dice fell.
    expect(notesOf(chancy(), 'x').length).toBeGreaterThan(0)
  })
})
