import {
  MAX_DECAY,
  MAX_EQ_DB,
  MAX_SWEEP,
  MIN_DECAY,
  MIN_SWEEP,
  type EffectKind,
  type FxParams,
} from '../types/patch'
import { stepDuration } from './clock'
import {
  MAX_BITS,
  MAX_COMB_NOTE,
  MAX_REDUCTION,
  MIN_COMB_NOTE,
  MIN_REDUCTION,
  crushCurve,
  distortionCurve,
  fillImpulse,
  foldCurve,
} from './dsp'
import { COMB, DECIMATOR, OCTAVE } from './worklets/names'
import type { Random } from './random'
import { MAX_CUTOFF, MIN_CUTOFF } from './filter'

/** What an effect needs to know beyond its own parameters. */
export interface EffectContext {
  /** Absolute time on the audio clock. */
  at: number
  /** Needed by anything synced to the transport, which is why a tempo change updates effects. */
  bpm: number
}

/**
 * The live half of an effect: the chain that sits between an FX node's fixed input and output.
 *
 * Only the middle. The input and output `GainNode`s belong to the node itself and are never
 * replaced, which is what lets the effect be swapped from a dropdown without any cable in the
 * patch noticing.
 */
export interface EffectChain {
  input: AudioNode
  output: AudioNode
  update(params: FxParams, context: EffectContext): void
  /** Called after the node's output has already been faded out. */
  dispose(): void
  /**
   * The `AudioParam` behind one of this effect's parameters, where there is one.
   *
   * How a MOD reaches inside an effect (PLAN §18). Only some parameters have one: a cutoff is a
   * filter's frequency and can be connected to, while a reverb's decay rebuilds an impulse response
   * and a bitcrusher's depth rebuilds a curve — neither is a parameter Web Audio can add a signal to,
   * so those are driven by recomputation instead and answer `null` here.
   *
   * Several are allowed, because some parameters are not one node: a phaser's centre is spread across
   * four all-pass stages and an echo's time governs two delay lines, and modulating one of each would
   * pull the effect apart rather than sweep it.
   */
  paramFor?(key: string): AudioParam | AudioParam[] | null
}

export interface EffectDescriptor {
  kind: EffectKind
  label: string
  /**
   * The parameters the inspector shows beneath Mix, in order. Mix is not listed: every effect has
   * it, and it belongs to the node rather than to the chain.
   */
  params: readonly (keyof FxParams)[]
  /**
   * Overrides for what a parameter is called here. The same `cutoff` is a Tone control on a
   * shaping stage and the whole point on a filter, and calling it the same thing in both places
   * would be worse than either name.
   */
  labels?: Partial<Record<keyof FxParams, string>>
  /**
   * Starting values that suit this effect. One shared set of defaults cannot serve all of them —
   * a chorus wants a slow shallow wobble and a tremolo a fast deep one from the same two fields —
   * so switching to an effect adopts these for the parameters the previous effect was not using.
   * Anything both effects use carries over untouched.
   */
  defaults?: Partial<FxParams>
  /** Seconds the node's output is faded over before disposal, so removing a node does not click. */
  releaseTime: number
  /**
   * Seconds this keeps sounding after its input stops, for an export that has to wait for it.
   *
   * A **different question** from `releaseTime`, and conflating the two cut the tail off every export
   * this instrument has ever produced. A release is how long to fade a node out when somebody deletes
   * it — a hundredth of a second is plenty, because the point is only to avoid a click. A tail is how
   * long the effect goes on making sound on its own, which for a reverb is its whole decay: 0.4 against
   * 3.2 meant a preset exported with 2.8 seconds of its reverb missing, and the stress patch lost 7.6.
   *
   * Declared per effect for the same reason `cost` is: what an effect is made of is the effect's own
   * business, and only nine of the twelve have any memory at all. Absent means the release is the whole
   * of it, which is the honest answer for anything built from a curve or a gain.
   */
  tail?(params: FxParams, bpm: number): number
  /**
   * What running this costs, in points, where one point is one plain oscillator voice. Declared here
   * because what an effect is made of is the effect's own business. See audio/load.ts for the unit.
   */
  cost(params: FxParams): number
  /**
   * Builds the chain. `random` is threaded through for the one effect that generates a buffer — a
   * reverb's impulse response is noise — so that a render can be reproducible; the other nine ignore
   * it, and it defaults to `Math.random` for live playback.
   */
  create(ctx: BaseAudioContext, random?: Random): EffectChain
}

const RAMP = 0.02

/**
 * A decay in seconds, read the one way, so that what an effect is *priced* for and what it is *waited*
 * for cannot disagree.
 *
 * The fallback matters more than it looks. A patch node always carries defaults, but a hand-built one or
 * one arriving from an older code need not — and the first version of the tail answered nought for a
 * reverb with no decay set, which is a reverb the render waits no time at all for. The number `cost` has
 * always used is the honest one to wait for.
 */
function decaySeconds(params: FxParams, fallback: number): number {
  return Math.min(MAX_DECAY, Math.max(MIN_DECAY, params.decay ?? fallback))
}

/** The tone control the effects share: a low-pass, gentle enough to shape rather than to filter. */
function tone(ctx: BaseAudioContext): BiquadFilterNode {
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.Q.value = 0.7
  filter.frequency.value = MAX_CUTOFF
  return filter
}

function setTone(filter: BiquadFilterNode, params: FxParams, at: number): void {
  const hz = Math.min(MAX_CUTOFF, Math.max(MIN_CUTOFF, params.cutoff ?? MAX_CUTOFF))
  filter.frequency.setTargetAtTime(hz, at, RAMP)
}

