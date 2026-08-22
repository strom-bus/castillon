import {
  amountFor,
  MAX_RATE,
  MIN_RATE,
  MOD_COST,
  targetOf,
  type LfoShape,
  type ModTargetKey,
  type ModFires,
  type ModKind,
} from './modulation'
import {
  MAX_MOD_ATTACK,
  MAX_MOD_DECAY,
  MIN_MOD_ATTACK,
  MIN_MOD_DECAY,
  type FilterType,
  type FxParams,
  type ModParams,
  type NodeId,
  type Waveform,
} from '../types/patch'
import { effectOr, type EffectChain } from './effects'
import { MAX_CUTOFF, MAX_RESONANCE, MIN_CUTOFF, MIN_RESONANCE } from './filter'
import { effectCost, MAX_LOAD, voiceCost } from './load'
import { fillNoise, type NoiseColor } from './noise'
import type { Random } from './random'
import { isNoise, pulseHarmonics, rampHarmonics } from './waveforms'
import type { RouterOp } from './router'
import { registerWorklets } from './worklets/register'

/** Cost in points of what a voice is made of, so the budget can be about work rather than count. */

/**
 * How long a slide actually gets, in seconds.
 *
 * Never longer than the note it belongs to: a slide still travelling when its note ends never arrives,
 * and what is heard is a pitch that was on its way somewhere. Its own function because the clamp is the
 * part worth pinning, and the automation it feeds records values without times — so a test watching the
 * parameter cannot see a duration at all.
 */
export function glideSeconds(glideMs: number, duration: number): number {
  return Math.min(Math.max(0, glideMs / 1000), Math.max(0, duration))
}

export interface NoteRequest {
  nodeId: NodeId
  /** Absolute time on the audio clock. */
  time: number
  freq: number
  waveform: Waveform
  /** Duty cycle, only relevant with `waveform: 'pulse'`. */
  pulseWidth: number
  /** Seconds the note is held down, release not included. */
  duration: number
  gain: number
  /** Milliseconds. */
  attack: number
  /** Milliseconds from the attack peak down to silence. 0 holds the peak until the note ends. */
  decay: number
  release: number
  /** Milliseconds to slide from the previous note on this node into this one. 0 jumps. */
  glide: number
  filterType: FilterType
  /** Hz. */
  cutoff: number
  resonance: number
}

/**
 * One oscillator's persistent output. Voices connect here rather than to the master, so moving a
 * cable reconnects one node instead of chasing the voices already scheduled ahead of the clock.
 */
interface OutputBus {
  /** What voices connect to. */
  bus: GainNode
  /** The share of it that reaches the master without passing through any effect. */
  direct: GainNode
}

/**
 * An FX node: a fixed input and output with a swappable chain between them, and a dry path across
 * it.
 *
 * The dry path is what makes Mix mean what it says. Four of the effects only exist by interference
 * with the unprocessed signal — a phaser is a chain of all-pass filters, so its output alone is
 * nearly the input, and the notches appear only when the two are summed — while the other six are
 * transforms that should replace it. Carrying the dry here serves both, and does it once for every
 * effect rather than ten times.
 */
/** A modulator: an oscillator and the gain that is its depth. */
interface ModInstance {
  /**
   * Whatever produces the modulation at unit amplitude, before depth scales it.
   *
   * An LFO's is its oscillator, swinging between -1 and 1 for ever. An envelope's is a gain being
   * ramped between 0 and 1 by the cascade, fed a constant 1. Everything downstream — the depth gain,
   * the per-voice links, the inverter on a mix — connects from here and does not know which it got,
   * which is why an envelope needed no changes to any of it.
   */
  source: AudioNode
  /** The gain an envelope's shape is drawn on. Absent for an LFO, which has no shape to draw. */
  shape?: GainNode
  kind: ModKind
  /** What starts an envelope: a trigger in the cascade, or every note. */
  fires: ModFires
  /** The oscillator, where there is one, so a rate change can reach it. */
  osc?: OscillatorNode
  /**
   * The looping buffer of held values, where the shape is a stepped random instead.
   *
   * Exactly one of this and `osc` is present on an LFO, and which it is decides where a rate change has
   * to land: an oscillator's frequency, or a buffer's playback rate.
   */
  stepper?: AudioBufferSourceNode
  /**
   * The node that was started and therefore has to be stopped — the oscillator for an LFO, the
   * constant for an envelope. Kept apart from `source` because for an envelope they are not the same
   * node: the constant feeds the shape, and stopping the shape would stop nothing.
   */
  runner: AudioScheduledSourceNode
  depth: GainNode
  cost: number
  /** When it began, so a value-rate link can work out its phase without reading the oscillator. */
  startedAt: number
  wave: LfoShape
  rate: number
  /** Seconds. An envelope reads these when it fires, so a change lands on the next trigger. */
  attack: number
  decay: number
}

/**
 * A modulation that cannot be connected to.
 *
 * A decay rebuilds an impulse response and a bit depth rebuilds a curve, so neither is an
 * `AudioParam`. These are driven by recomputation: the modulator's value is worked out in JavaScript
 * and pushed through the effect's own `update` (PLAN §18.3).
 */
interface ValueLink {
  modId: NodeId
  targetId: NodeId
  key: string
  centre: number
  amount: number
  /** Rounded to this before being applied, so a sweep does not rebuild a buffer for every frame. */
  step: number
  /**
   * Seconds that must pass before this may be recomputed again.
   *
   * Quantising the value is not enough on its own for the parameters that *allocate*. A reverb's
   * impulse response is two channels of up to ten seconds, and rebuilding it twenty times a second
   * measured at more than the entire budget. Four times a second is ample for a gesture nobody sweeps
   * quickly, and it is the difference between affordable and not.
   */
  every: number
  /** When it last moved, so the interval above can be honoured. */
  lastAt: number
}

interface EffectInstance {
  /** Points, refreshed when a parameter that bears on it moves — a reverb's tail, most of all. */
  cost: number
  /**
   * The last parameters it was given, and the tempo they came with.
   *
   * Kept so a value-rate modulation can push a changed copy through `update` without the store
   * knowing: modulation is not an edit, so it must never be written back to the patch.
   */
  params: FxParams
  bpm: number
  input: GainNode
  dry: GainNode
  wet: GainNode
  output: GainNode
  chain: EffectChain
  kind: string
}

interface Voice {
  nodeId: NodeId
  /** Points, so the budget counts work rather than voices. A filtered pulse is not a plain sine. */
  cost: number
  start: number
  /** When the voice goes fully silent, release included. */
  end: number
  gain: GainNode
  source: AudioScheduledSourceNode
  /** Everything to unhook when the voice ends. */
  chain: AudioNode[]
  /** Its own filter, where it has one, since that is what a modulator on this oscillator points at. */
  filter: BiquadFilterNode | null
  /**
   * What is driving that filter, so it can be let go of when the note ends.
   *
   * `from` is set for a gain built for this voice alone — a per-note envelope's shape — and names what
   * feeds it. Unhooking such a gain from the parameter is not enough: `disconnect()` lets go of a
   * node's *outputs*, so whatever feeds it still holds a reference and one dead gain accumulates per
   * note played. A per-trigger modulation shares one gain across every voice and must survive them,
   * so it has no `from`.
   */
  modulated: Array<{ amount: GainNode; param: AudioParam; from?: AudioNode }>
}

