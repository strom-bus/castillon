import { describe, expect, it } from 'vitest'
import { defaultFxParams, defaultOscParams } from '../nodes/registry'
import type { FxParams, Patch, PatchEdge, PatchNode } from '../types/patch'
import { applyOps, AudioEngine } from './engine'
import { fakeAudio } from './fakeAudio'
import { diff, EMPTY_GRAPH, graphOf } from './router'
import { CascadeScheduler } from './scheduler'
import { ActivityBus } from '../viz/activity'
import type { Engine } from './engine'

/**
 * Effects in series.
 *
 * Order matters enormously in effects — a distorted reverb tail is a different sound from a reverberated
 * distortion — and until now the audio graph was one hop deep, so there was no order to have. What makes
 * this cheap is that the order is the **cables**, the same as everywhere else here: no setting, nothing
 * numbered, nothing computed about the shape of the graph beyond refusing a loop.
 *
 * Tested through the router rather than the engine, because what changed is a decision and not a piece of
 * arithmetic: which sends exist, and which effects are heard directly. The engine only does as it is told.
 */

const osc = (id: string): PatchNode => ({
  id,
  type: 'osc',
  position: { x: 0, y: 0 },
  params: defaultOscParams(),
})

const fx = (id: string, over: Partial<FxParams> = {}): PatchNode => ({
  id,
  type: 'fx',
  position: { x: 0, y: 0 },
  params: { ...defaultFxParams(), ...over },
})

const audio = (source: string, target: string): PatchEdge => ({
  id: `${source}->${target}`,
  kind: 'audio',
  source,
  target,
})

const patchOf = (nodes: PatchNode[], edges: PatchEdge[] = []): Patch => ({
  version: 1,
  bpm: 120,
  loop: true,
  nodes,
  edges,
})

/** The sends the router decided on, as readable pairs. */
const sendsOf = (patch: Patch) => [...graphOf(patch).sends].sort()

/** Which effects are heard directly. */
const heardOf = (patch: Patch) =>
  [...graphOf(patch).terminals.entries()]
    .filter(([, on]) => on)
    .map(([id]) => id)
    .sort()

describe('effects in series', () => {
  it('sends an effect into another one', () => {
    const patch = patchOf([osc('a'), fx('f'), fx('g')], [audio('a', 'f'), audio('f', 'g')])
    expect(sendsOf(patch)).toEqual(['a>f', 'f>g'])
  })

  it('hears only the end of a chain', () => {
    /*
     * The routing decision the feature rests on. The middle of a chain must not also reach the master, or
     * you would hear the distorted reverb *and* the reverb it was made from — which is the parallel
     * arrangement wearing a chain's clothes, and it is what the code did before this.
     */
    const patch = patchOf([osc('a'), fx('f'), fx('g')], [audio('a', 'f'), audio('f', 'g')])
    expect(heardOf(patch)).toEqual(['g'])
  })

  it('hears both when two effects sit side by side', () => {
    // Parallel still works and is still the default: two sends off one oscillator, both heard.
    const patch = patchOf([osc('a'), fx('f'), fx('g')], [audio('a', 'f'), audio('a', 'g')])
    expect(heardOf(patch)).toEqual(['f', 'g'])
  })

  it('unhooks an effect from the master the moment something is put after it', () => {
    /*
     * Why this is a diff and not something the engine keeps track of. An effect that has just *stopped*
     * being the end of a chain has to be unhooked, and nothing in the engine can notice that — it sees one
     * cable being added, not that another node's role changed underneath it.
     */
    const before = graphOf(patchOf([osc('a'), fx('f'), fx('g')], [audio('a', 'f')]))
    const after = graphOf(patchOf([osc('a'), fx('f'), fx('g')], [audio('a', 'f'), audio('f', 'g')]))
    const ops = diff(before, after)
    expect(ops).toEqual(expect.arrayContaining([{ op: 'setToMaster', id: 'f', value: false }]))
  })

  it('hooks it back when what followed it goes away', () => {
    const before = graphOf(
      patchOf([osc('a'), fx('f'), fx('g')], [audio('a', 'f'), audio('f', 'g')]),
    )
    const after = graphOf(patchOf([osc('a'), fx('f'), fx('g')], [audio('a', 'f')]))
    expect(diff(before, after)).toEqual(
      expect.arrayContaining([{ op: 'setToMaster', id: 'f', value: true }]),
    )
  })

  it('leaves the oscillator silent on its own path, chain or no chain', () => {
    // Unchanged, and worth pinning: the first effect carries the dry across itself and it travels down the
    // chain from there, so the oscillator is still heard — through the chain rather than beside it.
    const patch = patchOf([osc('a'), fx('f'), fx('g')], [audio('a', 'f'), audio('f', 'g')])
    expect(graphOf(patch).direct.get('a')).toBe(0)
  })
})