const reverb: EffectDescriptor = {
  kind: 'reverb',
  // 12.5 per second of tail offline, and 20 in realtime — a hundred reverbs saturate the audio thread
  // where the model expected a hundred and fifty-eight. Convolution is where an offline render is most
  // optimistic, and for a reason: it walks a long impulse against the input, which a batch render
  // caches well and a live one revisits every 128 samples.
  //
  // The dearest thing here by a wide margin, and it scales with the tail, so the coefficient carries
  // the shape. At full decay it is two hundred points — a fifth of the ceiling for one node, which is
  // true rather than discouraging.
  cost: (params) => 15 * decaySeconds(params, 2.5),
  label: 'Reverb',
  params: ['decay', 'cutoff'],
  defaults: { decay: 2.5, cutoff: 4000 },
  // Long enough that removing the node lets the tail out rather than cutting it off.
  releaseTime: 0.4,
  // The impulse response is `decay` seconds long, so that is exactly how long a reverb rings on after
  // the last thing to reach it.
  tail: (params) => decaySeconds(params, 2.5),
  create(ctx, random = Math.random) {
    const convolver = ctx.createConvolver()
    const damping = tone(ctx)
    convolver.connect(damping)
    let built = -1

    return {
      input: convolver,
      output: damping,
      update(params, { at }) {
        setTone(damping, params, at)

        // Rebuilding the impulse response allocates, so it only happens once the decay has moved
        // enough to hear. Without this, dragging the slider would rebuild it every frame.
        const decay = Math.round(params.decay * 10) / 10
        if (decay === built) return
        built = decay

        convolver.buffer = impulseFor(ctx, decay, random)
      },
      paramFor(key) {
        return key === 'cutoff' ? damping.frequency : null
      },
      dispose() {
        convolver.disconnect()
        damping.disconnect()
        /*
         * And let go of the impulse response, which disconnecting does not.
         *
         * It is the only allocation here big enough to matter: a two-and-a-half second tail is a megabyte,
         * one per effect rather than one shared, so a trial holding sixty-six of them is sixty-three. A
         * disconnected convolver still owns its buffer, so all of that stayed anchored until the whole
         * context was collected — and a sweep repeats the subject a dozen times over.
         */
        convolver.buffer = null
      },
    }
  },
}

/**
 * Distinct tails kept per decay, rather than one per reverb.
 *
 * Not one shared tail: two reverbs on the same impulse response are perfectly correlated, so they sum
 * three decibels louder and lose the diffusion that is the point of a room. Four is plenty of
 * incoherence — nobody can hear the fifth reverb repeating the first — and it turns what a load of them
 * costs from linear into constant.
 *
 * A megabyte per second of tail is nothing for the three or four reverbs a patch has, and it is a hundred
 * and fifty megabytes for a measurement holding seventy-nine. That measurement is where it was found: a
 * sweep stopped while building them, not in any loop, with the tab frozen in collection and no watchdog
 * able to fire because nothing was running to fire it.
 */
const IMPULSE_VARIANTS = 4

/** Keyed weakly, so a closed context takes its tails with it rather than outliving the render. */
const impulses = new WeakMap<BaseAudioContext, Map<string, AudioBuffer[]>>()

function impulseFor(ctx: BaseAudioContext, decay: number, random: () => number): AudioBuffer {
  let forContext = impulses.get(ctx)
  if (!forContext) {
    forContext = new Map()
    impulses.set(ctx, forContext)
  }

  const key = decay.toFixed(1)
  let kept = forContext.get(key)
  if (!kept) {
    kept = []
    forContext.set(key, kept)
  }

  if (kept.length < IMPULSE_VARIANTS) {
    const length = Math.max(1, Math.floor(decay * ctx.sampleRate))
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
    // Straight into the buffer's own storage: building each channel separately and copying it in
    // allocates the whole tail twice.
    fillImpulse(buffer.getChannelData(0), random)
    fillImpulse(buffer.getChannelData(1), random)
    kept.push(buffer)
    return buffer
  }

  // Drawn from the same source of randomness as the tails themselves, so a seeded render still renders
  // the same thing twice.
  return kept[Math.floor(random() * kept.length)] as AudioBuffer
}

const distortion: EffectDescriptor = {
  kind: 'distortion',
  // Four-times oversampling means the shaper and two resampling filters. Arithmetic guessed 3.5, the
  // offline harness said 15, and a sweep against a real dropout settled it at 10.9 — so the guess was
  // directionally right and three times low, and the render was half again too high.
  cost: () => 10.9,
  label: 'Distortion',
  params: ['shape', 'drive', 'cutoff'],
  defaults: { drive: 0.4, cutoff: 4000 },
  releaseTime: 0.02,
  create(ctx) {
    const shaper = ctx.createWaveShaper()
    // Distortion folds harmonics above Nyquist back down as aliasing; oversampling is what keeps
    // that from sounding like grit nobody played.
    shaper.oversample = '4x'
    // Rectifying leaves a DC offset, and so does an asymmetric curve — fuzz was already producing
    // one. Offset eats headroom and moves the speaker without being heard, so it goes here.
    const dcBlock = ctx.createBiquadFilter()
    dcBlock.type = 'highpass'
    dcBlock.frequency.value = 20
    const post = tone(ctx)
    shaper.connect(dcBlock)
    dcBlock.connect(post)
    let built = ''

    return {
      input: shaper,
      output: post,
      update(params, { at }) {
        setTone(post, params, at)
        const shape = params.shape ?? 'overdrive'
        const amount = Math.round(params.drive * 100) / 100
        // Rebuilding a 1024-point table is not free, so it happens when the sound would change
        // and not on every frame of a slider drag.
        const key = `${shape}:${amount}`
        if (key === built) return
        built = key
        shaper.curve = distortionCurve(shape, amount)
      },
      paramFor(key) {
        return key === 'cutoff' ? post.frequency : null
      },
      dispose() {
        shaper.disconnect()
        dcBlock.disconnect()
        post.disconnect()
      },
    }
  },
}

