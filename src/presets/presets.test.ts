/**
 * That the patches shipped with the machine are patches worth shipping.
 *
 * A preset is the first thing somebody hears, and unlike a roll of the dice it cannot be re-rolled if it
 * comes out silent. Nothing here listens — no test can — but everything that would make one wrong without
 * being audibly wrong can be checked: a node nothing triggers, a cable pointed at a parameter that does
 * not exist, a modulator sweeping something already off, a patch over the budget on the machine it was
 * written on.
 */

import { describe, expect, it } from 'vitest'
import { PRESETS } from './presets'
import { estimatePeakLoad } from '../audio/load'
import { stressLoad } from '../tools/stressPatch'
import { LAYER_THRESHOLD, MAX_LOAD } from '../audio/load'
import { silentBecause, targetsFor } from '../audio/modulation'
import { permits } from '../state/connections'
import { defaultFxParams, NODE_DEFINITIONS } from '../nodes/registry'
import { decodePatch, encodePatch, STEP_COLUMN_USAGE } from '../state/patchCode'
import { warpDoingNothing } from '../state/transpose'
import { DIRECTIONS } from '../types/patch'
import type {
  ModParams,
  OscParams,
  Patch,
  PatchNode,
  HoldParams,
  StartParams,
} from '../types/patch'

/** Everything a trigger can reach from an Ignite, which is everything that will ever make a sound. */
function reachable(patch: Patch): Set<string> {
  const seen = new Set(patch.nodes.filter((node) => node.type === 'start').map((node) => node.id))
  for (let pass = 0; pass < patch.nodes.length; pass++) {
    for (const edge of patch.edges) {
      if (edge.kind === 'event' && seen.has(edge.source)) seen.add(edge.target)
    }
  }
  return seen
}

const nodeOf = (patch: Patch, id: string): PatchNode | undefined =>
  patch.nodes.find((node) => node.id === id)

