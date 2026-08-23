/**
 * The load-test patch, built rather than saved.
 *
 * It used to live only as a code in `docs/stress-patch.txt`, made by hand in the app and pasted in. That
 * had to be redone on every change to the patch-code format — four times so far — and each time it was an
 * operation nobody could check: a wrong paste produces a code that decodes to a slightly different patch,
 * and nothing about the file would look wrong.
 *
 * Here it is a function, so regenerating is `npm run stress` and the numbers written in the file come
 * from the same source as the code underneath them. `stressPatch.test.ts` checks the file still matches.
 *
 * What it is for: sitting past the point where the engine begins degrading and short of where it breaks.
 * A load test that always glitches says nothing, and one that never does says less.
 */

import { stepDuration } from '../audio/clock'
import { EFFECTS } from '../audio/effects'
import { FILTER_TYPES } from '../audio/filter'
import { effectCost, voiceCost } from '../audio/load'
import { WAVEFORMS } from '../audio/waveforms'
import { defaultFxParams, defaultOscParams } from '../nodes/registry'
import type {
  Division,
  FxParams,
  OscParams,
  Patch,
  PatchEdge,
  PatchNode,
  Step,
} from '../types/patch'
import type { ScaleName } from '../audio/scales'

const COLUMN = 560
const ROW = 230
/** Wide enough that forty-eight siblings are something to look at rather than a mile of canvas. */
const PER_ROW = 8
const OSCILLATORS = 48
const REVERBS = 5
/** Fast, so the note rate is high and voices pile up inside their own releases. */
const BPM = 300
/**
 * The one control that multiplies the note rate of every oscillator at once.
 *
 * Half again rather than double: at double the patch lands past the ceiling, and a load test that is
 * certain to break tells you nothing about where breaking begins.
 */
const WARP_SPEED = 1.5

const DIVISIONS: Division[] = ['1/4', '1/8', '1/16']
const LENGTHS = [2, 4, 8, 16]
const SCALES: Exclude<ScaleName, 'free'>[] = ['minor', 'dorian', 'pentatonic', 'blues']

/**
 * Every step carrying everything a step can carry.
 *
 * Not for completeness: each of these is load as well as format. A roll puts four voices where one was,
 * and per-step velocity exercises the whole gain path rather than the single value a patch of full-level
 * notes tests. A load test that only covers the parameters that existed when it was written stops being
 * a test of the engine and becomes a test of its history.
 */
function stepsFor(index: number, length: number): Step[] {
  return Array.from({ length }, (_, s) => ({
    note: 36 + ((index * 5 + s * 3) % 36),
    active: true,
    velocity: 0.55 + ((index + s) % 4) * 0.15,
    ...(index % 4 === 0 ? { ratchet: 2 + (s % 3), ratchetRamp: s % 2 === 0 ? 0.7 : -0.5 } : {}),
    // High enough that the voice is nearly always there: a load test that rolls its own dice measures a
    // different patch every time it runs.
    ...(index % 6 === 0 ? { chance: 0.85 } : {}),
    ...(s % 5 === 0 ? { slide: true } : {}),
  }))
}

function oscFor(index: number): OscParams {
  const filterType = FILTER_TYPES[index % FILTER_TYPES.length]!
  return {
    ...defaultOscParams(),
    waveform: WAVEFORMS[index % WAVEFORMS.length]!,
    pulseWidth: 0.2 + (index % 5) * 0.15,
    steps: stepsFor(index, LENGTHS[index % LENGTHS.length]!),
    division: DIVISIONS[index % DIVISIONS.length]!,
    scale: SCALES[index % SCALES.length]!,
    scaleRoot: (index * 5) % 12,
    useChance: index % 6 === 0,
    useRatchet: index % 4 === 0,
    // Low, because forty-eight of these sum: the point is the work, not the volume.
    gain: 0.06,
    attack: 2 + (index % 7),
    decay: index % 3 === 0 ? 120 + (index % 5) * 80 : 0,
    // Long, and this is where the load is. A note still fading is still a voice, so a release several
    // times the step length is what makes one oscillator hold forty at once.
    release: 500 + (index % 6) * 100,
    gate: 0.9,
    glide: index % 5 === 0 ? 80 : 0,
    detune: ((index % 7) - 3) * 4,
    filterType,
    cutoff: 400 + (index % 12) * 450,
    resonance: 1 + (index % 10),
    keyTrack: filterType === 'off' ? 0 : (index % 5) * 0.25,
    // All sounding at once. On `onEnd` they would sound one at a time and the patch would measure one
    // per cent, which is what the first version of this file did for months.
    propagateMode: 'onStart',
  }
}