const crush: EffectDescriptor = {
  kind: 'crush',
  // Not oversampled, so a plain table lookup plus the tone filter. Measured 2.4.
  // Measured at 2.21 *with* the decimator in the chain, against 2.4 without one — the same number
  // A worklet is far dearer than the native nodes around it, which the offline harness could not see:
  // it is JavaScript running on the audio thread, every block. Measured 5.3 against a broken ceiling,
  // where the earlier 2.3 came from a render that does not pay for the crossing.
  cost: () => 5.3,
  label: 'Bitcrusher',
  params: ['bits', 'reduction', 'cutoff'],
  defaults: { bits: 6, reduction: MIN_REDUCTION, cutoff: 6000 },
  releaseTime: 0.02,
  create(ctx) {
    const shaper = ctx.createWaveShaper()
    // Deliberately not oversampled: here the aliasing is the sound.
    shaper.oversample = 'none'
    const post = tone(ctx)

    /**
     * The sample-rate half, which needs to hold a value between samples and so needs a worklet.
     *
     * Attempted rather than checked. Constructing the node is the only reliable test of whether the
     * processor is registered on *this* context, and a browser without `AudioWorklet` should get a
     * bitcrusher that still crushes bits rather than an effect that fails to build.
     */
    let decimator: AudioWorkletNode | null = null
    try {
      // Channel count left to follow the input: a send from one oscillator is mono, and forcing two
      // outputs would decimate the same samples twice to produce the same two channels.
      decimator = new AudioWorkletNode(ctx, DECIMATOR)
    } catch {
      decimator = null
    }

    // Bits first, then rate: quantising and then holding sounds like a cheap converter, which is what
    // is being imitated. The other order smooths the staircase away again.
    if (decimator) shaper.connect(decimator).connect(post)
    else shaper.connect(post)

    let built = -1

    return {
      input: shaper,
      output: post,
      update(params, { at }) {
        setTone(post, params, at)

        const hold = decimator?.parameters.get('hold')
        if (hold) {
          const wanted = clampReduction(params.reduction ?? MIN_REDUCTION)
          // Set rather than ramped: a hold count between two whole numbers is not a sound, it is a
          // number the processor would round anyway.
          hold.setValueAtTime(wanted, at)
        }

        const bits = Math.round(params.bits ?? MAX_BITS)
        if (bits === built) return
        built = bits
        shaper.curve = crushCurve(bits)
      },
      paramFor(key) {
        if (key === 'cutoff') return post.frequency
        // Reachable by a cable even though it is read once a block, which is all a hold count needs.
        if (key === 'reduction') return decimator?.parameters.get('hold') ?? null
        return null
      },
      dispose() {
        shaper.disconnect()
        decimator?.disconnect()
        post.disconnect()
      },
    }
  },
}

const clampReduction = (value: number) =>
  Math.min(MAX_REDUCTION, Math.max(MIN_REDUCTION, Math.round(value)))

/** Slowest possible echo: one beat at the lowest tempo. */
const MAX_ECHO_SECONDS = 4

const echo: EffectDescriptor = {
  kind: 'echo',
  // Two delay lines, a feedback gain, two panners and the tone filter. Measured 5.7.
  // Two delays, two pans and a feedback path. Measured 1.13 light against a broken ceiling.
  cost: () => 7.4,
  label: 'Echo',
  params: ['time', 'feedback', 'width', 'cutoff'],
  labels: { width: 'Spread' },
  defaults: { time: '1/8', feedback: 0.4, width: 0, cutoff: 3000 },
  releaseTime: 0.3,
  /*
   * However many repeats it takes to fall sixty decibels, at this tempo. Two lines in series, so one
   * round trip is two steps.
   *
   * Capped, because the feedback reaches 0.95 and 0.95^n takes 135 round trips to get there — two
   * minutes at a slow tempo, which is not a tail, it is the rest of the file. Ten seconds is past what
   * anybody hears under the next pass.
   */
  tail: (params, bpm) => {
    const step = stepDuration(bpm, params.time ?? '1/8') * 2
    const feedback = Math.min(0.95, Math.max(0, params.feedback ?? 0))
    if (feedback <= 0) return step
    return Math.min(10, step * (Math.log(0.001) / Math.log(feedback)))
  },
  create(ctx) {
    // Two lines in series with the feedback coming off the second, so the taps land at T, 2T, 3T
    // and alternate between them. Spread then decides how far apart the two sit in the stereo
    // field: at zero both are centred and it is an ordinary echo, at one they are hard left and
    // right and it ping-pongs. One control from one topology, rather than a mode that rewires.
    const first = ctx.createDelay(MAX_ECHO_SECONDS)
    const second = ctx.createDelay(MAX_ECHO_SECONDS)
    const feedback = ctx.createGain()
    const damping = tone(ctx)
    const left = ctx.createStereoPanner()
    const right = ctx.createStereoPanner()
    const out = ctx.createGain()

    first.connect(second)
    first.connect(left)
    second.connect(right)
    left.connect(out)
    right.connect(out)

    // The tone control sits in the feedback path, not after the output, so each repeat comes back
    // darker than the last. That decay towards dullness is what a tape echo does, and it is what
    // stops long feedback settings turning into a pile of identical copies.
    second.connect(damping)
    damping.connect(feedback)
    feedback.connect(first)

    return {
      input: first,
      output: out,
      update(params, { at, bpm }) {
        setTone(damping, params, at)
        // Synced to the transport, so an echo stays in time when the tempo moves.
        const seconds = Math.min(MAX_ECHO_SECONDS, stepDuration(bpm, params.time ?? '1/8'))
        // Ramped rather than set: jumping the delay time of a running line pitches the repeats.
        first.delayTime.setTargetAtTime(seconds, at, RAMP)
        second.delayTime.setTargetAtTime(seconds, at, RAMP)
        feedback.gain.setTargetAtTime(Math.min(0.95, Math.max(0, params.feedback ?? 0)), at, RAMP)

        const spread = Math.min(1, Math.max(0, params.width ?? 0))
        left.pan.setTargetAtTime(-spread, at, RAMP)
        right.pan.setTargetAtTime(spread, at, RAMP)
      },
      paramFor(key) {
        if (key === 'cutoff') return damping.frequency
        if (key === 'feedback') return feedback.gain
        // Both lines: the taps sit at T and 2T, and moving one of them would turn the pattern into
        // something else rather than shifting it.
        if (key === 'time') return [first.delayTime, second.delayTime]
        return null
      },
      dispose() {
        first.disconnect()
        second.disconnect()
        feedback.disconnect()
        damping.disconnect()
        left.disconnect()
        right.disconnect()
        out.disconnect()
      },
    }
  },
}

