import { MOD_COST } from './modulation'
import type { FxParams, OscParams, Patch, Waveform } from '../types/patch'
import { stepDuration } from './clock'
import { effectOr } from './effects'
import { isNoise } from './waveforms'

/**
 * What a patch costs to run, in points.
 *
 * **One point is one plain oscillator voice.** That choice matters: an arbitrary unit would make the
 * meter meaningless and calibration a guess, whereas this lets a sentence like "that reverb costs
 * fifteen oscillators" be true. It also means a patch with no effects and no filters behaves exactly
 * as it did when the budget counted voices and nothing else.
 *
 * A hundred is the ceiling, so the meter reads directly as a percentage.
 *
 * **These numbers are reasoned, not measured.** Web Audio exposes no cost metric, so they come from
 * what each node actually does per sample — a four-times-oversampled waveshaper really is about four
 * times the work — and they are all in this one file so a listening session can retune them.
 */
export const MAX_LOAD = 100

/** Past this share of the budget, oscillators restart instead of layering. */
export const LAYER_THRESHOLD = 0.75

/** A biquad is a handful of multiply-adds: cheap next to an oscillator's band-limiting. */
const FILTER_COST = 0.3

export function voiceCost(waveform: Waveform, filtered: boolean): number {
  // A PeriodicWave is a band-limited table read, dearer than a native type; a noise buffer is a
  // resampled read, slightly cheaper.
  const source = isNoise(waveform) ? 0.9 : waveform === 'pulse' || waveform === 'ramp' ? 1.2 : 1
  return source + (filtered ? FILTER_COST : 0)
}

export function oscVoiceCost(params: OscParams): number {
  return voiceCost(params.waveform ?? 'square', (params.filterType ?? 'off') !== 'off')
}

/** Whatever the effect declares, since what an effect is made of is the effect's own business. */
export function effectCost(params: FxParams): number {
  return effectOr(params.effect).cost(params)
}

/**
 * How many of one oscillator's voices overlap.
 *
 * A voice lasts its gate plus its release while steps arrive one step apart, so a long release under
 * a fast division stacks several at once — which is the single biggest thing a voice count hides.
 * Capped, because past a few the engine's own layering limit takes over anyway.
 */
export function voiceOverlap(params: OscParams, bpm: number): number {
  const step = stepDuration(bpm, params.division ?? '1/8')
  const held = (params.gate ?? 0.6) + (params.release ?? 40) / 1000 / step
  return Math.min(4, Math.max(1, held))
}

/** Tails from the level before, and the loop wrapping onto itself. */
const PEAK_ALLOWANCE = 1.25

/**
 * An estimate of a patch's peak load, for deciding how large a random roll may be.
 *
 * It is not what the meter shows — the meter measures what is actually sounding. This predicts the
 * worst moment, and does it by depth: every Ignite fires together, so oscillators at the same
 * distance from one sound together, while depth is sequential. The widest level is the peak.
 *
 * Deliberately an over-estimate. A roll that comes in under budget is a roll that plays.
 */
export function estimatePeakLoad(patch: Patch): number {
  const effects = patch.nodes
    .filter((n) => n.type === 'fx')
    .reduce((sum, n) => sum + effectCost(n.params as FxParams), 0)

  // A modulator runs whether or not anything is playing, so it is standing cost like an effect. Left
  // out, a patch of oscillators and modulators would read as cheaper than it is.
  const modulators = patch.nodes.filter((n) => n.type === 'mod').length * MOD_COST

  const children = new Map<string, string[]>()
  for (const edge of patch.edges) {
    if (edge.kind !== 'event') continue
    const list = children.get(edge.source)
    if (list) list.push(edge.target)
    else children.set(edge.source, [edge.target])
  }

  const byId = new Map(patch.nodes.map((n) => [n.id, n]))
  const perLevel = new Map<number, number>()
  let queue = patch.nodes.filter((n) => n.type === 'start').map((n) => n.id)
  const seen = new Set(queue)

  for (let level = 0; queue.length > 0 && level < 64; level++) {
    const next: string[] = []
    for (const id of queue) {
      const node = byId.get(id)
      if (node?.type === 'osc') {
        const params = node.params as OscParams
        const cost = oscVoiceCost(params) * voiceOverlap(params, patch.bpm)
        perLevel.set(level, (perLevel.get(level) ?? 0) + cost)
      }
      for (const child of children.get(id) ?? []) {
        if (seen.has(child)) continue
        seen.add(child)
        next.push(child)
      }
    }
    queue = next
  }

  const widest = Math.max(0, ...perLevel.values())
  return effects + modulators + widest * PEAK_ALLOWANCE
}