export function stressPatch(): Patch {
  const nodes: PatchNode[] = []
  const edges: PatchEdge[] = []
  const wire = (source: string, target: string, kind: PatchEdge['kind'] = 'event') =>
    edges.push({ id: `e${edges.length}`, kind, source, target })

  nodes.push({ id: 'ign', type: 'start', position: { x: 0, y: 0 }, params: {} })

  /*
   * One oscillator under the Ignite, and the other forty-seven under that one.
   *
   * They still all sound together — the first propagates `onStart`, so its children begin when it does
   * rather than after it — and the shape is not cosmetic. A WARP attaches to an oscillator, because an
   * oscillator is the only thing that plays notes, and it reaches everything the cascade reaches from
   * there. Forty-eight siblings directly under the Ignite have no such node: a warp could only take one
   * of them. Under a single head, one warp takes all forty-eight, which is what makes the speed control
   * below measurable at all.
   *
   * This used to hang the warp on the Ignite instead, which the rules permitted and the canvas could
   * not draw — an invisible cable on a patch whose whole purpose is to be looked at while it plays.
   */
  for (let i = 0; i < OSCILLATORS; i++) {
    const id = `o${i}`
    nodes.push({
      id,
      type: 'osc',
      position: {
        x: (i % PER_ROW) * COLUMN,
        y: (1 + Math.floor(i / PER_ROW)) * ROW,
      },
      params: oscFor(i),
    })
    wire(i === 0 ? 'ign' : 'o0', id)
  }

  // The reverbs are where the effect budget is: one at its longest decay is worth about fifty voices.
  for (let i = 0; i < REVERBS; i++) {
    const id = `rv${i}`
    nodes.push({
      id,
      type: 'fx',
      position: { x: (PER_ROW + (i % 2)) * COLUMN, y: (1 + i) * ROW },
      params: {
        ...defaultFxParams(),
        effect: 'reverb',
        mix: 0.5,
        decay: 8,
        cutoff: 3000,
      } as FxParams,
    })
    wire(`o${i * 9}`, id, 'audio')
  }

  EFFECTS.filter((effect) => effect.kind !== 'reverb')
    .slice(0, 5)
    .forEach((descriptor, i) => {
      const id = `fx${i}`
      nodes.push({
        id,
        type: 'fx',
        position: { x: (PER_ROW + 2 + (i % 2)) * COLUMN, y: (1 + i) * ROW },
        params: {
          ...defaultFxParams(),
          ...descriptor.defaults,
          effect: descriptor.kind,
          mix: 0.6,
        } as FxParams,
      })
      wire(`o${i * 7 + 1}`, id, 'audio')
    })

  /*
   * And a warp on the head oscillator, which reaches every one below it.
   *
   * Speed is the only control in the instrument that changes the load rather than only the sound: all
   * forty-eight fire proportionally more notes into the same release tail. It also puts the warp path
   * itself under load, which nothing else in this patch would.
   */
  nodes.push({
    id: 'wp',
    type: 'warp',
    position: { x: -COLUMN, y: ROW },
    params: { transpose: 0, speed: WARP_SPEED },
  })
  wire('wp', 'o0', 'warp')

  return { version: 1, bpm: BPM, loop: true, nodes, edges }
}

/**
 * What the patch will actually cost, which is not what the meter's estimate says.
 *
 * `estimatePeakLoad` caps how many voices an oscillator is assumed to be holding at four. That cap keeps
 * the dice from refusing to roll anything and makes it blind to exactly this patch, where each one holds
 * about forty. Here the overlap comes from the note rate and the release, so the figures printed in the
 * file are the ones the audio thread will be carrying.
 */
export function stressLoad(patch: Patch): { voices: number; effects: number; overlap: number } {
  let voices = 0
  const overlaps: number[] = []

  for (const node of patch.nodes.filter((one) => one.type === 'osc')) {
    const params = node.params as OscParams
    const warped = patch.nodes.some((one) => one.type === 'warp')
    const step = stepDuration(patch.bpm, params.division) / (warped ? WARP_SPEED : 1)
    const hits = params.useRatchet
      ? params.steps.reduce((sum, s) => sum + Math.min(4, s.ratchet ?? 1), 0)
      : params.steps.length
    const rate = hits / (params.steps.length * step)
    const life = step * params.gate + params.release / 1000
    const overlap = Math.max(1, rate * life)
    overlaps.push(overlap)
    voices +=
      overlap * voiceCost(params.waveform ?? 'square', (params.filterType ?? 'off') !== 'off')
  }

  return {
    voices,
    effects: patch.nodes
      .filter((one) => one.type === 'fx')
      .reduce((sum, one) => sum + effectCost(one.params as FxParams), 0),
    overlap: overlaps.reduce((a, b) => a + b, 0) / overlaps.length,
  }
}