/**
 * A modulator pointed at an oscillator's filter.
 *
 * Every other target is a node the engine keeps for as long as the patch does, so a cable is one
 * connection made when it is drawn. A filter is built per note and thrown away with it, so what stands
 * here is the depth — its own gain, fed by the modulator — while the connection to the parameter is
 * made and unmade with each voice.
 *
 * The gain is per link rather than the modulator's shared one because one depth means two different
 * quantities on these two: thousands of hertz on a cutoff, and a number under twenty on a Q.
 */
interface VoiceLink {
  modId: NodeId
  oscId: NodeId
  key: 'cutoff' | 'resonance'
  amount: GainNode
  /** The scaled depth, kept so a per-note envelope's own gain knows what to rise to. */
  peak: number
}

/**
 * What the scheduler consumes. It exists so the scheduler can be tested without Web Audio
 * (see scheduler.test.ts).
 */
export interface Engine {
  now(): number
  playNote(req: NoteRequest): void
  /** What the voices sounding at that instant cost, in points. */
  voiceLoadAt(time: number): number
  /** What the effects cost, which is paid the whole time they exist. */
  effectLoad(): number
  /** How long what this node scheduled keeps sounding. */
  nodeBusyUntil(nodeId: NodeId): number
  /** Cuts a node's live voices, to restart its sequence. */
  releaseNodeVoices(nodeId: NodeId, at: number): void
  /** Runs a modulation envelope once, from a trigger in the cascade. */
  fireEnvelope(nodeId: NodeId, at: number): void
}

/** Ramps a param to zero without clicking, respecting what is already scheduled. */
function fadeOut(param: AudioParam, at: number, seconds: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(at)
  } else {
    param.cancelScheduledValues(at)
  }
  param.linearRampToValueAtTime(0, at + seconds)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}

/**
 * A modulator's wave at a phase in turns, from -1 to 1.
 *
 * Only for value-rate links: audio-rate ones are the oscillator itself. The two agree in shape, which
 * is what matters — a square that stepped differently here than in the audio path would be a second
 * definition of the same control.
 */
export function waveAt(shape: LfoShape, turns: number): number {
  const phase = turns - Math.floor(turns)
  switch (shape) {
    case 'square':
      return phase < 0.5 ? 1 : -1
    case 'sawtooth':
      return phase * 2 - 1
    case 'triangle':
      return phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4
    default:
      return Math.sin(phase * Math.PI * 2)
  }
}

const STEAL_FADE = 0.008
/** Time constant for a parameter change that should not click. */
const RAMP = 0.01
const MIN_RAMP = 0.005
/** Noise plays back at rate 1 on this note (C4), and shifts with the sequencer from there. */
const NOISE_REFERENCE_FREQ = 261.6255653005986
/** Long enough that the loop point is not audible as a pattern. */
const NOISE_SECONDS = 3

/**
 * Steps a second the shared random-hold buffer runs at when played back untouched.
 *
 * A stepped random cannot be an oscillator, so it is a buffer of held values played on loop, and the rate
 * is the playback rate. One buffer serves every random modulator in the engine — each starts at its own
 * offset, so two of them are uncorrelated without either owning a megabyte.
 */
const STEP_REFERENCE_HZ = 8
/** Steps in it. Sixty-four at a couple of hertz is half a minute before anything comes round again. */
const RANDOM_STEPS = 64

/**
 * Where a modulator can be pointed: a parameter, or a node that leads to one.
 *
 * Nearly always the first. The exception is the dry half of a mix, which has to move against the wet
 * half, and Web Audio has no negative connection — so the signal goes through a gain of -1, and what
 * it connects to is that gain's input rather than a parameter.
 */
type ModDestination = AudioParam | AudioNode

/**
 * Draws an envelope on a parameter: up to a peak over the attack, back to nothing over the decay.
 *
 * Scheduled at absolute times on the audio clock, which makes it sample-accurate and correct in an
 * offline render with nothing added — an envelope is `AudioParam` automation and nothing more.
 *
 * A retrigger before the previous one finished holds the current value and ramps from there rather
 * than jumping to zero first, which would click.
 */
function drawEnvelope(
  gain: AudioParam,
  at: number,
  peak: number,
  attack: number,
  decay: number,
): void {
  if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(at)
  else gain.cancelScheduledValues(at)

  gain.linearRampToValueAtTime(peak, at + attack)
  gain.linearRampToValueAtTime(0, at + attack + decay)
}

/** A node can pass a signal on; a parameter is where one ends. That is the difference that matters. */
function isNode(destination: ModDestination): destination is AudioNode {
  return 'connect' in destination
}

function connectTo(from: AudioNode, to: ModDestination): void {
  if (isNode(to)) from.connect(to)
  else from.connect(to)
}

function disconnectFrom(from: AudioNode, to: ModDestination): void {
  if (isNode(to)) from.disconnect(to)
  else from.disconnect(to)
}

export class AudioEngine implements Engine {
  /**
   * Where this engine's random numbers come from: the noise buffers and any reverb's impulse
   * response. `Math.random` live; a seeded generator for a render, which is what makes the same patch
   * come out as the same file.
   *
   * One stream shared by all of them, so the sequence depends on the order things are built in. That
   * order is decided by the router ops and the scheduler, both of which are deterministic for a given
   * patch — which is the property that matters.
   */
  private readonly random: Random

  /**
   * Where this engine starts stealing voices instead of layering them.
   *
   * `MAX_LOAD` for anything that plays. A field rather than the constant read directly because the
   * instrument that *measures* `MAX_LOAD` has to be able to exceed it — a cap wired to the number under
   * test makes the measurement circular, which is exactly how one run of it silently capped itself at
   * the answer it was trying to find.
   */
  ceiling = MAX_LOAD

  constructor(random: Random = Math.random) {
    this.random = random
  }