/**
 * A filter on the bus, which is not the same sound as the oscillator's own. Per voice, sixteen
 * notes get sixteen filters; here one filter works on the sum, so the resonance rings against
 * everything at once.
 */
const filter: EffectDescriptor = {
  kind: 'filter',
  // One biquad and the wet/dry pair, which is the cheapest an effect gets here. Offline said 2; realtime
  // says 4.5, averaged over the two readings a sweep takes of this one. A biquad's memory traffic is the
  // part a render does not charge for.
  /*
   * One biquad and the mix gains, and it was priced at 4.5 for years on nothing but arithmetic.
   *
   * The sweep read the filter unit at 0.80x and 0.76x — the same subject measured twice in one run,
   * agreeing to one per cent on points, with the run passing all three of its self-checks and the machine
   * verified idle beforehand. Taking the voice half as correct (it is the unit, and the reading is
   * corroborated below), that leaves the effect itself at about 1.8 rather than 4.5.
   *
   * Believed because a second, independent route says the same thing: this builds *one*
   * `createBiquadFilter`, and the identical node costs `FILTER_COST` — 1.05 — when it sits on a voice.
   * A bus filter is not four times a voice filter; it is the same node plus two gains. 1.8 fits that and
   * 4.5 never did, which is the sort of thing arithmetic gets wrong and a measurement does not.
   *
   * The argument against a mistake in the voice half rather than here: bitcrusher read 1.04 and filter
   * read 0.80 on units sharing the same voice, and a wrong voice cost would move both the same way.
   */
  cost: () => 1.8,
  label: 'Filter',
  params: ['filterType', 'cutoff', 'resonance'],
  // Here the cutoff is the point rather than a shaping stage.
  labels: { cutoff: 'Cutoff' },
  defaults: { filterType: 'lowpass', cutoff: 1200, resonance: 4 },
  releaseTime: 0.02,
  create(ctx) {
    const biquad = ctx.createBiquadFilter()
    biquad.type = 'lowpass'

    return {
      input: biquad,
      output: biquad,
      update(params, { at }) {
        const type = params.filterType ?? 'lowpass'
        // `off` is a valid setting for the oscillator's filter, where it skips the biquad. As an
        // effect there is nothing to skip, so it means all the way open instead.
        biquad.type = type === 'off' ? 'lowpass' : type
        const hz = type === 'off' ? MAX_CUTOFF : (params.cutoff ?? 2000)
        biquad.frequency.setTargetAtTime(Math.min(MAX_CUTOFF, Math.max(MIN_CUTOFF, hz)), at, RAMP)
        biquad.Q.setTargetAtTime(Math.max(0.1, params.resonance ?? 1), at, RAMP)
      },
      paramFor(key) {
        if (key === 'cutoff') return biquad.frequency
        if (key === 'resonance') return biquad.Q
        return null
      },
      dispose() {
        biquad.disconnect()
      },
    }
  },
}

/** Never all the way to one: a modulated comb at unity feedback runs away rather than resonating. */
const MAX_CHORUS_FEEDBACK = 0.7

/**
 * Chorus and flanger are one effect with two settings, so they are one effect here.
 *
 * Sweep is what separates them. A few milliseconds gives harmonically spaced notches and the
 * metallic jet sweep of a flanger, especially with feedback up; twenty or thirty is heard as
 * detuned doubling instead. Shipping them as two entries would have been the same code twice.
 */
const chorus: EffectDescriptor = {
  kind: 'chorus',
  // Modulated delay lines: the modulation is what costs, not the delay. Read 0.96 against a broken
  // ceiling once 5 had come down to 4.3, so this one is settled.
  cost: () => 4.3,
  label: 'Chorus',
  params: ['sweep', 'rate', 'depth', 'feedback', 'cutoff'],
  defaults: { sweep: 22, rate: 1.2, depth: 0.4, feedback: 0 },
  releaseTime: 0.1,
  create(ctx) {
    const line = ctx.createDelay(0.1)
    const post = tone(ctx)
    const feedback = ctx.createGain()
    feedback.gain.value = 0
    line.connect(post)
    line.connect(feedback)
    feedback.connect(line)

    // The first internal LFO in the project, and the pattern parameter modulation will reuse: an
    // oscillator through a gain, connected to an AudioParam rather than to another node.
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    const swing = ctx.createGain()
    lfo.connect(swing)
    swing.connect(line.delayTime)
    lfo.start()

    return {
      input: line,
      output: post,
      update(params, { at }) {
        setTone(post, params, at)
        const centre = Math.min(MAX_SWEEP, Math.max(MIN_SWEEP, params.sweep ?? 6)) / 1000
        line.delayTime.setTargetAtTime(centre, at, RAMP)
        lfo.frequency.setTargetAtTime(Math.max(0.01, params.rate ?? 1.5), at, RAMP)
        // Swing is a share of the delay itself, so depth means the same thing at any sweep rather
        // than modulating a short delay straight through zero.
        swing.gain.setTargetAtTime((params.depth ?? 0.4) * centre * 0.9, at, RAMP)
        feedback.gain.setTargetAtTime(
          Math.min(MAX_CHORUS_FEEDBACK, Math.max(0, params.feedback ?? 0)),
          at,
          RAMP,
        )
      },
      paramFor(key) {
        if (key === 'cutoff') return post.frequency
        if (key === 'feedback') return feedback.gain
        if (key === 'rate') return lfo.frequency
        if (key === 'depth') return swing.gain
        if (key === 'sweep') return line.delayTime
        return null
      },
      dispose() {
        lfo.stop()
        lfo.disconnect()
        swing.disconnect()
        feedback.disconnect()
        line.disconnect()
        post.disconnect()
      },
    }
  },
}