describe('a loop in the audio graph', () => {
  /**
   * The connection rules refuse to *draw* one, and this is the other half: a patch code, the dice or a
   * paste can carry one, and an audio loop is a gain feeding itself. There is no `MAX_DEPTH` here — that
   * bounds a trigger going round, and nothing bounds a signal going round.
   */
  it('is dropped rather than built', () => {
    const patch = patchOf(
      [osc('a'), fx('f'), fx('g')],
      [audio('a', 'f'), audio('f', 'g'), audio('g', 'f')],
    )
    expect(sendsOf(patch)).toEqual(['a>f', 'f>g'])
  })

  it('is dropped the long way round as well', () => {
    // A one-step check would allow this and the graph would still feed back.
    const patch = patchOf(
      [osc('a'), fx('f'), fx('g'), fx('h')],
      [audio('a', 'f'), audio('f', 'g'), audio('g', 'h'), audio('h', 'f')],
    )
    expect(sendsOf(patch)).toEqual(['a>f', 'f>g', 'g>h'])
  })

  it('is dropped when an effect feeds itself', () => {
    const patch = patchOf([osc('a'), fx('f')], [audio('a', 'f'), audio('f', 'f')])
    expect(sendsOf(patch)).toEqual(['a>f'])
  })

  it('drops the same cable every time, not whichever came first by luck', () => {
    /*
     * Taken in patch order, so which cable is refused is a property of the patch and not of a `Set`'s
     * iteration. A patch that decoded to a different graph on a different day would be a patch that
     * cannot be shared, which is most of what this format is for.
     */
    const patch = patchOf(
      [osc('a'), fx('f'), fx('g')],
      [audio('a', 'f'), audio('f', 'g'), audio('g', 'f')],
    )
    for (let i = 0; i < 8; i++) expect(sendsOf(patch)).toEqual(['a>f', 'f>g'])
  })

  it('still hears the chain it did accept', () => {
    // Dropping the closing cable must not leave the whole chain unheard, which is what would happen if the
    // dropped cable still counted towards somebody being in the middle of a chain.
    const patch = patchOf(
      [osc('a'), fx('f'), fx('g')],
      [audio('a', 'f'), audio('f', 'g'), audio('g', 'f')],
    )
    expect(heardOf(patch)).toEqual(['g'])
  })

  it('leaves a patch with no loop in it exactly as it was', () => {
    const patch = patchOf(
      [osc('a'), osc('b'), fx('f'), fx('g')],
      [audio('a', 'f'), audio('b', 'g'), audio('f', 'g')],
    )
    expect(sendsOf(patch)).toEqual(['a>f', 'b>g', 'f>g'])
    expect(heardOf(patch)).toEqual(['g'])
  })
})

describe('the empty graph', () => {
  it('knows about no effects at all, so a first effect is a change', () => {
    // `EMPTY_GRAPH` is what a diff starts from, and an effect missing from `terminals` has to read as
    // *not* hooked up — which is what a freshly built one is, since `createEffect` no longer connects it.
    expect(EMPTY_GRAPH.terminals.size).toBe(0)
    const ops = diff(EMPTY_GRAPH, graphOf(patchOf([osc('a'), fx('f')], [audio('a', 'f')])))
    expect(ops).toEqual(expect.arrayContaining([{ op: 'setToMaster', id: 'f', value: true }]))
  })
})