  /**
   * `BaseAudioContext`, not `AudioContext`, so the same engine can drive an `OfflineAudioContext`
   * for the export. Every node the engine builds exists on the base; only resuming a suspended
   * context does not, which is why `realtime` is tracked separately.
   */
  private ctx: BaseAudioContext | null = null
  private realtime = false
  private master: GainNode | null = null
  private voices: Voice[] = []
  private masterGainValue = 0.8
  private buses = new Map<NodeId, OutputBus>()
  private effects = new Map<NodeId, EffectInstance>()
  private modulators = new Map<NodeId, ModInstance>()
  /** What each modulator is driving, so a rewiring can undo exactly what it did. */
  private modLinks = new Map<string, ModDestination[]>()
  private voiceLinks = new Map<string, VoiceLink>()
  /**
   * What each cable adds to what it is pointed at, over and above the modulator's own cost.
   *
   * Automating a gain is free; automating a filter roughly triples it, because the coefficients go
   * from per block to per sample. Kept per connection rather than per modulator, since one MOD can
   * point at several things and the price is a property of the destination.
   */
  private modSurcharge = new Map<string, number>()
  /** Per-voice surcharges, by oscillator: added to each voice as it is built rather than standing. */
  private voiceSurcharge = new Map<NodeId, number>()
  /** One inverter per node, so wiring a mix modulation twice does not stack them. */
  private inverters = new Map<NodeId, GainNode>()
  /** Modulations that cannot be connected to, driven by recomputation instead. */
  private valueLinks = new Map<string, ValueLink>()
  private valueTimer: number | null = null
  private directLevels = new Map<NodeId, number>()
  private pulseWaves = new Map<number, PeriodicWave>()
  private rampWaveCache: PeriodicWave | null = null
  /** The last pitch each node played, which is where its next slide starts from. */
  private lastFreq = new Map<NodeId, number>()

  /** Built once and shared: every random modulator reads the same held values from its own offset. */
  private randomSteps: AudioBuffer | null = null

  private noiseBuffers = new Map<NoiseColor, AudioBuffer>()

  /** Must be called from a user gesture: browsers block audio otherwise. */
  async start(): Promise<void> {
    if (!this.ctx) {
      this.realtime = true
      this.build(new AudioContext())
      // Before anything is built on it. `reconcile` refuses to run until the engine has started, so
      // awaiting here is enough to guarantee no effect is ever constructed before its processor
      // exists — which is what lets `create` stay ordinary synchronous code.
      await this.loadWorklets()
    }
    // Only a realtime context can be suspended. Resuming an offline one would start its render.
    if (!this.realtime) return
    const ctx = this.ctx as AudioContext
    if (ctx.state === 'suspended') await ctx.resume()
  }

  /**
   * Takes over a context somebody else owns and built for a single purpose — the offline render.
   *
   * The export gets its own engine over its own context rather than borrowing the live one, so a
   * render cannot disturb what is playing and does not have to wait for it to stop.
   */
  adopt(ctx: BaseAudioContext): void {
    this.realtime = false
    this.build(ctx)
  }

  /**
   * Loads the custom processors onto this context.
   *
   * Separate from `adopt` because that is synchronous and this cannot be: a processor has to be
   * registered before a node can be built from it. An adopted context belongs to whoever adopted it,
   * so they await this — which the render does, before it applies a single op.
   */
  async loadWorklets(): Promise<boolean> {
    if (!this.ctx) return false
    return registerWorklets(this.ctx)
  }

  /** The output chain: master gain into a limiter into the destination. */
  private build(ctx: BaseAudioContext): void {
    this.ctx = ctx

    const master = ctx.createGain()
    master.gain.value = this.masterGainValue

    // Limiter: keeps the output from clipping once many voices branch out.
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -6
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.003
    limiter.release.value = 0.1

    master.connect(limiter).connect(ctx.destination)
    this.master = master
  }

  /** False until the first Play, since nothing can be built before there is a context. */
  get started(): boolean {
    return this.ctx !== null
  }

  now(): number {
    return this.ctx ? this.ctx.currentTime : 0
  }