/** Four stages is the classic count: enough notches to hear the sweep, few enough to stay cheap. */
const PHASER_STAGES = 4
const MAX_PHASER_FEEDBACK = 0.6

/**
 * A chain of all-pass filters with their frequencies swept together.
 *
 * Not a flanger with a different name: an all-pass chain puts its notches at frequencies that are
 * *not* harmonically related, which is why it sweeps hollow rather than metallic. The stages are
 * spread rather than stacked at one frequency, or the notches would pile up into one.
 */
const phaser: EffectDescriptor = {
  kind: 'phaser',
  // Four all-pass stages with an LFO on every one of them. 13.5 offline and 15.5 in realtime, and the
  // gap between those two is the same 13 % a per-voice biquad shows — which is what identified the
  // correction as a property of biquads rather than of any one effect.
  //
  // Against a *reasoned* 3.5, and that gap is the other lesson: an automated `AudioParam` makes a
  // biquad recompute its coefficients per sample rather than per block, so four swept filters cost far
  // more than four filters.
  // Four cascaded allpasses and an LFO. The dearest thing here after a reverb tail, but 15.5 was well
  // over: measured 0.71 against a broken ceiling, the largest single misprice the sweep found.
  cost: () => 8.7,
  label: 'Phaser',
  params: ['rate', 'depth', 'feedback', 'cutoff'],
  labels: { cutoff: 'Centre' },
  defaults: { rate: 0.5, depth: 0.7, feedback: 0.3, cutoff: 600 },
  releaseTime: 0.05,
  create(ctx) {
    const stages = Array.from({ length: PHASER_STAGES }, () => {
      const filter = ctx.createBiquadFilter()
      filter.type = 'allpass'
      filter.Q.value = 0.6
      return filter
    })
    stages.forEach((stage, i) => {
      if (i > 0) stages[i - 1].connect(stage)
    })

    const last = stages[stages.length - 1]
    const feedback = ctx.createGain()
    feedback.gain.value = 0
    last.connect(feedback)
    feedback.connect(stages[0])

    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    const swing = ctx.createGain()
    lfo.connect(swing)
    // One modulator into every stage, so the notches move together and the sweep reads as one
    // gesture rather than four.
    for (const stage of stages) swing.connect(stage.frequency)
    lfo.start()

    return {
      input: stages[0],
      output: last,
      update(params, { at }) {
        const centre = Math.min(MAX_CUTOFF, Math.max(MIN_CUTOFF, params.cutoff ?? 600))
        stages.forEach((stage, i) => {
          // Spread across the stages, which is what keeps four notches instead of one deep one.
          stage.frequency.setTargetAtTime(centre * (1 + i * 0.6), at, RAMP)
        })
        lfo.frequency.setTargetAtTime(Math.max(0.01, params.rate ?? 0.6), at, RAMP)
        swing.gain.setTargetAtTime((params.depth ?? 0.6) * centre * 0.8, at, RAMP)
        feedback.gain.setTargetAtTime(
          Math.min(MAX_PHASER_FEEDBACK, Math.max(0, params.feedback ?? 0)),
          at,
          RAMP,
        )
      },
      paramFor(key) {
        // Every stage, so the notches move together and the sweep stays a sweep.
        if (key === 'cutoff') return stages.map((stage) => stage.frequency)
        if (key === 'feedback') return feedback.gain
        if (key === 'rate') return lfo.frequency
        if (key === 'depth') return swing.gain
        return null
      },
      dispose() {
        lfo.stop()
        lfo.disconnect()
        swing.disconnect()
        feedback.disconnect()
        for (const stage of stages) stage.disconnect()
      },
    }
  },
}

/**
 * Amplitude modulation. The cheapest effect here, and the one that most rewards a long branch: a
 * slow tremolo across a whole limb of the cascade does something none of the others can.
 */
const tremolo: EffectDescriptor = {
  kind: 'tremolo',
  // An LFO into a gain, and the gain is barely anything. Measured 2.5.
  cost: () => 2.5,
  label: 'Tremolo',
  params: ['rate', 'depth'],
  // Full depth and a speed you can hear as a pulse. A tremolo at a chorus's settings is a wobble
  // nobody notices, which is exactly what it was before these existed.
  defaults: { rate: 5, depth: 1 },
  releaseTime: 0.02,
  create(ctx) {
    const amp = ctx.createGain()
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    const swing = ctx.createGain()
    lfo.connect(swing)
    swing.connect(amp.gain)
    lfo.start()

    return {
      input: amp,
      output: amp,
      update(params, { at }) {
        const depth = Math.min(1, Math.max(0, params.depth ?? 0.6))
        // The base sits at whatever the swing does not use, so the peak stays at unity and the
        // effect never makes the signal louder than it arrived — only quieter, rhythmically.
        amp.gain.setTargetAtTime(1 - depth / 2, at, RAMP)
        swing.gain.setTargetAtTime(depth / 2, at, RAMP)
        lfo.frequency.setTargetAtTime(Math.max(0.01, params.rate ?? 4), at, RAMP)
      },
      paramFor(key) {
        if (key === 'rate') return lfo.frequency
        if (key === 'depth') return swing.gain
        return null
      },
      dispose() {
        lfo.stop()
        lfo.disconnect()
        swing.disconnect()
        amp.disconnect()
      },
    }
  },
}

