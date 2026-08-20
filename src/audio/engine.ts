import type { FilterType, FxParams, NodeId, Waveform } from '../types/patch'
import { effectOr, type EffectChain } from './effects'
import { MAX_CUTOFF, MAX_RESONANCE, MIN_CUTOFF, MIN_RESONANCE } from './filter'
import { effectCost, MAX_LOAD, voiceCost } from './load'
import { fillNoise, type NoiseColor } from './noise'
import { isNoise, pulseHarmonics, rampHarmonics } from './waveforms'
import type { RouterOp } from './router'

/** Cost in points of what a voice is made of, so the budget can be about work rather than count. */

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
  release: number
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
interface EffectInstance {
  /** Points, refreshed when a parameter that bears on it moves — a reverb's tail, most of all. */
  cost: number
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

const STEAL_FADE = 0.008
/** Time constant for a parameter change that should not click. */
const RAMP = 0.01
const MIN_RAMP = 0.005
/** Noise plays back at rate 1 on this note (C4), and shifts with the sequencer from there. */
const NOISE_REFERENCE_FREQ = 261.6255653005986
/** Long enough that the loop point is not audible as a pattern. */
const NOISE_SECONDS = 3

export class AudioEngine implements Engine {
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
  private directLevels = new Map<NodeId, number>()
  private pulseWaves = new Map<number, PeriodicWave>()
  private rampWaveCache: PeriodicWave | null = null
  private noiseBuffers = new Map<NoiseColor, AudioBuffer>()

  /** Must be called from a user gesture: browsers block audio otherwise. */
  async start(): Promise<void> {
    if (!this.ctx) {
      this.realtime = true
      this.build(new AudioContext())
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

    const cost = voiceCost(req.waveform, req.filterType !== 'off')
    if (this.totalLoadAt(req.time) + cost > MAX_LOAD) this.stealOldest(req.time)

    const source = this.createSource(req)

    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0, req.time)
    gain.gain.linearRampToValueAtTime(req.gain, req.time + rise)
    gain.gain.setValueAtTime(req.gain, holdEnd)
    gain.gain.linearRampToValueAtTime(0, end)

    // One biquad per voice, so a filter sweep tracks each note rather than a shared bus.
    const chain: AudioNode[] = [source, gain]
    let tail: AudioNode = source
    if (req.filterType !== 'off') {
      const filter = this.ctx.createBiquadFilter()
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

    const voice: Voice = { nodeId: req.nodeId, cost, start: req.time, end, gain, source, chain }
    source.onended = () => {
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
    const chain = descriptor.create(this.ctx)

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
  private createSource(req: NoteRequest): AudioScheduledSourceNode {
    const ctx = this.ctx as BaseAudioContext

    if (isNoise(req.waveform)) {
      const source = ctx.createBufferSource()
      source.buffer = this.noiseBuffer(req.waveform)
      source.loop = true
      source.playbackRate.setValueAtTime(req.freq / NOISE_REFERENCE_FREQ, req.time)
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
    osc.frequency.setValueAtTime(req.freq, req.time)
    return osc
  }

  private noiseBuffer(color: NoiseColor): AudioBuffer {
    const cached = this.noiseBuffers.get(color)
    if (cached) return cached
    const ctx = this.ctx as BaseAudioContext
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate)
    fillNoise(color, buffer.getChannelData(0))
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
  effectLoad(): number {
    let load = 0
    for (const effect of this.effects.values()) load += effect.cost
    return load
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
    }
  }
}
