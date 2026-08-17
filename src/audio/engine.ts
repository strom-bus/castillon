import type { NodeId } from '../types/patch'

/** Presupuesto de voces. Ver PLAN.md §2.2. */
export const MAX_VOICES = 64
/** Por encima de esta fracción del presupuesto, los nodos reinician en vez de superponerse. */
export const OVERLAP_THRESHOLD = 0.75

export interface NoteRequest {
  nodeId: NodeId
  /** Instante absoluto del reloj de audio. */
  time: number
  freq: number
  /** Segundos que la nota está "pulsada", sin contar la liberación. */
  duration: number
  gain: number
  /** Milisegundos. */
  attack: number
  release: number
}

interface Voice {
  nodeId: NodeId
  start: number
  /** Instante en que la voz deja de sonar del todo (incluida la liberación). */
  end: number
  gain: GainNode
  osc: OscillatorNode
}

/**
 * Interfaz que consume el scheduler. Existe para poder probar el scheduler sin Web Audio
 * (ver scheduler.test.ts).
 */
export interface Engine {
  now(): number
  playNote(req: NoteRequest): void
  /** Cuántas voces estarán sonando en ese instante. */
  voicesAt(time: number): number
  /** Hasta cuándo sigue sonando lo que este nodo programó. */
  nodeBusyUntil(nodeId: NodeId): number
  /** Corta las voces vivas de un nodo, para reiniciar su secuencia. */
  releaseNodeVoices(nodeId: NodeId, at: number): void
}

/** Baja un parámetro a cero sin producir un clic, respetando lo ya programado. */
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

  /** Debe llamarse desde un gesto del usuario: los navegadores bloquean el audio si no. */
  async start(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext()

      const master = this.ctx.createGain()
      master.gain.value = this.masterGainValue

      // Limitador: evita que la salida sature al ramificarse muchas voces.
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
    // El ataque nunca puede pasarse del final de la nota, o nunca llegaría al volumen pedido.
    const rise = Math.min(attack, req.duration * 0.9)
    const holdEnd = req.time + req.duration
    const end = holdEnd + release

    if (this.voicesAt(req.time) >= MAX_VOICES) this.stealOldest(req.time)

    const osc = this.ctx.createOscillator()
    osc.type = 'square'
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

  /** Corta todo inmediatamente, sin clics. El botón de pánico. */
  panic(): void {
    if (!this.ctx) return
    const at = this.ctx.currentTime
    for (const v of this.voices) {
      fadeOut(v.gain.gain, at, STEAL_FADE)
      v.end = at + STEAL_FADE
    }
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