/**
 * Ring modulation: the signal multiplied by an oscillator, which is what a gain node does when its
 * gain is driven at audio rate. Cheap, and unmistakable — it replaces the pitch you played with
 * the sum and difference of two.
 */
const ring: EffectDescriptor = {
  kind: 'ring',
  // An audio-rate oscillator into a gain. Measured 2.5 — the same as a tremolo, which is what it
  // is, only faster.
  cost: () => 2.5,
  label: 'Ring mod',
  params: ['cutoff'],
  // The carrier frequency, which the cutoff field already covers with the right range and a log
  // slider to set it on.
  labels: { cutoff: 'Freq' },
  defaults: { cutoff: 300 },
  releaseTime: 0.02,
  create(ctx) {
    const multiplier = ctx.createGain()
    // Zero, so the carrier alone decides the output. A gain left at 1 would pass the dry signal
    // through underneath and turn the effect into a blend.
    multiplier.gain.value = 0

    const carrier = ctx.createOscillator()
    carrier.type = 'sine'
    carrier.connect(multiplier.gain)
    carrier.start()

    return {
      input: multiplier,
      output: multiplier,
      update(params, { at }) {
        const hz = Math.min(MAX_CUTOFF, Math.max(MIN_CUTOFF, params.cutoff ?? 400))
        carrier.frequency.setTargetAtTime(hz, at, RAMP)
      },
      paramFor(key) {
        return key === 'cutoff' ? carrier.frequency : null
      },
      dispose() {
        carrier.stop()
        carrier.disconnect()
        multiplier.disconnect()
      },
    }
  },
}

/** How far behind the left channel the right can be pushed. Past this it stops being width. */
const MAX_WIDTH_SECONDS = 0.02

/**
 * Position and width. Everything else in the project arrives dead centre, so this is the effect
 * that opens the image up.
 *
 * Width is a few milliseconds of delay on the right channel only. The ear reads a gap that small
 * as space rather than as a repeat — the Haas effect — which is how one mono voice becomes wide.
 */
const pan: EffectDescriptor = {
  kind: 'pan',
  /*
   * A panner, a delay for the width and the merge. Measured 4.15 on one instrument and confirmed on
   * another: a sweep after the probe was fixed read it at 0.97x, which is three per cent from priced
   * right, and it broke properly rather than holding to the cap — 240 units against a doubling that
   * could have reached 256.
   *
   * Worth recording that it needed two runs. The first was taken the day before the probe stopped asking
   * for silence *after* building a load, and pan was the subject that fault bit: it follows the heaviest
   * one in the run, so both its attempts were overloaded loads read as spoiled contexts. So its original
   * figure came from an instrument demonstrably wrong about this subject, and the pass that confirmed the
   * other ten never covered it.
   *
   * Two independent readings on two instruments, 4.15 and 0.97x of 4, is as much as this method offers —
   * it resolves about thirty per cent, and they agree far inside that.
   */
  cost: () => 4,
  label: 'Pan',
  params: ['pan', 'width'],
  defaults: { pan: 0, width: 0.4 },
  releaseTime: 0.02,
  create(ctx) {
    const input = ctx.createGain()
    const left = ctx.createDelay(MAX_WIDTH_SECONDS)
    const right = ctx.createDelay(MAX_WIDTH_SECONDS)
    const merger = ctx.createChannelMerger(2)
    const panner = ctx.createStereoPanner()

    input.connect(left)
    input.connect(right)
    left.connect(merger, 0, 0)
    right.connect(merger, 0, 1)
    merger.connect(panner)

    return {
      input,
      output: panner,
      update(params, { at }) {
        panner.pan.setTargetAtTime(Math.min(1, Math.max(-1, params.pan ?? 0)), at, RAMP)
        const spread = Math.min(1, Math.max(0, params.width ?? 0)) * MAX_WIDTH_SECONDS
        right.delayTime.setTargetAtTime(spread, at, RAMP)
      },
      paramFor(key) {
        return key === 'pan' ? panner.pan : null
      },
      dispose() {
        input.disconnect()
        left.disconnect()
        right.disconnect()
        merger.disconnect()
        panner.disconnect()
      },
    }
  },
}

/**
 * An octave below, by dividing the signal's own frequency (see `octaveDown`).
 *
 * A separate effect rather than a fifth distortion Shape, which is where octave *up* lives. The three
 * shapes there are stateless curves a `WaveShaperNode` reads; this one has to remember what the signal
 * did last sample. Putting it behind the same selector would mean "Shape" sometimes choosing a curve
 * and sometimes switching the node that does the processing.
 *
 * Two controls and no more, because there are only two worth having: how much of it you hear, which is
 * the wrapper's mix, and how dark it is. A divider's sound is what it is.
 */