describe('the engine building a chain', () => {
  /**
   * The other half: the router decides and the engine does.
   *
   * Two things could be silently wrong here and neither is visible from the decision. An effect fed from
   * `busFor` instead of from the upstream effect would look wired and pass silence, because `busFor`
   * creates a voice bus on demand and would happily make one for an effect's id. And an effect in the
   * middle of a chain still reaching the master would sound like the parallel arrangement it replaced.
   */
  function built(patch: Patch) {
    const fake = fakeAudio()
    const engine = new AudioEngine()
    engine.adopt(fake.ctx)
    applyOps(engine, diff(EMPTY_GRAPH, graphOf(patch)), patch.bpm)
    return { fake, engine }
  }

  const gains = (patch: Patch) => built(patch).fake.nodes('gain').length

  it('feeds one effect from another rather than conjuring a voice bus for it', () => {
    /*
     * A voice bus is two gains — the bus and its direct path — so one made by mistake is countable. Two
     * effects in series should build no more of them than two effects in parallel, since there is still
     * exactly one oscillator sending.
     */
    const series = patchOf([osc('a'), fx('f'), fx('g')], [audio('a', 'f'), audio('f', 'g')])
    const parallel = patchOf([osc('a'), fx('f'), fx('g')], [audio('a', 'f'), audio('a', 'g')])
    expect(gains(series)).toBe(gains(parallel))
  })

  it('puts one fewer thing into the master when the two are chained', () => {
    /*
     * Chained, only the last effect is heard; side by side, both are. So the master has one fewer thing
     * arriving — which is the whole audible difference between a chain and a pair, stated as a count
     * rather than as a claim about which node is which.
     */
    const series = patchOf([osc('a'), fx('f'), fx('g')], [audio('a', 'f'), audio('f', 'g')])
    const parallel = patchOf([osc('a'), fx('f'), fx('g')], [audio('a', 'f'), audio('a', 'g')])

    const into = (patch: Patch) => {
      const { fake } = built(patch)
      // The master is the first gain the engine builds, before any effect or voice exists.
      const master = fake.nodes('gain')[0] as { incoming: unknown[] }
      return master.incoming.length
    }
    expect(into(series)).toBe(into(parallel) - 1)
  })

  it('takes an effect off the master and puts it back', () => {
    // The engine side of the diff: told to unhook, it unhooks; told again, it hooks. Counted on the
    // master, so it does not depend on knowing which gain belongs to which effect.
    const { fake, engine } = built(
      patchOf([osc('a'), fx('f'), fx('g')], [audio('a', 'f'), audio('a', 'g')]),
    )
    const master = fake.nodes('gain')[0] as { incoming: unknown[] }
    const both = master.incoming.length

    engine.setToMaster('f', false)
    expect(master.incoming.length).toBe(both - 1)
    engine.setToMaster('f', true)
    expect(master.incoming.length).toBe(both)

    // And asking twice for what is already true changes nothing, since a diff can repeat itself when a
    // patch is reloaded and a second `connect` into the same node would double the effect's level.
    engine.setToMaster('f', true)
    expect(master.incoming.length).toBe(both)
  })
})

describe('the canvas showing a chain', () => {
  /**
   * That every effect a sound passes through lights up.
   *
   * The flash followed osc→fx edges and stopped there, which was the whole story when the audio graph was
   * one hop deep. With effects in series the **second** effect in a chain never lit: it was carrying the
   * sound and looked as dead as a node wired to nothing, which from the outside is indistinguishable from
   * it not working. Reported as "the bitcrusher does not sound and does not light either", and the not
   * lighting was the half that was true.
   *
   * Third time in three days that a feature was right and the surface showing it was not — the lit step
   * bar (§42.3) and the pulse direction (§44.8) were the other two.
   */
  function litBy(edges: PatchEdge[]) {
    const engine: Engine = {
      now: () => 0,
      chance: () => 0,
      playNote: () => {},
      voiceLoadAt: () => 0,
      effectLoad: () => 0,
      nodeBusyUntil: () => 0,
      releaseNodeVoices: () => {},
      restartLfo: () => {},
      fireEnvelope: () => {},
    }
    const seen: string[] = []
    const activity = new ActivityBus(() => 0)
    activity.push = (event) => {
      if (event.kind === 'node') seen.push(event.id)
    }
    const patch: Patch = {
      version: 1,
      bpm: 120,
      loop: false,
      nodes: [
        { id: 'i', type: 'start', position: { x: 0, y: 0 }, params: {} },
        osc('a'),
        fx('f'),
        fx('g'),
        fx('h'),
      ],
      edges: [{ id: 'i->a', kind: 'event', source: 'i', target: 'a' }, ...edges],
    }
    const scheduler = new CascadeScheduler({ engine, activity, getPatch: () => patch })
    scheduler.start()
    scheduler.drain(3)
    scheduler.stop()
    return [...new Set(seen)].sort()
  }

  it('lights every effect in a chain, not only the first', () => {
    expect(litBy([audio('a', 'f'), audio('f', 'g'), audio('g', 'h')])).toEqual([
      'a',
      'f',
      'g',
      'h',
      'i',
    ])
  })

  it('lights both when they sit side by side, as it always did', () => {
    expect(litBy([audio('a', 'f'), audio('a', 'g')])).toEqual(['a', 'f', 'g', 'i'])
  })

  it('leaves a chain the oscillator does not reach dark', () => {
    /*
     * The other direction, and the easy wrong fix: flashing every effect in the patch would pass every
     * check above and make the canvas useless, since a lit node would stop meaning anything.
     *
     * A *second* chain, unreachable from the oscillator, is what it takes to see that — an effect merely
     * wired to nothing is not enough, because the wrong fix walks the sources and an oscillator is one.
     */
    expect(litBy([audio('a', 'f'), audio('g', 'h')])).toEqual(['a', 'f', 'i'])
  })

  it('does not hang on a loop it was handed', () => {
    /*
     * The rules refuse to draw one and the router drops one, but this map is built from the raw edges and
     * cannot assume either has run — a patch code or a paste reaches it first.
     */
    expect(litBy([audio('a', 'f'), audio('f', 'g'), audio('g', 'f')])).toEqual(['a', 'f', 'g', 'i'])
  })
})
