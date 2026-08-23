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
import { LAYER_THRESHOLD, MAX_LOAD } from '../audio/load'
import { silentBecause, targetsFor } from '../audio/modulation'
import { decodePatch, encodePatch } from '../state/patchCode'
import type { Patch, PatchNode } from '../types/patch'

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
  it('are three, each with a name and a line saying what it is for', () => {
    expect(PRESETS).toHaveLength(3)
    for (const preset of PRESETS) {
      expect(preset.name.trim().length).toBeGreaterThan(0)
      expect(preset.about.trim().length).toBeGreaterThan(20)
    }
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
      .filter((node) => node.type === 'osc' || node.type === 'delay')
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

  it.each(PRESETS)('$name stays well inside the budget', ({ patch }) => {
    /*
     * Under the threshold where the engine starts stealing voices rather than layering them, not merely
     * under the ceiling: a preset is the reference for what a healthy patch looks like, and one that
     * arrives already degrading teaches the wrong thing. Slower machines than this one will open it too.
     */
    const load = estimatePeakLoad(patch)
    expect(load).toBeGreaterThan(0)
    expect(load, `${load.toFixed(0)} points`).toBeLessThan(MAX_LOAD * LAYER_THRESHOLD)
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
