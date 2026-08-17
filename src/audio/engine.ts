import type { NodeId, Waveform } from '../types/patch'
import { pulseHarmonics } from './waveforms'

/** Voice budget. See PLAN.md §2.2. */
export const MAX_VOICES = 64
/** Above this fraction of the budget, nodes restart instead of layering. */
export const OVERLAP_THRESHOLD = 0.75

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
}

interface Voice {
  nodeId: NodeId
  start: number
  /** When the voice goes fully silent, release included. */
  end: number
  gain: GainNode
  osc: OscillatorNode
}

/**
 * What the scheduler consumes. It exists so the scheduler can be tested without Web Audio
 * (see scheduler.test.ts).
 */
export interface Engine {
  now(): number
  playNote(req: NoteRequest): void
  /** How many voices will be sounding at that instant. */
  voicesAt(time: number): number
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

const STEAL_FADE = 0.008
const MIN_RAMP = 0.005

export class AudioEngine implements Engine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private voices: Voice[] = []
  private masterGainValue = 0.8
  private pulseWaves = new Map<number, PeriodicWave>()

  /** Must be called from a user gesture: browsers block audio otherwise. */
  async start(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext()

      const master = this.ctx.createGain()
      master.gain.value = this.masterGainValue

      // Limiter: keeps the output from clipping once many voices branch out.
      const limiter = this.ctx.createDynamicsCompressor()
      limiter.threshold.value = -6
      limiter.knee.value = 0
      limiter.ratio.value = 20
      limiter.attack.value = 0.003
      limiter.release.value = 0.1

      master.connect(limiter).connect(this.ctx.destination)
      this.master = master
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume()
  }

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
    // Attack must never outrun the note, or it would never reach the requested level.
    const rise = Math.min(attack, req.duration * 0.9)
    const holdEnd = req.time + req.duration
    const end = holdEnd + release

    if (this.voicesAt(req.time) >= MAX_VOICES) this.stealOldest(req.time)

    const osc = this.ctx.createOscillator()
    if (req.waveform === 'pulse') {
      osc.setPeriodicWave(this.pulseWave(req.pulseWidth))
    } else {
      osc.type = req.waveform
    }
    osc.frequency.setValueAtTime(req.freq, req.time)

    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0, req.time)
    gain.gain.linearRampToValueAtTime(req.gain, req.time + rise)
    gain.gain.setValueAtTime(req.gain, holdEnd)
    gain.gain.linearRampToValueAtTime(0, end)

    osc.connect(gain).connect(this.master)
    osc.start(req.time)
    osc.stop(end + 0.01)

    const voice: Voice = { nodeId: req.nodeId, start: req.time, end, gain, osc }
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
      const i = this.voices.indexOf(voice)
      if (i !== -1) this.voices.splice(i, 1)
    }
    this.voices.push(voice)
  }

  voicesAt(time: number): number {
    let n = 0
    for (const v of this.voices) if (v.start <= time && v.end > time) n++
    return n
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

  /** Pulse waves are cached per duty cycle: rebuilding one per note is expensive. */
  private pulseWave(duty: number): PeriodicWave {
    const ctx = this.ctx as AudioContext
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