  setMasterGain(value: number): void {
    this.masterGainValue = value
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01)
    }
  }

  playNote(req: NoteRequest): void {
    if (!this.ctx || !this.master) return
    this.prune()

    const attack = Math.max(MIN_RAMP, req.attack / 1000)
    const release = Math.max(MIN_RAMP, req.release / 1000)
    // Attack must never outrun the note, or it would never reach the requested mix.
    const rise = Math.min(attack, req.duration * 0.9)
    const holdEnd = req.time + req.duration
    const end = holdEnd + release

    // A swept filter costs more than a static one, and this oscillator's filter is built per note —
    // so the surcharge is part of what this voice costs, not standing cost. Only where there is a
    // filter to sweep: with it off, nothing is built and nothing is charged.
    const swept = req.filterType !== 'off' ? (this.voiceSurcharge.get(req.nodeId) ?? 0) : 0
    const cost = voiceCost(req.waveform, req.filterType !== 'off') + swept
    if (this.totalLoadAt(req.time) + cost > this.ceiling) this.stealOldest(req.time)

    /*
     * Where the slide starts, remembered rather than passed in.
     *
     * The scheduler hands over one note at a time and each gets its own oscillator, so the pitch to slide
     * *from* is not in the request — it is whatever this node played last. Keeping it here rather than
     * having the sequencer work it out also gets the case a sequencer cannot see: a looping patch slides
     * from the last step of one pass into the first of the next, across the boundary.
     */
    const from = this.lastFreq.get(req.nodeId)
    this.lastFreq.set(req.nodeId, req.freq)

    const source = this.createSource(req, from)

    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0, req.time)
    gain.gain.linearRampToValueAtTime(req.gain, req.time + rise)

    /*
     * Between the peak and the end of the note, which is where a decay lives.
     *
     * Three cases rather than one, because a decay and a note length are set independently and either can
     * be the shorter. A decay that finishes first leaves silence to sit in — that is the whole point of
     * having one. A decay still falling when the note ends has to hand the release whatever is left,
     * computed rather than guessed: scheduling a ramp to a time already past would be ignored, and the
     * release would then start from the peak and undo the decay entirely.
     */
    const peakAt = req.time + rise
    const decay = Math.max(0, req.decay / 1000)
    const decayEnd = peakAt + decay

    if (decay <= 0) {
      gain.gain.setValueAtTime(req.gain, holdEnd)
    } else if (decayEnd < holdEnd) {
      gain.gain.linearRampToValueAtTime(0, decayEnd)
      gain.gain.setValueAtTime(0, holdEnd)
    } else {
      // No clamp needed, and one was tried: this branch runs only when the decay outlasts the note, so
      // the fraction cannot exceed one and the remainder cannot go negative. Guarding it anyway was
      // provably dead — mutating the guard away failed nothing, because nothing could reach it.
      gain.gain.linearRampToValueAtTime(req.gain * (1 - (holdEnd - peakAt) / decay), holdEnd)
    }

    gain.gain.linearRampToValueAtTime(0, end)

    // One biquad per voice, so a filter sweep tracks each note rather than a shared bus.
    const chain: AudioNode[] = [source, gain]
    let tail: AudioNode = source
    let filter: BiquadFilterNode | null = null
    if (req.filterType !== 'off') {
      filter = this.ctx.createBiquadFilter()
      filter.type = req.filterType
      filter.frequency.setValueAtTime(clamp(req.cutoff, MIN_CUTOFF, MAX_CUTOFF), req.time)
      filter.Q.setValueAtTime(clamp(req.resonance, MIN_RESONANCE, MAX_RESONANCE), req.time)
      tail.connect(filter)
      chain.splice(1, 0, filter)
      tail = filter
    }
    tail.connect(gain).connect(this.busFor(req.nodeId).bus)

    source.start(req.time)
    source.stop(end + 0.01)

    const voice: Voice = {
      nodeId: req.nodeId,
      cost,
      start: req.time,
      end,
      gain,
      source,
      chain,
      filter,
      modulated: [],
    }
    // Anything already pointed at this oscillator's filter takes hold of this note as it starts.
    for (const link of this.voiceLinks.values()) {
      if (link.oscId === req.nodeId) this.attachVoice(link, voice, req.time)
    }

    source.onended = () => {
      this.releaseVoice(voice)
      for (const node of chain) node.disconnect()
      const i = this.voices.indexOf(voice)
      if (i !== -1) this.voices.splice(i, 1)
    }
    this.voices.push(voice)
  }

  /**
   * The bus for a node, created on first use. Lazily, because a node can be added and played
   * before the router has run, and because most patches never touch most of them.
   */
  busFor(nodeId: NodeId): OutputBus {
    const existing = this.buses.get(nodeId)
    if (existing) return existing

    const ctx = this.ctx as BaseAudioContext
    const bus = ctx.createGain()
    const direct = ctx.createGain()
    direct.gain.value = this.directLevels.get(nodeId) ?? 1
    bus.connect(direct)
    direct.connect(this.master as GainNode)

    const created = { bus, direct }
    this.buses.set(nodeId, created)
    return created
  }

  setDirect(nodeId: NodeId, value: number): void {
    this.directLevels.set(nodeId, value)
    if (!this.ctx) return
    const bus = this.buses.get(nodeId)
    if (bus) bus.direct.gain.setTargetAtTime(value, this.ctx.currentTime, RAMP)
  }

  createEffect(nodeId: NodeId, params: FxParams, bpm: number): void {
    if (!this.ctx || !this.master || this.effects.has(nodeId)) return
    const descriptor = effectOr(params.effect)
    const chain = descriptor.create(this.ctx, this.random)

    const input = this.ctx.createGain()
    const dry = this.ctx.createGain()
    const wet = this.ctx.createGain()
    // Stays at one. It exists so disposal has something to fade, independently of Mix.
    const output = this.ctx.createGain()

    input.connect(dry)
    dry.connect(output)
    input.connect(chain.input)
    chain.output.connect(wet)
    wet.connect(output)
    output.connect(this.master)

    this.effects.set(nodeId, {
      cost: effectCost(params),
      input,
      dry,
      wet,
      output,
      chain,
      kind: params.effect,
      params,
      bpm,
    })
    chain.update(params, { at: this.ctx.currentTime, bpm })
    this.updateEffect(nodeId, params, bpm)
  }

  /**
   * Swaps the chain between the node's input and output. Those two survive, so every cable in the
   * patch stays attached and nothing upstream or downstream is touched.
   */
  replaceEffect(nodeId: NodeId, params: FxParams, bpm: number): void {
    const instance = this.effects.get(nodeId)
    if (!this.ctx || !instance) return

    // Only the chain goes. The input, the dry path and the output survive, so every cable in the
    // patch stays attached and the dry keeps flowing while the effect is swapped underneath.
    instance.input.disconnect()
    instance.chain.output.disconnect()
    instance.chain.dispose()

    const chain = effectOr(params.effect).create(this.ctx)
    instance.input.connect(instance.dry)
    instance.input.connect(chain.input)
    chain.output.connect(instance.wet)
    instance.chain = chain
    instance.kind = params.effect
    instance.cost = effectCost(params)

    this.updateEffect(nodeId, params, bpm)
  }

  updateEffect(nodeId: NodeId, params: FxParams, bpm: number): void {
    const known = this.effects.get(nodeId)
    if (known) {
      known.params = params
      known.bpm = bpm
    }
    const instance = this.effects.get(nodeId)
    if (!this.ctx || !instance) return
    // A reverb's cost follows its tail, so this has to be refreshed on any parameter change rather
    // than only when the effect itself is swapped.
    instance.cost = effectCost(params)

    const at = this.ctx.currentTime
    const mix = Math.min(1, Math.max(0, params.mix))
    instance.wet.gain.setTargetAtTime(mix, at, RAMP)
    instance.dry.gain.setTargetAtTime(1 - mix, at, RAMP)
    instance.chain.update(params, { at, bpm })
  }

  /**
   * Faded out before it is unhooked. Cutting a reverb dead mid-decay is audible, and by the time
   * this is called the node is already gone from the patch — so the sound has to be let go rather
   * than stopped.
   */
  disposeEffect(nodeId: NodeId): void {
    const instance = this.effects.get(nodeId)
    if (!instance) return
    this.effects.delete(nodeId)

    if (!this.ctx) {
      instance.chain.dispose()
      return
    }

    const at = this.ctx.currentTime
    const release = effectOr(instance.kind as FxParams['effect']).releaseTime
    fadeOut(instance.output.gain, at, release)

    window.setTimeout(
      () => {
        instance.input.disconnect()
        instance.dry.disconnect()
        instance.wet.disconnect()
        instance.output.disconnect()
        instance.chain.dispose()
      },
      (release + 0.05) * 1000,
    )
  }

  /**
   * Builds a modulator: an oscillator through a gain, and nothing else.
   *
   * The gain *is* the depth, and it is what gets connected to a parameter — Web Audio adds a
   * connected signal to the parameter's own value, so a bipolar LFO at depth `d` swings the target
   * between `value ± d`. Kept at or below one so a level modulated to its floor lands on silence
   * rather than passing through it into inversion.
   */
  createModulator(nodeId: NodeId, params: ModParams): void {
    if (!this.ctx) return
    this.disposeModulator(nodeId)

    const ctx = this.ctx as BaseAudioContext
    const depth = ctx.createGain()
    // Left at nothing until a cable says what it is pointing at: depth means a share of the target's
    // range, and there is no range without a target.
    depth.gain.value = 0

    const kind: ModKind = params.kind === 'env' ? 'env' : 'lfo'
    let source: AudioNode
    let shape: GainNode | undefined
    let osc: OscillatorNode | undefined

    let stepper: AudioBufferSourceNode | undefined

    let runner: AudioScheduledSourceNode
    if (kind === 'env') {
      // A constant 1 through a gain that the cascade draws the shape on. The constant is what makes
      // the envelope a *signal* rather than a schedule of values, so everything downstream — the
      // per-voice links, the inverter on a mix — treats it exactly as it treats an LFO.
      const constant = ctx.createConstantSource()
      constant.offset.value = 1
      shape = ctx.createGain()
      // Silent until something triggers it. An envelope that started open would be a step, not a
      // shape, and it would jump the first parameter it was wired to.
      shape.gain.value = 0
      constant.connect(shape)
      constant.start()
      source = shape
      runner = constant
    } else {
      const built = this.buildLfoSource(params, clamp(params.rate ?? 2, MIN_RATE, MAX_RATE))
      source = built.source
      runner = built.runner
      osc = built.osc
      stepper = built.stepper
    }

    source.connect(depth)

    this.modulators.set(nodeId, {
      source,
      shape,
      kind,
      osc,
      stepper,
      runner,
      depth,
      cost: MOD_COST,
      startedAt: ctx.currentTime,
      wave: params.wave ?? 'sine',
      fires: params.fires === 'note' ? 'note' : 'trigger',
      rate: clamp(params.rate ?? 2, MIN_RATE, MAX_RATE),
      attack: clamp(params.attack ?? 40, MIN_MOD_ATTACK, MAX_MOD_ATTACK) / 1000,
      decay: clamp(params.decay ?? 600, MIN_MOD_DECAY, MAX_MOD_DECAY) / 1000,
    })
  }

  /**
   * Runs an envelope once, from a trigger in the cascade.
   *
   * Scheduled at an absolute time on the audio clock like everything else the scheduler does, which
   * makes it sample-accurate and — unlike the modulations driven by recomputation — correct in an
   * offline render with nothing extra: it is `AudioParam` automation and nothing more.
   *
   * A retrigger before the previous one has finished holds the current value and ramps from there
   * rather than jumping to zero first, which would click.
   */
  fireEnvelope(nodeId: NodeId, at: number): void {
    const instance = this.modulators.get(nodeId)
    if (!instance?.shape) return
    // A per-note envelope has no shared gesture: each voice carries its own shape, drawn when that
    // note starts. Drawing on the shared one as well would sweep every voice together, which is the
    // other setting entirely.
    if (instance.fires === 'note') return
    drawEnvelope(instance.shape.gain, at, 1, instance.attack, instance.decay)
  }

  /**
   * A rate or a wave change reaches the running oscillator directly. Depth does not: it is scaled to
   * whatever the modulator is pointed at, so the router re-connects rather than updating, and this
   * leaves the gain alone.
   */
  updateModulator(nodeId: NodeId, params: ModParams): void {
    const instance = this.modulators.get(nodeId)
    if (!instance || !this.ctx) return

    // An envelope's times are read when it fires rather than held on a node, so changing them takes
    // effect on the next trigger and needs nothing scheduled now.
    instance.attack = clamp(params.attack ?? 40, MIN_MOD_ATTACK, MAX_MOD_ATTACK) / 1000
    instance.decay = clamp(params.decay ?? 600, MIN_MOD_DECAY, MAX_MOD_DECAY) / 1000
    instance.fires = params.fires === 'note' ? 'note' : 'trigger'

    if (instance.kind !== 'lfo') return
    const at = this.ctx.currentTime
    const rate = clamp(params.rate ?? 2, MIN_RATE, MAX_RATE)

    /*
     * Crossing between a stepped random and a periodic shape swaps the source and nothing else.
     *
     * The two cannot be the same node — one is an oscillator and one is a buffer — so this is the only
     * change on a live modulator that needs new hardware. Rebuilding the whole modulator would have been
     * the obvious move and would have silently cut the cable: `disposeModulator` releases every link.
     * Every link hangs off `depth`, though, so replacing what feeds it is invisible downstream.
     */
    if ((params.wave === 'random') !== Boolean(instance.stepper)) {
      instance.source.disconnect(instance.depth)
      try {
        instance.runner.stop()
      } catch {
        // Already stopped, which is not a problem: the point is that it is not running.
      }
      const rebuilt = this.buildLfoSource(params, rate)
      instance.source = rebuilt.source
      instance.osc = rebuilt.osc
      instance.stepper = rebuilt.stepper
      instance.runner = rebuilt.runner
      instance.source.connect(instance.depth)
      instance.wave = params.wave ?? 'sine'
      instance.rate = rate
      return
    }

    if (instance.stepper) {
      instance.stepper.playbackRate.setTargetAtTime(rate / STEP_REFERENCE_HZ, at, RAMP)
      return
    }
    if (!instance.osc) return
    instance.osc.type = params.wave === 'random' ? 'sine' : (params.wave ?? 'sine')
    instance.osc.frequency.setTargetAtTime(rate, at, RAMP)
  }

  /**
   * The thing that produces an LFO's unit swing, which is one of two quite different nodes.
   *
   * Shared between building a modulator and changing one, so that switching a live LFO to a stepped
   * random gives exactly the node a fresh one would have had.
   */
  private buildLfoSource(
    params: ModParams,
    rate: number,
  ): {
    source: AudioNode
    runner: AudioScheduledSourceNode
    osc?: OscillatorNode
    stepper?: AudioBufferSourceNode
  } {
    const ctx = this.ctx as BaseAudioContext

    if (params.wave === 'random') {
      const stepper = ctx.createBufferSource()
      stepper.buffer = this.randomStepBuffer()
      stepper.loop = true
      stepper.playbackRate.value = rate / STEP_REFERENCE_HZ
      // Started somewhere arbitrary in the buffer, so two random modulators are not the same sequence
      // walking in step with each other.
      stepper.start(ctx.currentTime, this.random() * (stepper.buffer?.duration ?? 0))
      return { source: stepper, runner: stepper, stepper }
    }

    const osc = ctx.createOscillator()
    osc.type = params.wave ?? 'sine'
    osc.frequency.value = rate
    osc.start()
    return { source: osc, runner: osc, osc }
  }

  /**
   * One buffer of held random values, shared by every random modulator in the engine.
   *
   * Held rather than interpolated is the whole point, so each value occupies a run of identical samples.
   * Resampling for a rate other than the reference smooths only the single sample at each edge, which is
   * a step either way as far as anything downstream is concerned.
   */
  private randomStepBuffer(): AudioBuffer {
    if (this.randomSteps) return this.randomSteps
    const ctx = this.ctx as BaseAudioContext
    const held = Math.floor(ctx.sampleRate / STEP_REFERENCE_HZ)
    const buffer = ctx.createBuffer(1, held * RANDOM_STEPS, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let step = 0; step < RANDOM_STEPS; step++) {
      // Bipolar, like every other shape here: a unipolar modulator would only ever push one way.
      const value = this.random() * 2 - 1
      data.fill(value, step * held, (step + 1) * held)
    }
    this.randomSteps = buffer
    return buffer
  }

  disposeModulator(nodeId: NodeId): void {
    const instance = this.modulators.get(nodeId)
    if (!instance) return
    // Every link first: a parameter left with a stopped oscillator attached keeps whatever offset it
    // was holding when the sound stopped.
    // All three kinds of link, not just the connected sort: a value link outliving its modulator
    // would leave the parameter wherever the sweep last put it, and the driver running for nothing.
    const links = [...this.modLinks.keys(), ...this.valueLinks.keys(), ...this.voiceLinks.keys()]
    for (const key of links) {
      if (key.startsWith(`${nodeId}->`))
        this.disconnectMod(nodeId, key.slice(key.indexOf('->') + 2))
    }
    try {
      instance.runner.stop()
    } catch {
      // Never started, or already stopped.
    }
    instance.runner.disconnect()
    // The shape only exists for an envelope, and for one it is a second node between the two.
    instance.shape?.disconnect()
    instance.depth.disconnect()
    this.modulators.delete(nodeId)
  }

  /**
   * Points a modulator at a parameter.
   *
   * `mix` is the one that takes two: an effect's balance is a pair of gains that must move against
   * each other, so the modulator drives the wet side directly and the dry side through an inverter.
   * Without the inversion, sweeping the mix would swing the whole output rather than the balance.
   */
  connectMod(modId: NodeId, targetId: NodeId, target: ModTargetKey, depth: number): void {
    const instance = this.modulators.get(modId)
    if (!this.ctx || !instance) return

    const descriptor = targetOf(target)

    // Nothing to connect to: the parameter exists but rebuilds something rather than being an
    // `AudioParam`, so it is driven by recomputation.
    if (descriptor?.via === 'value') {
      const effect = this.effects.get(targetId)
      if (!effect) return
      const centre = (effect.params[target as keyof FxParams] as number) ?? descriptor.min
      this.valueLinks.set(`${modId}->${targetId}`, {
        modId,
        targetId,
        key: target,
        centre,
        amount: amountFor(descriptor, depth),
        // Sixty-four steps across the whole span: fine enough to hear as a sweep, coarse enough that
        // a rebuild happens on a change somebody could notice.
        step: (descriptor.max - descriptor.min) / 64,
        every: descriptor.rebuildEvery ?? 0,
        lastAt: -Infinity,
      })
      this.chargeFor(modId, targetId, target)
      this.syncValueTimer()
      return
    }

    // An oscillator's filter, which does not exist yet: it arrives with the next note, and with every
    // note after that. What is set up now is the depth; the connecting happens per voice.
    if (!this.effects.has(targetId) && (target === 'cutoff' || target === 'resonance')) {
      this.linkVoices(modId, targetId, target, depth, instance)
      this.chargeFor(modId, targetId, target)
      return
    }

    const destinations = this.modParams(targetId, target)
    if (destinations.length === 0) return

    // Depth is a share of the target's own span, so the one control means the same thing on a mix as
    // on a cutoff in hertz. Without this, a depth of 0.6 would be six tenths of a hertz on a filter.
    const scaled = targetOf(target)
    instance.depth.gain.value = scaled ? amountFor(scaled, depth) : Math.max(0, Math.min(1, depth))

    for (const destination of destinations) connectTo(instance.depth, destination)
    this.modLinks.set(`${modId}->${targetId}`, destinations)
    this.chargeFor(modId, targetId, target)
  }

  disconnectMod(modId: NodeId, targetId: NodeId): void {
    const instance = this.modulators.get(modId)
    const key = `${modId}->${targetId}`
    this.refund(key, targetId)

    const valued = this.valueLinks.get(key)
    if (valued) {
      this.valueLinks.delete(key)
      this.syncValueTimer()
      // Put back where it was, or the parameter keeps whatever the sweep last left it at.
      const effect = this.effects.get(targetId)
      if (effect) {
        this.updateEffect(targetId, { ...effect.params, [valued.key]: valued.centre }, effect.bpm)
      }
      return
    }
    const perVoice = this.voiceLinks.get(key)
    if (perVoice) {
      this.voiceLinks.delete(key)
      for (const voice of this.voices) this.releaseVoice(voice, perVoice.amount)
      perVoice.amount.disconnect()
      return
    }

    const destinations = this.modLinks.get(key)
    this.modLinks.delete(key)
    if (!instance || !destinations) return

    for (const destination of destinations) {
      try {
        disconnectFrom(instance.depth, destination)
      } catch {
        // Already gone.
      }
    }
  }

  /**
   * The parameters a target names on a node.
   *
   * Empty when there is nothing to point at, which is how a MOD wired to the wrong kind of node ends
   * up doing nothing rather than throwing.
   */
  /**
   * Applies every value-rate modulation once.
   *
   * The modulator's value is worked out rather than read: an `OscillatorNode` cannot be sampled, so
   * the wave is evaluated at the time elapsed since it started. A link driven this way is not
   * phase-locked to the same modulator's audio-rate links, which matters only if one MOD drives both
   * kinds at once, and then only as a fixed offset.
   *
   * Rounded to a step before being applied, because the parameters that need this are exactly the ones
   * that rebuild something: without it a sweep would regenerate an impulse response every tick rather
   * than once per audible step.
   */
  private driveValues(): void {
    if (!this.ctx || this.valueLinks.size === 0) return
    const now = this.ctx.currentTime

    for (const link of this.valueLinks.values()) {
      const modulator = this.modulators.get(link.modId)
      const effect = this.effects.get(link.targetId)
      if (!modulator || !effect) continue

      // Some rebuilds are dear enough to be worth doing rarely — an impulse response is two channels
      // of up to ten seconds — so a link may ask to be left alone between turns.
      if (now - link.lastAt < link.every) continue

      const phase = (now - modulator.startedAt) * modulator.rate
      const value = link.centre + waveAt(modulator.wave, phase) * link.amount
      const stepped = Math.round(value / link.step) * link.step
      if (effect.params[link.key as keyof FxParams] === stepped) continue
      link.lastAt = now

      // A copy, never the stored object: modulation is not an edit and must not reach the patch.
      this.updateEffect(link.targetId, { ...effect.params, [link.key]: stepped }, effect.bpm)
    }
  }

  /**
   * Whether anything is being modulated by recomputation, which the caller of an offline render needs
   * to know: it is the one kind of modulation that cannot simply be scheduled and left.
   */
  hasValueModulation(): boolean {
    return this.valueLinks.size > 0
  }

  /**
   * Moves every recomputed modulation to where the clock says it should be.
   *
   * Public because **who drives this depends on whose clock is running.** Live, a wall-clock timer
   * does it. In an offline render there is no wall clock worth reading — a minute of audio is produced
   * in a second — so the render suspends itself at intervals of *audio* time and calls this. Same
   * loop, different clock, and the offline one is deterministic into the bargain.
   */
  advanceValueModulation(): void {
    this.driveValues()
  }

  /**
   * Runs the wall-clock driver while there is anything for it to do, and not a moment longer.
   *
   * Only when this engine drives a realtime context. An adopted one belongs to whoever adopted it and
   * is stepped by them; a timer there would fire against a clock that is not the one producing the
   * audio, which is how a render came to contain almost none of its own modulation.
   */
  private syncValueTimer(): void {
    const wanted = this.realtime && this.valueLinks.size > 0
    if (wanted === (this.valueTimer !== null)) return

    if (wanted) {
      // Twenty times a second. Faster buys nothing: every parameter driven this way is quantised
      // anyway, and each change may rebuild a buffer.
      this.valueTimer = window.setInterval(() => this.driveValues(), 50)
    } else if (this.valueTimer !== null) {
      window.clearInterval(this.valueTimer)
      this.valueTimer = null
    }
  }

  /**
   * Lets go of everything this engine holds.
   *
   * The live engine lasts as long as the page and never needed this. A render builds a whole engine
   * per export and threw it away without it, which leaked a twenty-times-a-second timer per export —
   * one that went on calling a context that had finished rendering.
   */
  dispose(): void {
    for (const id of [...this.modulators.keys()]) this.disposeModulator(id)
    for (const id of [...this.effects.keys()]) this.disposeEffect(id)

    for (const voice of this.voices) {
      this.releaseVoice(voice)
      for (const node of voice.chain) node.disconnect()
    }
    this.voices = []

    for (const bus of this.buses.values()) {
      bus.bus.disconnect()
      bus.direct.disconnect()
    }
    this.buses.clear()
    for (const inverter of this.inverters.values()) inverter.disconnect()
    this.inverters.clear()
    this.modSurcharge.clear()
    this.voiceSurcharge.clear()

    // No links to clear and no timer to stop: `disposeModulator` releases all three kinds, the
    // recomputed ones included, and takes the timer down with the last of them. Clearing them here as
    // well read as thorough and was provably dead — which a mutation of it not failing any test is
    // exactly how it was found.

    this.lastFreq.clear()
    this.master?.disconnect()
    this.master = null
    this.ctx = null
  }

  /**
   * Puts the destination's surcharge on the books.
   *
   * A per-voice one goes on the oscillator rather than into standing cost, because it scales with how
   * many notes are in the air — a cable to a silent oscillator costs nothing, and the same cable to
   * one playing sixteen-note chords costs sixteen times as much.
   */
  private chargeFor(modId: NodeId, targetId: NodeId, target: ModTargetKey): void {
    const effect = this.effects.get(targetId)
    const descriptor = targetOf(target, effect ? 'fx' : 'osc', effect?.params.effect)
    const points = descriptor?.surcharge ?? 0
    if (points === 0) return

    if (descriptor?.perVoice) {
      this.voiceSurcharge.set(targetId, (this.voiceSurcharge.get(targetId) ?? 0) + points)
    } else {
      this.modSurcharge.set(`${modId}->${targetId}`, points)
    }
  }

  private refund(key: string, targetId: NodeId): void {
    this.modSurcharge.delete(key)

    // Per-voice charges are held by oscillator, so what is given back is one cable's worth.
    const link = this.voiceLinks.get(key)
    if (!link) return
    const effect = this.effects.get(targetId)
    const points = targetOf(link.key, effect ? 'fx' : 'osc', effect?.params.effect)?.surcharge ?? 0
    const standing = (this.voiceSurcharge.get(targetId) ?? 0) - points
    if (standing > 0.001) this.voiceSurcharge.set(targetId, standing)
    else this.voiceSurcharge.delete(targetId)
  }

  /**
   * Sets up modulation of an oscillator's filter: one gain holding the depth, and a connection to
   * whatever that oscillator happens to be playing right now.
   */
  private linkVoices(
    modId: NodeId,
    oscId: NodeId,
    key: 'cutoff' | 'resonance',
    depth: number,
    instance: ModInstance,
  ): void {
    const ctx = this.ctx as BaseAudioContext
    const descriptor = targetOf(key)
    const peak = descriptor ? amountFor(descriptor, depth) : 0
    const amount = ctx.createGain()
    amount.gain.value = peak
    instance.source.connect(amount)

    const link: VoiceLink = { modId, oscId, key, amount, peak }
    this.voiceLinks.set(`${modId}->${oscId}`, link)
    // Notes already sounding, so a cable drawn mid-cascade is heard on the note under it rather than
    // waiting for the next one.
    for (const voice of this.voices) {
      // Mid-note, so a per-note envelope drawn from now rather than from a start already past.
      if (voice.nodeId === oscId) this.attachVoice(link, voice, this.ctx?.currentTime ?? 0)
    }
  }

  /**
   * Points a link at one voice's filter.
   *
   * A per-note envelope gets **its own gain for this voice**, fed from the modulator's constant and
   * drawn from this note's start — which is the whole difference between per note and per trigger. The
   * shared shape cannot serve: every voice would sweep together, on one gesture, which is what per
   * trigger already is.
   */
  private attachVoice(link: VoiceLink, voice: Voice, at: number): void {
    if (!voice.filter) return
    const param = link.key === 'cutoff' ? voice.filter.frequency : voice.filter.Q
    const instance = this.modulators.get(link.modId)

    if (instance && instance.kind === 'env' && instance.fires === 'note') {
      const ctx = this.ctx as BaseAudioContext
      const shape = ctx.createGain()
      shape.gain.value = 0
      instance.runner.connect(shape)
      shape.connect(param)
      drawEnvelope(shape.gain, at, link.peak, instance.attack, instance.decay)
      voice.modulated.push({ amount: shape, param, from: instance.runner })
      return
    }

    link.amount.connect(param)
    voice.modulated.push({ amount: link.amount, param })
  }

  /** Lets go of what is modulating a voice: one modulator's worth, or all of it. */
  private releaseVoice(voice: Voice, only?: GainNode): void {
    voice.modulated = voice.modulated.filter(({ amount, param, from }) => {
      if (only && amount !== only) return true
      try {
        amount.disconnect(param)
        // Built for this voice, so it goes with it — and it is what *feeds* it that has to let go,
        // since disconnecting a node releases its outputs and not its inputs.
        from?.disconnect(amount)
      } catch {
        // The voice is already gone, which takes its parameters with it.
      }
      return false
    })
  }

  private modParams(nodeId: NodeId, target: ModTargetKey): ModDestination[] {
    const effect = this.effects.get(nodeId)
    if (effect) {
      if (target === 'mix') return [effect.wet.gain, this.inverted(nodeId, effect.dry.gain)]
      if (target === 'level') return [effect.output.gain]

      // Anything else is a parameter of the effect itself, which the chain hands over by name. Null
      // means it has one but not as an `AudioParam` — a decay or a bit depth rebuilds something — and
      // those are driven by recomputation rather than by a connection.
      const inside = effect.chain.paramFor?.(target) ?? null
      if (!inside) return []
      return Array.isArray(inside) ? inside : [inside]
    }
    // Not an effect, so it is an oscillator's bus. `busFor` builds one on demand, which is what lets
    // a modulator be wired before the oscillator has played a note.
    if (target !== 'level') return []
    return [this.busFor(nodeId).bus.gain]
  }

  /**
   * A parameter driven in the opposite direction.
   *
   * Web Audio has no negative connection, so the inversion is a gain of -1 standing between the
   * modulator and the parameter. Cached per node so repeated wiring does not stack inverters.
   */
  private inverted(nodeId: NodeId, param: AudioParam): AudioNode {
    const ctx = this.ctx as BaseAudioContext
    const existing = this.inverters.get(nodeId)
    if (existing) return existing

    const invert = ctx.createGain()
    invert.gain.value = -1
    invert.connect(param)
    this.inverters.set(nodeId, invert)

    // The node, not its gain. The modulation has to pass *through* the inverter to come out negated:
    // driving its gain instead leaves its input silent, and silence times anything is still silence,
    // which is how a modulated mix once moved its wet side alone.
    return invert
  }

  connectSend(oscId: NodeId, fxId: NodeId): void {
    const effect = this.effects.get(fxId)
    if (!this.ctx || !effect) return
    this.busFor(oscId).bus.connect(effect.input)
  }

  disconnectSend(oscId: NodeId, fxId: NodeId): void {
    const effect = this.effects.get(fxId)
    const bus = this.buses.get(oscId)
    if (!effect || !bus) return
    try {
      bus.bus.disconnect(effect.input)
    } catch {
      // Already gone. Web Audio throws rather than shrugging, and either way we are done.
    }
  }

  /**
   * Noise is a looping buffer rather than an oscillator, and its playback rate follows the note
   * so the sequencer still does something musical: higher notes give brighter noise.
   */
  /**
   * Sets a pitch, sliding into it if there is somewhere to slide from.
   *
   * Exponential rather than linear, because pitch is heard in ratios: a linear ramp in hertz crosses the
   * bottom of an octave quickly and crawls through the top, which is audible as the slide slowing down.
   */
  private setPitch(
    param: AudioParam,
    to: number,
    from: number | undefined,
    req: NoteRequest,
  ): void {
    const glide = glideSeconds(req.glide, req.duration)
    if (glide <= 0 || from === undefined || from === to) {
      param.setValueAtTime(to, req.time)
      return
    }
    param.setValueAtTime(from, req.time)
    param.exponentialRampToValueAtTime(to, req.time + glide)
  }

  private createSource(req: NoteRequest, from?: number): AudioScheduledSourceNode {
    const ctx = this.ctx as BaseAudioContext

    if (isNoise(req.waveform)) {
      const source = ctx.createBufferSource()
      source.buffer = this.noiseBuffer(req.waveform)
      source.loop = true
      // A slide is as meaningful on a noise buffer as on an oscillator: the rate is what pitches it.
      const scale = 1 / NOISE_REFERENCE_FREQ
      this.setPitch(
        source.playbackRate,
        req.freq * scale,
        from === undefined ? undefined : from * scale,
        req,
      )
      return source
    }

    const osc = ctx.createOscillator()
    if (req.waveform === 'pulse') {
      osc.setPeriodicWave(this.pulseWave(req.pulseWidth))
    } else if (req.waveform === 'ramp') {
      osc.setPeriodicWave(this.rampWave())
    } else {
      osc.type = req.waveform
    }
    this.setPitch(osc.frequency, req.freq, from, req)
    return osc
  }

  private noiseBuffer(color: NoiseColor): AudioBuffer {
    const cached = this.noiseBuffers.get(color)
    if (cached) return cached
    const ctx = this.ctx as BaseAudioContext
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate)
    fillNoise(color, buffer.getChannelData(0), this.random)
    this.noiseBuffers.set(color, buffer)
    return buffer
  }

  voiceLoadAt(time: number): number {
    let load = 0
    for (const v of this.voices) if (v.start <= time && v.end > time) load += v.cost
    return load
  }

  /**
   * Paid continuously, whether or not anything is wired into them: a convolver processes silence at
   * the same price as sound, and an unwired reverb costing what it costs is both true and a useful
   * nudge to delete it.
   */
  modLoad(): number {
    let total = 0
    for (const instance of this.modulators.values()) total += instance.cost
    // What each cable costs the thing it is pointed at. Standing, like the modulator itself: a swept
    // filter is dearer whether or not anything is going through it.
    for (const points of this.modSurcharge.values()) total += points
    return total
  }

  effectLoad(): number {
    let load = 0
    for (const effect of this.effects.values()) load += effect.cost
    // Modulators are counted here rather than beside voices: like an effect, an LFO runs whether or
    // not anything is playing, so it is standing cost and belongs on that side of the meter (§2.2b).
    return load + this.modLoad()
  }

  /** Voices plus effects, which is what any decision about the budget has to weigh. */
  totalLoadAt(time: number): number {
    return this.voiceLoadAt(time) + this.effectLoad()
  }

  nodeBusyUntil(nodeId: NodeId): number {
    let end = 0
    for (const v of this.voices) if (v.nodeId === nodeId && v.end > end) end = v.end
    return end
  }

  releaseNodeVoices(nodeId: NodeId, at: number): void {
    for (const v of this.voices) {
      if (v.nodeId !== nodeId || v.end <= at) continue
      fadeOut(v.gain.gain, at, STEAL_FADE)
      v.end = at + STEAL_FADE
    }
  }

  /** Cuts everything at once, without clicks. The panic button. */
  panic(): void {
    if (!this.ctx) return
    const at = this.ctx.currentTime
    for (const v of this.voices) {
      fadeOut(v.gain.gain, at, STEAL_FADE)
      v.end = at + STEAL_FADE
    }
  }

  private rampWave(): PeriodicWave {
    if (!this.rampWaveCache) {
      const { real, imag } = rampHarmonics()
      this.rampWaveCache = (this.ctx as BaseAudioContext).createPeriodicWave(real, imag)
    }
    return this.rampWaveCache
  }

  /** Pulse waves are cached per duty cycle: rebuilding one per note is expensive. */
  private pulseWave(duty: number): PeriodicWave {
    const ctx = this.ctx as BaseAudioContext
    const key = Math.round(duty * 100)
    const cached = this.pulseWaves.get(key)
    if (cached) return cached
    const { real, imag } = pulseHarmonics(key / 100)
    const wave = ctx.createPeriodicWave(real, imag)
    this.pulseWaves.set(key, wave)
    return wave
  }

  private stealOldest(at: number): void {
    let oldest: Voice | null = null
    for (const v of this.voices) {
      if (v.end <= at) continue
      if (!oldest || v.start < oldest.start) oldest = v
    }
    if (oldest) {
      fadeOut(oldest.gain.gain, at, STEAL_FADE)
      oldest.end = at + STEAL_FADE
    }
  }

  private prune(): void {
    const cutoff = this.now() - 1
    this.voices = this.voices.filter((v) => v.end > cutoff)
  }
}