describe('the presets', () => {
  it('each have a name and a line saying what it is for', () => {
    expect(PRESETS.length).toBeGreaterThan(2)
    for (const preset of PRESETS) {
      expect(preset.name.trim().length).toBeGreaterThan(0)
      expect(preset.about.trim().length).toBeGreaterThan(20)
    }
  })

  it.each(PRESETS)('$name gives every bound Ignite something to be bound to', ({ patch }) => {
    /*
     * An Ignite set to wait for a press with nothing recorded to wait for can never fire at all: it sits
     * on the canvas looking like a start and is one branch of the patch permanently dark. Nothing else
     * about the patch would look wrong, which is what makes it worth a test.
     */
    for (const node of patch.nodes.filter((one) => one.type === 'start')) {
      const params = node.params as {
        trigger?: string
        binding?: { source?: string; code?: string } | null
      }
      if (params.trigger !== 'bound') continue
      expect(params.binding?.source, `${node.id}: bound to nothing`).toBeTruthy()
      expect(params.binding?.code, `${node.id}: bound to nothing`).toBeTruthy()
    }
  })

  it('leaves at least one that starts on its own', () => {
    // Between them, not within each: a set where every patch waits for a key means pressing Play does
    // nothing on any of them, and Play is what somebody presses first.
    const opens = PRESETS.filter(({ patch }) =>
      patch.nodes.some(
        (node) =>
          node.type === 'start' && (node.params as { trigger?: string }).trigger !== 'bound',
      ),
    )
    expect(opens.length).toBe(PRESETS.length)
  })

  it('have ids that differ, since they key the rendered list', () => {
    expect(new Set(PRESETS.map((one) => one.id)).size).toBe(PRESETS.length)
  })

  it.each(PRESETS)('$name starts somewhere', ({ patch }) => {
    // A patch with no Ignite loads, shows, and does nothing at all when you press Play.
    expect(patch.nodes.some((node) => node.type === 'start')).toBe(true)
  })

  it.each(PRESETS)('$name leaves nothing the cascade never reaches', ({ patch }) => {
    /*
     * Effects and modulators hang off the side and are not triggered, so they are exempt — but an
     * oscillator or a delay nothing fires is a node drawn on the canvas that never makes a sound, which
     * is the most confusing thing a first patch could contain.
     */
    const lit = reachable(patch)
    const dark = patch.nodes
      .filter((node) => node.type === 'osc' || node.type === 'hold')
      .filter((node) => !lit.has(node.id))
      .map((node) => node.id)
    expect(dark).toEqual([])
  })

  it.each(PRESETS)('$name points every cable at something that exists', ({ patch }) => {
    const ids = new Set(patch.nodes.map((node) => node.id))
    for (const edge of patch.edges) {
      expect(ids.has(edge.source), `${edge.id}: no such source`).toBe(true)
      expect(ids.has(edge.target), `${edge.id}: no such target`).toBe(true)
    }
  })

  it.each(PRESETS)('$name wires no modulator to a parameter that is not there', ({ patch }) => {
    // The list of targets depends on what the cable landed on, so a target copied between two patches
    // can be perfectly spelled and still refer to nothing.
    for (const edge of patch.edges.filter((one) => one.kind === 'mod')) {
      const source = nodeOf(patch, edge.source)!
      const destination = nodeOf(patch, edge.target)!
      const target = (source.params as { target?: string }).target
      const effect = (destination.params as { effect?: string }).effect
      const offered = targetsFor(destination.type, effect as never).map((one) => one.key)
      expect(offered, `${edge.id} → ${target}`).toContain(target)
    }
  })

  it.each(PRESETS)('$name sweeps nothing that is switched off', ({ patch }) => {
    /*
     * A modulator on a filter cutoff with the filter set to off is the quietest possible mistake: the
     * cable is drawn, the modulator runs, the budget is charged, and not one thing about it is audible.
     */
    for (const edge of patch.edges.filter((one) => one.kind === 'mod')) {
      const source = nodeOf(patch, edge.source)!
      const destination = nodeOf(patch, edge.target)!
      const target = (source.params as { target?: string }).target
      const params = destination.params as { effect?: string; filterType?: string }
      const why = silentBecause(target ?? '', {
        nodeType: destination.type,
        effect: params.effect as never,
        filterType: params.filterType,
      })
      expect(why, `${edge.id}: ${why}`).toBeNull()
    }
  })

  it.each(PRESETS)('$name has something audible in it', ({ patch }) => {
    // An oscillator with every step muted is a patch that runs, lights up, and is silent.
    const sounding = patch.nodes
      .filter((node) => node.type === 'osc')
      .filter((node) => {
        const params = node.params as { steps?: Array<{ active: boolean }>; gain?: number }
        return (params.steps ?? []).some((step) => step.active) && (params.gain ?? 0) > 0
      })
    expect(sounding.length).toBeGreaterThan(0)
  })

  it.each(PRESETS.filter((one) => !one.loadTest))(
    '$name stays well inside the budget',
    ({ patch }) => {
      /*
       * Under the threshold where the engine starts stealing voices rather than layering them, not merely
       * under the ceiling: a preset is the reference for what a healthy patch looks like, and one that
       * arrives already degrading teaches the wrong thing. Slower machines than this one will open it too.
       */
      const load = estimatePeakLoad(patch)
      expect(load).toBeGreaterThan(0)
      expect(load, `${load.toFixed(0)} points`).toBeLessThan(MAX_LOAD * LAYER_THRESHOLD)
    },
  )

  it.each(PRESETS.filter((one) => one.loadTest))(
    '$name is past the threshold, which is the whole point of it',
    ({ patch }) => {
      /*
       * The opposite assertion, for the one preset that is not music. A load test under the threshold is
       * not a load test, and it would have passed the rule above by accident rather than by being light:
       * `estimatePeakLoad` caps how many voices an oscillator is assumed to hold at four, and these hold
       * about twenty, so it reads well under half of what this costs. Asked the honest way instead.
       */
      const { voices, effects } = stressLoad(patch)
      const total = voices + effects
      expect(total, `${total.toFixed(0)} points`).toBeGreaterThan(MAX_LOAD * LAYER_THRESHOLD)
      // And short of the ceiling, or it would be certain to glitch and say nothing about where glitching
      // begins.
      expect(total, `${total.toFixed(0)} points`).toBeLessThan(MAX_LOAD)
    },
  )

  it('ships exactly one load test, and says so on its face', () => {
    // A patch that arrives already degrading teaches the wrong thing *unless it says it is meant to*.
    // The flag is what makes that exemption a declaration rather than a hole in the rule.
    const tests = PRESETS.filter((one) => one.loadTest)
    expect(tests).toHaveLength(1)
    expect(tests[0]!.about.toLowerCase()).toContain('not music')
  })

  it.each(PRESETS)('$name wires only cables the instrument has', ({ patch }) => {
    /*
     * Every edge checked against the same rule a drag goes through. A patch built in code never goes
     * through a drag, so nothing was checking these at all — and one of them was wrong: a warp wired to
     * an Ignite, which the rules permitted and the canvas could not draw, so the preset played warped
     * with no cable on screen to say what was doing it.
     */
    for (const edge of patch.edges) {
      const from = nodeOf(patch, edge.source)?.type
      const to = nodeOf(patch, edge.target)?.type
      expect(
        permits(from, to, edge.kind),
        `${edge.id}: no ${edge.kind} cable runs from ${from} to ${to}`,
      ).toBe(true)
    }
  })

  it.each(PRESETS)('$name attaches every warp to something it can bend', ({ patch }) => {
    /*
     * The quiet failure a WARP has, and the one that looks most like working: attached to nothing, or
     * wired into the cascade instead of onto the side of it, the panel is full of settings, the cable is
     * drawn, and the patch sounds exactly as it did before.
     */
    for (const node of patch.nodes.filter((one) => one.type === 'warp')) {
      const why = warpDoingNothing(patch.nodes, patch.edges, node.id)
      expect(why, `${node.id}: ${why}`).toBeNull()
    }
  })

  /**
   * Parameters no preset is expected to move off its default, each for a reason that would not apply to
   * the next one added.
   *
   * Kept short on purpose: a list like this is where derived coverage goes back to being hand-written,
   * so anything on it has to be something a preset genuinely cannot show.
   */
  const NOT_DEMONSTRABLE = new Set([
    /*
     * Every parameter of every effect except which effect it is and how much of it you hear.
     *
     * `FxParams` is eleven effects flattened into one record, so asking whether each of its fields is
     * moved is really asking whether a preset uses each of the eleven — and eleven effects across eight
     * presets built around one idea each would make a bad preset rather than a thorough one. Effect
     * coverage is somebody else's job and is done twice already: the manual is checked against
     * `effects.ts` control by control, and the die is checked against every kind it can name.
     *
     * Derived from the type rather than listed, so an effect added tomorrow does not need a line here.
     */
    ...Object.keys(defaultFxParams())
      .filter((key) => key !== 'effect' && key !== 'mix')
      .map((key) => `fx.${key}`),
    // The sequence itself. Every oscillator has different steps, so "away from the default" is true of
    // all of them and says nothing — what a step carries is checked column by column below instead.
    'osc.steps',
    // The count and the place in a run are one idea, and a preset showing a run of one would be showing
    // a hold at rest. `every` above 1 is the check; `offset` at 1 is a legitimate choice within it.
    'hold.offset',
  ])

  it('use every parameter every node has, asked of the nodes and not of a list', () => {
    /*
     * What the check below used to be: a map of feature names written out by hand. It missed the whole
     * HOLD — the node shipped, the map never got an entry, and for its entire life no preset showed
     * one. The test whose only job was to catch that was itself the thing that had fallen behind.
     *
     * So this asks the registry instead. Every node type has a `defaults()`; a parameter nothing moves
     * off its default is a parameter no preset demonstrates, and a node type absent altogether fails on
     * all of its parameters at once. Nothing has to be added here when a parameter is.
     */
    const missing: string[] = []
    for (const definition of NODE_DEFINITIONS) {
      const defaults = definition.defaults() as Record<string, unknown>
      const mine = PRESETS.flatMap((preset) =>
        preset.patch.nodes.filter((node) => node.type === definition.type),
      ).map((node) => node.params as Record<string, unknown>)

      for (const key of Object.keys(defaults)) {
        const name = `${definition.type}.${key}`
        if (NOT_DEMONSTRABLE.has(name)) continue
        /*
         * Merged over the defaults before comparing, which this did not do and should have.
         *
         * A preset names only the parameters it cares about, so every other key is *absent* — and an
         * absent key is not the same as a moved one, though `undefined !== 1` says it is. The check was
         * passing on omission: adding a parameter to a node type satisfied it the moment any preset of
         * that type existed, whatever the preset actually set. Which is what `fromPatch` does anyway,
         * since a patch loaded from a code carries a value for every field.
         */
        const moved = mine.some((params) => {
          const merged = { ...defaults, ...params }
          return JSON.stringify(merged[key]) !== JSON.stringify(defaults[key])
        })
        if (!moved) missing.push(name)
      }
    }
    expect(missing, `no preset moves: ${missing.join(', ')}`).toEqual([])
  })

  it('use every column a step carries, asked of the format and not of a list', () => {
    // The same question the writer asks when it decides whether a column is worth any bits. A column no
    // preset uses is a per-step feature nobody will find — which is exactly what step velocity was.
    const steps = PRESETS.flatMap((preset) => preset.patch.nodes)
      .filter((node) => node.type === 'osc')
      .flatMap((node) => (node.params as OscParams).steps)

    const unused = STEP_COLUMN_USAGE.filter((column) => !steps.some(column.used)).map((c) => c.name)
    expect(unused, `no preset uses: ${unused.join(', ')}`).toEqual([])
  })

  it('found parameters to check, so a broken reader cannot pass by finding none', () => {
    // The failure the two tests above would otherwise have: a registry that stops answering, an empty
    // list of keys, and two green tests that have checked nothing at all.
    const keys = NODE_DEFINITIONS.flatMap((d) => Object.keys(d.defaults()))
    expect(keys.length).toBeGreaterThan(30)
    expect(STEP_COLUMN_USAGE.length).toBeGreaterThan(3)
  })

  it('between them show every idea the machine has, which no schema can name', () => {
    /*
     * What is left once the parameters are asked of the registry: the ideas that are *combinations*, and
     * the enumerated values where one is not enough. A negative depth is a parameter moved off its
     * default and also the whole of ducking, six choices deep with nothing naming it. The three
     * propagation modes are one field, and the field being moved once does not show the other two.
     *
     * This list is allowed to be hand-written because every entry is a sentence about the instrument
     * rather than a field in a type. Nothing belongs here that a schema could have answered.
     */
    const nodes = PRESETS.flatMap((preset) => preset.patch.nodes)
    const oscillators = nodes
      .filter((node) => node.type === 'osc')
      .map((n) => n.params as OscParams)

    const shown: Record<string, boolean> = {
      /*
       * Each direction, for the same reason as the propagation modes below: one field, three values, and
       * moving it once shows one of them. Reverse is audible on the first pass and ping-pong only on the
       * second, so a preset showing one is not showing the other.
       */
      ...Object.fromEntries(
        DIRECTIONS.map((direction) => [
          `direction:${direction}`,
          oscillators.some((params) => (params.direction ?? 'forward') === direction),
        ]),
      ),
      // Each propagation mode, since it is one field and the control the whole instrument turns on.
      // Moving it off its default once shows one of the three; this asks for all of them.
      onEnd: oscillators.some((params) => params.propagateMode === 'onEnd'),
      onStart: oscillators.some((params) => params.propagateMode === 'onStart'),
      onStep: oscillators.some((params) => params.propagateMode === 'onStep'),
      // Both kinds of modulator, and the shape that does not repeat — again one field, three demands.
      lfo: nodes.some((node) => node.type === 'mod' && (node.params as ModParams).kind === 'lfo'),
      envelope: nodes.some(
        (node) => node.type === 'mod' && (node.params as ModParams).kind === 'env',
      ),
      random: nodes.some(
        (node) => node.type === 'mod' && (node.params as ModParams).wave === 'random',
      ),
      /*
       * A modulation pulling *down*, which is the whole of ducking and the one thing here that nobody
       * would find by exploring: an envelope, fired by a trigger, pointed at a level, with the depth
       * taken below zero. Six choices deep and nothing names it, so if no preset shows it, it may as
       * well not exist. A negative depth alone is a parameter off its default; *this* is the idea.
       */
      ducking: nodes.some(
        (node) =>
          node.type === 'mod' &&
          (node.params as ModParams).kind === 'env' &&
          (node.params as ModParams).fires === 'trigger' &&
          (node.params as ModParams).target === 'level' &&
          ((node.params as ModParams).depth ?? 0) < 0,
      ),
      /*
       * A HOLD counting the triggers reaching it rather than the passes — a divider on the steps above
       * it. One value of one field, invisible in the panel, and the reading that makes the node more
       * than a probability gate.
       */
      dividing: nodes.some(
        (node) => node.type === 'hold' && (node.params as HoldParams).counts === 'triggers',
      ),
      // An Ignite that waits to be played rather than being seeded by the transport, which is the whole
      // of playing this thing by hand.
      bound: nodes.some(
        (node) => node.type === 'start' && (node.params as StartParams).trigger === 'bound',
      ),
    }

    const missing = Object.entries(shown)
      .filter(([, there]) => !there)
      .map(([what]) => what)
    expect(missing, `no preset shows: ${missing.join(', ')}`).toEqual([])
  })

  it.each(PRESETS)('$name survives the trip through a patch code', ({ patch }) => {
    // Which is how it will be shared once somebody edits one, and the code is lossy by design: anything
    // that does not survive the round trip was never really part of the patch.
    const back = decodePatch(encodePatch(patch))
    expect(back).not.toBeNull()
    expect(back!.nodes).toHaveLength(patch.nodes.length)
    expect(back!.edges).toHaveLength(patch.edges.length)
    expect(back!.bpm).toBe(patch.bpm)
  })
})
