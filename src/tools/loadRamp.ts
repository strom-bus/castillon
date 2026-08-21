/**
 * A load that can be turned up, out of the things a patch is actually made of.
 *
 * The first version built plain sine voices, which measured the ceiling in the unit `load.ts` counts
 * in and proved that a machine manages about 5400 of them. It could not answer the question that
 * matters next: **is a point still a point at that scale?** A reverb is priced at some thirty voices,
 * so 4900 points ought to be about 158 reverbs — and nobody has ever checked whether it is. A
 * convolver's peaks may not behave like a sine's however well their averages agree.
 *
 * So the ramp is built from real content now, one kind at a time, and it reports **both** numbers: the
 * points the app would count, and what share of the ceiling that is. Chrome's WebAudio panel reports
 * its own percentage beside it. Where the two agree, the model holds; where they diverge, that kind of
 * work is mispriced at scale, and which way tells you which.
 */

import { effectOr } from '../audio/effects'
import { effectCost, voiceCost } from '../audio/load'
import { fillNoise } from '../audio/noise'
import type { FxParams } from '../types/patch'

/**
 * The ceiling under test: a shade below where this machine first failed.
 *
 * Not committed to `load.ts` yet, deliberately. It is the number being *checked* — writing it in
 * before the check would make the check circular.
 */
export const CEILING = 4900

/** What a rung of the ramp is made of. */
export type LoadKind = 'sine' | 'filtered' | 'noise' | 'reverb' | 'phaser' | 'mixed'

export const LOAD_KINDS: readonly LoadKind[] = [
  'sine',
  'filtered',
  'noise',
  'reverb',
  'phaser',
  'mixed',
]

export const LOAD_LABELS: Record<LoadKind, string> = {
  sine: 'Plain voices',
  filtered: 'Filtered voices',
  noise: 'Noise voices',
  reverb: 'Reverbs',
  phaser: 'Phasers',
  mixed: 'A mixture',
}

/** Why each kind is in the list, shown beside it so a reading can be interpreted. */
export const LOAD_NOTES: Record<LoadKind, string> = {
  sine: 'The unit itself: one point each, by definition. The reading that set the ceiling.',
  filtered:
    'A biquad per voice, priced at 1.8. Tests whether a second node really costs most of one.',
  noise: 'A looping resample, priced at 2.2 — the guess that turned out backwards when measured.',
  reverb:
    'A convolver each, the dearest thing here. If a point is not a point, this is where it shows.',
  phaser:
    'Four swept biquads each. The automated-parameter cost, which nothing else here isolates.',
  mixed: 'One of each in rotation, which is what a patch is actually made of.',
}

export interface Ramp {
  /** How many units of the chosen kind are running. */
  units(): number
  /** What the app's own accounting would make of that. */
  points(): number
  add(units: number): void
  stop(): Promise<void>
}

const REVERB = { effect: 'reverb', mix: 0.8, ...effectOr('reverb').defaults } as FxParams
const PHASER = { effect: 'phaser', mix: 0.8, ...effectOr('phaser').defaults } as FxParams

/**
 * Builds load out of real content and keeps the app's own tally of it.
 *
 * Not through the engine, and not as a shortcut: the engine steals a voice whenever the next would
 * cross `MAX_LOAD`, so it cannot be asked to exceed the number under test. What it does borrow is the
 * cost functions, so the points counted here are the points the meter would show.
 */
export async function startRamp(kind: LoadKind): Promise<Ramp> {
  const ctx = new AudioContext()
  await ctx.resume()

  // Quiet enough not to hurt, loud enough that nothing about it is optimisable: silence is something a
  // browser may skip, and a skipped measurement measures nothing.
  const master = ctx.createGain()
  master.gain.value = 0.005
  master.connect(ctx.destination)

  const running: Array<{ stop(): void }> = []
  let points = 0
  let noiseBuffer: AudioBuffer | null = null

  function quieten() {
    // Kept roughly constant however many are running, so a ramp does not become painful on the way up.
    master.gain.value = 0.02 / Math.sqrt(Math.max(1, running.length))
  }

  /** One sustained voice, with or without its own filter. */
  function voice(index: number, filtered: boolean, noise: boolean): AudioNode {
    const gain = ctx.createGain()
    gain.gain.value = 0.4

    let source: AudioScheduledSourceNode
    if (noise) {
      if (!noiseBuffer) {
        noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
        fillNoise('white', noiseBuffer.getChannelData(0))
      }
      const player = ctx.createBufferSource()
      player.buffer = noiseBuffer
      player.loop = true
      // Off unity, so the resampling that makes noise dear is actually happening.
      player.playbackRate.value = 0.7 + (index % 13) / 20
      source = player
    } else {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      // Spread across the register, so nothing is measured at one frequency by accident.
      osc.frequency.value = 80 * Math.pow(2, (index % 36) / 12)
      source = osc
    }

    let tail: AudioNode = source
    if (filtered) {
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 600 + (index % 40) * 90
      filter.Q.value = 4
      tail = tail.connect(filter)
    }
    tail.connect(gain)
    source.start()

    points += voiceCost(noise ? 'white' : 'sine', filtered)
    running.push({
      stop() {
        try {
          source.stop()
        } catch {
          // Already stopped.
        }
      },
    })
    return gain
  }

  /** One effect with a voice feeding it, since an effect with silence at its input is a different test. */
  function effect(index: number, params: FxParams): void {
    const descriptor = effectOr(params.effect)
    const chain = descriptor.create(ctx)
    const wet = ctx.createGain()
    wet.gain.value = 0.5
    chain.output.connect(wet).connect(master)
    chain.update(params, { at: ctx.currentTime, bpm: 120 })

    voice(index, false, false).connect(chain.input)
    points += effectCost(params)
    running.push({ stop: () => chain.dispose?.() })
  }

  function addOne(index: number): void {
    switch (kind) {
      case 'sine':
        voice(index, false, false).connect(master)
        break
      case 'filtered':
        voice(index, true, false).connect(master)
        break
      case 'noise':
        voice(index, false, true).connect(master)
        break
      case 'reverb':
        effect(index, REVERB)
        break
      case 'phaser':
        effect(index, PHASER)
        break
      case 'mixed':
        // A rotation rather than a random draw, so two runs are the same run.
        if (index % 4 === 3) effect(index, index % 8 === 3 ? REVERB : PHASER)
        else voice(index, index % 4 !== 0, index % 4 === 2)
        break
    }
  }

  let added = 0

  return {
    units: () => added,
    points: () => points,
    add(units) {
      for (let i = 0; i < units; i++) addOne(added++)
      quieten()
    },
    async stop() {
      for (const item of running) item.stop()
      running.length = 0
      await ctx.close()
    },
  }
}