/**
 * Carries out a router diff against an engine.
 *
 * It takes the engine rather than reaching for the live one so the offline render can build its own
 * graph on its own context: exporting a patch must not touch what is currently playing.
 */
export function applyOps(target: AudioEngine, ops: RouterOp[], bpm: number): void {
  for (const op of ops) {
    switch (op.op) {
      case 'createEffect':
        target.createEffect(op.id, op.params, bpm)
        break
      case 'replaceEffect':
        target.replaceEffect(op.id, op.params, bpm)
        break
      case 'updateEffect':
        target.updateEffect(op.id, op.params, bpm)
        break
      case 'disposeEffect':
        target.disposeEffect(op.id)
        break
      case 'connect':
        target.connectSend(op.from, op.to)
        break
      case 'disconnect':
        target.disconnectSend(op.from, op.to)
        break
      case 'setDirect':
        target.setDirect(op.id, op.value)
        break
      case 'createMod':
        target.createModulator(op.id, op.params)
        break
      case 'updateMod':
        target.updateModulator(op.id, op.params)
        break
      case 'disposeMod':
        target.disposeModulator(op.id)
        break
      case 'connectMod':
        target.connectMod(op.from, op.to, op.target, op.depth)
        break
      case 'disconnectMod':
        target.disconnectMod(op.from, op.to)
        break
    }
  }
}