const octave: EffectDescriptor = {
  kind: 'octave',
  // A worklet costs far more than the native nodes it sits among — JavaScript on the audio thread, every
  // block, which an offline render charges almost nothing for. 2.5 was the render's answer; 7.1 was an
  // overshoot correcting it, and 4.8 is where two sweeps agree.
  cost: () => 4.8,
  label: 'Octave',
  params: ['cutoff'],
  labels: { cutoff: 'Tone' },
  defaults: { cutoff: 3000 },
  releaseTime: 0.02,
  create(ctx) {
    const input = ctx.createGain()
    const post = tone(ctx)

    /**
     * Attempted rather than checked, as with the bitcrusher: constructing the node is the only
     * reliable test of whether the processor is registered on *this* context.
     *
     * Without a worklet there is no octave to be had — the whole effect is the divider — so it passes
     * the signal through and the tone control still works. Silence would be the wrong answer: a patch
     * that plays on one browser should not go quiet on another.
     */
    let divider: AudioWorkletNode | null = null
    try {
      divider = new AudioWorkletNode(ctx, OCTAVE)
    } catch {
      divider = null
    }

    if (divider) input.connect(divider).connect(post)
    else input.connect(post)

    return {
      input,
      output: post,
      update(params, { at }) {
        setTone(post, params, at)
      },
      paramFor(key) {
        return key === 'cutoff' ? post.frequency : null
      },
      dispose() {
        input.disconnect()
        divider?.disconnect()
        post.disconnect()
      },
    }
  },
}

const comb: EffectDescriptor = {
  kind: 'comb',
  /*
   * A worklet, so it is priced with the other one rather than with the native nodes: JavaScript on the
   * audio thread every block, which an offline render charges almost nothing for and a live one pays in
   * full. Started from the octave divider's measured 4.8, because the work per sample is the same order —
   * a circular-buffer read, one interpolation, two one-poles and a write, against the octave's smoothing
   * and crossing detection — and it wants confirming with a sweep of its own before it is trusted to
   * three figures.
   */
  cost: () => 5,
  label: 'Comb',
  params: ['pitch', 'decay', 'cutoff'],
  // `decay` is a tail in seconds for the reverb and a ring in seconds here, which is the same idea at a
  // different scale; `cutoff` is the low-pass *inside* the loop, which is not a tone control at all.
  labels: { decay: 'Ring', cutoff: 'Damping' },
  defaults: { pitch: 57, decay: 2, cutoff: 4000 },
  // Long enough that deleting the node does not click, which is all a release is for — the ring itself
  // is what `tail` answers, and it can be a hundred times this.
  releaseTime: 0.08,
  // Ring is defined as the time to fall sixty decibels, so it *is* the tail. The damping can only make
  // it shorter, so this errs long, which costs a moment of quiet rather than a cut note.
  tail: (params) => decaySeconds(params, 2),
  create(ctx) {
    const input = ctx.createGain()
    const output = ctx.createGain()

    /**
     * Attempted rather than checked, as with the bitcrusher and the divider: constructing the node is
     * the only reliable test of whether the processor is registered on *this* context.
     *
     * Unlike those two there is nothing to fall back to — the resonator *is* the worklet, and a comb
     * built from a `DelayNode` cannot reach above the sample rate over 128, which is about 344 Hz at
     * 44.1 kHz and 375 at 48. A tuned effect whose pitch depends on the hardware is worse than an
     * absent one, so this passes the signal through instead and says nothing, the same shape of
     * degradation as an offline context that cannot suspend.
     */
    let ring: AudioWorkletNode | null = null
    try {
      ring = new AudioWorkletNode(ctx, COMB)
    } catch {
      ring = null
    }

    if (ring) input.connect(ring).connect(output)
    else input.connect(output)

    const note = ring?.parameters.get('note') ?? null
    const length = ring?.parameters.get('ring') ?? null
    const damping = ring?.parameters.get('damping') ?? null

    return {
      input,
      output,
      update(params, { at }) {
        // Whole semitones: the control is a note, and a resonator between two of them is out of tune
        // with everything rather than interestingly detuned.
        const pitch = Math.round(
          Math.min(MAX_COMB_NOTE, Math.max(MIN_COMB_NOTE, params.pitch ?? 57)),
        )
        note?.setTargetAtTime(pitch, at, RAMP)
        length?.setTargetAtTime(Math.max(0, params.decay ?? 2), at, RAMP)
        damping?.setTargetAtTime(Math.max(20, params.cutoff ?? 4000), at, RAMP)
      },
      paramFor(key) {
        // All three reachable, which is the point of them being `AudioParam`s rather than messages. A
        // modulated pitch is a resonator being bent, and it is the best thing this effect does.
        if (key === 'pitch') return note
        if (key === 'decay') return length
        if (key === 'cutoff') return damping
        return null
      },
      dispose() {
        input.disconnect()
        ring?.disconnect()
        output.disconnect()
      },
    }
  },
}

const fold: EffectDescriptor = {
  kind: 'fold',
  /*
   * The same parts as the distortion — a shaper at four-times oversampling, a high-pass and the tone
   * filter — so it starts at the distortion's measured 10.9 rather than at a guess. Folding aliases
   * harder than clipping does, but the oversampling is what costs, not what is being oversampled.
   *
   * A prior, like the resonator's, and it wants a sweep of its own before it is trusted.
   */
  cost: () => 10.9,
  label: 'Fold',
  params: ['drive', 'bias', 'cutoff'],
  defaults: { drive: 0.4, bias: 0, cutoff: 5000 },
  releaseTime: 0.02,
  create(ctx) {
    const shaper = ctx.createWaveShaper()
    /*
     * Folding is where oversampling earns its keep more than anywhere else here. A clipper's corners
     * make harmonics that fall away; a fold makes a corner every time it turns over, four times at full
     * drive, and every one of those puts energy far above Nyquist. Without this it is not a folder, it
     * is a hiss that follows the note.
     */
    shaper.oversample = '4x'
    /*
     * A biased fold is asymmetric by construction, and an asymmetric curve leaves a direct current. The
     * distortion has this filter for the same reason — rectifying and fuzz both offset — and it matters
     * more here, because bias is a control somebody will sweep rather than a flavour they pick once.
     */
    const dcBlock = ctx.createBiquadFilter()
    dcBlock.type = 'highpass'
    dcBlock.frequency.value = 20
    const post = tone(ctx)
    shaper.connect(dcBlock)
    dcBlock.connect(post)
    let built = ''

    return {
      input: shaper,
      output: post,
      update(params, { at }) {
        setTone(post, params, at)
        // Rounded to a hundredth before it becomes a key, so dragging a slider rebuilds the table when
        // the sound would change rather than on every frame. Same guard as the distortion's.
        const drive = Math.round(Math.min(1, Math.max(0, params.drive ?? 0)) * 100) / 100
        const bias = Math.round(Math.min(1, Math.max(-1, params.bias ?? 0)) * 100) / 100
        const key = `${drive}:${bias}`
        if (key === built) return
        built = key
        shaper.curve = foldCurve(drive, bias)
      },
      paramFor(key) {
        /*
         * Only the tone. Drive and bias rebuild a thousand-point table, so neither is an `AudioParam` a
         * signal can be added to — they are driven by recomputation instead, which is what the modulation
         * table means by `via: 'value'`.
         */
        return key === 'cutoff' ? post.frequency : null
      },
      dispose() {
        shaper.disconnect()
        dcBlock.disconnect()
        post.disconnect()
      },
    }
  },
}

