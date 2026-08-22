import { MOD_COST, resolveTarget, targetOf } from './modulation'
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
 * **These numbers are measured, not reasoned** — by `tools/measureLoad.ts`, which times an offline
 * render with and without one unit of work and reports the difference in this same unit. It needs a
 * browser and so cannot be a test; run it with `npm run measure`.
 *
 * They replaced a set of reasoned numbers, and three of the guesses were wrong in an instructive way.
 * The reasoning priced each node by the arithmetic it performs per sample. What the measurements say
 * is that **the arithmetic barely matters and the node does**: a biquad, which is a handful of
 * multiply-adds, costs most of an oscillator. Per-node overhead dominates, so cost tracks node count
 * and not the work inside them — except where a parameter is automated, which pushes a node from
 * recomputing its coefficients per block to per sample, and that is where the dearest effects are.
 *
 * **And then they were measured a second way, in realtime, and three of them were light.** An offline
 * render is a batch: the cache behaves, and per-block overheads amortise. Live, every 128 samples is a
 * fresh visit, and the correction turns out to scale with how much *memory traffic* a node drags with
 * it — a buffer read exactly right, a biquad a shade light, a convolver light by half.
 *
 * The two methods now agree to within 1.3 % across five completely different kinds of work, which is
 * why the numbers below are believable and not merely measured. See PLAN §11.11.
 */

/**
 * The ceiling, measured rather than chosen — and measured **with this engine playing real notes**.
 *
 * `AudioContext.playbackStats` counts underruns: blocks the audio thread failed to deliver, each one
 * audible. Ramping the engine's own voices until that counter moves is the definition of a ceiling
 * rather than a proxy for one, and it does so at a little over three thousand points here.
 *
 * Three wrong answers preceded it, and each was wrong for a different reason worth remembering.
 *
 * **A hundred** was chosen, not measured, because it made the meter read as a percentage. Wrong by a
 * factor of thirty, and not harmlessly: `LAYER_THRESHOLD` below is a share of this, so a single reverb
 * at full decay held every oscillator permanently in restart-instead-of-layer and nothing said why.
 *
 * **Five thousand** came from ramping hand-built voices — an oscillator through a *constant* gain,
 * sustained. A voice this engine builds carries a scheduled envelope, which makes its gain a-rate
 * rather than k-rate, and is created and destroyed on every note. Those two cost about 1.67× the
 * difference, and the model counts both at zero — which is fine, because measuring in the app's own
 * units absorbs them into this number rather than needing a correction per voice.
 *
 * **Five hundred** was an extrapolation from Chrome's render-capacity *peaks*, and peaks are not the
 * failure criterion: the thread only drops a sample when it sustains past its budget. Peaks overstated
 * the load by six times.
 *
 * **And it is not one number.** Three ramps, all valid, broke at different point counts depending on
 * what they were made of:
 *
 * | composition | broke at |
 * | --- | --- |
 * | 62 % reverb, short notes | 3106 |
 * | 45 % reverb, long notes | 3742 |
 * | voices only | 3108 |
 *
 * Not monotonic in reverb share, so it is not a mispriced effect. The likeliest remainder is the cost
 * of *building* a note — the run with the shortest notes churned through the most of them and broke
 * earliest — which this model counts at zero along with everything else about construction.
 *
 * Three unknowns can be fitted to three readings and the fit is meaningless, so it has not been. What
 * matters is the spread: **twenty per cent**, and `LAYER_THRESHOLD` already holds back twenty-five.
 * The margin that exists for slower machines absorbs the whole uncertainty, so the number below is the
 * lowest of the three, rounded down. Voices only is also the closest of the three to a real patch,
 * since a patch is mostly voices.
 *
 * Calibrated on an Apple Silicon Mac with nothing else running. A device several times slower will
 * glitch below a full meter, and `LAYER_THRESHOLD` is the only margin standing between — which is
 * enough for a somewhat slower machine and not for a phone.
 */
export const MAX_LOAD = 2750

/** Past this share of the budget, oscillators restart instead of layering. */
export const LAYER_THRESHOLD = 0.75

/**
 * A per-voice biquad, measured at most of an oscillator — against a reasoned 0.3.
 *
 * The arithmetic in a biquad really is trivial, which is what the old guess was about. What it costs
 * is being a second node in the graph at all.
 *
 * 0.8 offline and 1.05 in realtime, and the realtime figure is the one that matters: 2500 filtered
 * voices saturate the audio thread exactly as 5100 plain ones do. A phaser's four swept biquads landed
 * on the same 13 % correction independently, which is what makes it a property of biquads rather than
 * a stray reading.
 */
const FILTER_COST = 1.05

export function voiceCost(waveform: Waveform, filtered: boolean): number {
  // Both halves of this were guessed wrong. A `PeriodicWave` is not dearer than a native type —
  // measured identical, since a native oscillator is a wavetable read too, and the wave is built once
  // and cached. And a noise buffer is not cheaper but more than twice the price: it is a looping
  // resample with interpolation, against an oscillator Chrome has spent years making fast.
  const source = isNoise(waveform) ? 2.2 : 1
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
  const swept = sweepCost(patch)

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
  return effects + modulators + swept + widest * PEAK_ALLOWANCE
}

/**
 * What the modulation cables cost the things they are pointed at.
 *
 * Separate from what the modulators themselves cost, because it is a property of the destination:
 * sweeping a gain is free and sweeping a filter is not. A per-voice one — an oscillator's filter is
 * built per note — is multiplied by how many voices that oscillator has in the air, which is the same
 * overlap the voice count uses.
 */
function sweepCost(patch: Patch): number {
  const byId = new Map(patch.nodes.map((node) => [node.id, node]))
  let total = 0

  for (const edge of patch.edges) {
    if (edge.kind !== 'mod') continue
    const mod = byId.get(edge.source)
    const destination = byId.get(edge.target)
    if (!mod || !destination) continue

    const effect = destination.type === 'fx' ? (destination.params as FxParams).effect : undefined
    // Through `resolveTarget`, so a MOD pointing at something its destination no longer offers is
    // priced as the fallback it will actually be modulating rather than as what it says.
    const key = resolveTarget((mod.params as { target?: string }).target, destination.type, effect)
    const target = key ? targetOf(key, destination.type, effect) : undefined
    if (!target || target.surcharge === 0) continue

    total += target.perVoice
      ? target.surcharge * voiceOverlap(destination.params as OscParams, patch.bpm)
      : target.surcharge
  }

  return total
}