/**
 * Where the two shelves hinge, and how broad the bell is.
 *
 * Fixed rather than settings. Two hundred and fifty hertz is under the body of almost everything and
 * above the rumble; three kilohertz is where air and edge live. Those are where a shelf belongs, and
 * exposing them would double the controls to let somebody build a worse EQ. The bell moves, because a mid
 * band that cannot be aimed is not a mid band.
 *
 * A Q of 0.9 is broad on purpose — wide enough that a boost sounds like a tone change rather than a
 * resonance, which is what separates an EQ from the filter effect sitting three rows above it.
 */
const EQ_LOW_HINGE = 250
const EQ_HIGH_HINGE = 3000
const EQ_MID_Q = 0.9

const eq: EffectDescriptor = {
  kind: 'eq',
  /*
   * Three biquads and the wet/dry pair. Derived from the filter effect rather than guessed: that one is
   * *one* biquad plus the same two gains and measures 1.8, and the identical node costs `FILTER_COST` —
   * 1.05 — sitting on a voice. So two more of them is 1.8 + 2.1.
   *
   * The strongest prior of the three unmeasured effects, because it reuses a figure that was itself
   * corroborated two independent ways (PLAN §24). It still wants a sweep.
   */
  cost: () => 3.9,
  label: 'EQ',
  params: ['low', 'mid', 'high', 'cutoff'],
  // Here the cutoff is where the bell sits, not a shaping stage after the effect.
  labels: { cutoff: 'Mid Hz' },
  defaults: { low: 0, mid: 0, high: 0, cutoff: 1200 },
  releaseTime: 0.02,
  create(ctx) {
    /*
     * A shelf, a bell and a shelf in series, and **no tone stage after them** — unlike every other effect
     * here, which borrows `cutoff` for a low-pass on the way out. An EQ *is* the tone stage; adding
     * another would be a fourth band nobody asked for and a control that says two things.
     */
    const low = ctx.createBiquadFilter()
    low.type = 'lowshelf'
    low.frequency.value = EQ_LOW_HINGE

    const mid = ctx.createBiquadFilter()
    mid.type = 'peaking'
    mid.Q.value = EQ_MID_Q

    const high = ctx.createBiquadFilter()
    high.type = 'highshelf'
    high.frequency.value = EQ_HIGH_HINGE

    low.connect(mid)
    mid.connect(high)

    const dbOf = (value: number | undefined) =>
      Math.max(-MAX_EQ_DB, Math.min(MAX_EQ_DB, value ?? 0))

    return {
      input: low,
      output: high,
      update(params, { at }) {
        // Ramped rather than set, because a band being moved by hand or by a MOD is a gain change and a
        // stepped gain change clicks.
        low.gain.setTargetAtTime(dbOf(params.low), at, RAMP)
        mid.gain.setTargetAtTime(dbOf(params.mid), at, RAMP)
        high.gain.setTargetAtTime(dbOf(params.high), at, RAMP)
        mid.frequency.setTargetAtTime(
          Math.min(MAX_CUTOFF, Math.max(MIN_CUTOFF, params.cutoff ?? 1200)),
          at,
          RAMP,
        )
      },
      paramFor(key) {
        // All four reachable. Every one of these is a real `AudioParam` on a biquad, so a MOD on a band
        // is a signal added to a gain rather than a table rebuilt on a tick — the cheap kind.
        if (key === 'low') return low.gain
        if (key === 'mid') return mid.gain
        if (key === 'high') return high.gain
        if (key === 'cutoff') return mid.frequency
        return null
      },
      dispose() {
        low.disconnect()
        mid.disconnect()
        high.disconnect()
      },
    }
  },
}

export const EFFECTS: EffectDescriptor[] = [
  reverb,
  echo,
  distortion,
  crush,
  filter,
  chorus,
  phaser,
  tremolo,
  ring,
  pan,
  octave,
  comb,
  fold,
  eq,
]

const byKind = new Map(EFFECTS.map((e) => [e.kind, e]))

export function getEffect(kind: EffectKind): EffectDescriptor | undefined {
  return byKind.get(kind)
}

/**
 * What an effect calls a parameter, which is also the record of what it means by it. `cutoff` is
 * Tone on a reverb and Centre on a phaser, and those are not the same number — so comparing labels
 * is how switching effect knows whether a value is worth carrying over.
 */
export function labelOf(descriptor: EffectDescriptor | undefined, field: keyof FxParams): string {
  return descriptor?.labels?.[field] ?? field
}

/** Falls back rather than throwing: a patch may name an effect this build does not have yet. */
export function effectOr(kind: EffectKind): EffectDescriptor {
  return byKind.get(kind) ?? reverb
}
