/**
 * A Web Audio context that records instead of making a sound, for the tests.
 *
 * There is no Web Audio in a test runner, and the parts of the engine most worth testing are exactly
 * the ones that are only about wiring: what got connected to what, and what value was written where.
 * Both of those are observable without anything being audible.
 *
 * Two things are recorded. **Connections** are kept on the destination, so a test can ask a parameter
 * what is driving it — which is the whole question behind modulation. **Writes** go to one journal in
 * arrival order, both scheduled parameter changes and plain property assignments, so a test can ask
 * the weaker but broader question of whether anything is still happening at all. That second one is
 * what catches a modulation driven by recomputation, where there is no connection to look at.
 */

/** A scheduled write, or a property set on a node. */
export interface Write {
  what: string
  value: number | string
  /**
   * Which automation method wrote it, where more than one can write the same parameter.
   *
   * Recorded because a pitch slide must ramp exponentially and not linearly — pitch is heard in ratios,
   * so a linear ramp in hertz crosses the bottom of an octave quickly and crawls through the top, audible
   * as the slide slowing down. Without this the stub reported both spellings identically and swapping one
   * for the other failed nothing.
   */
  how?: 'set' | 'target' | 'linear' | 'exponential'
}

export interface FakeParam {
  value: number
  /** What is connected into this parameter. */
  incoming: unknown[]
  setValueAtTime(value: number): void
  setTargetAtTime(value: number): void
  linearRampToValueAtTime(value: number): void
  exponentialRampToValueAtTime(value: number): void
  cancelScheduledValues(): void
}

export interface FakeAudio {
  ctx: BaseAudioContext
  journal: Write[]
  /** Moves the clock, since a recomputed modulation reads it to work out its phase. */
  advance(seconds: number): void
  /** Ends every source that was started, the way a finished note does. */
  endAll(): void
  /** Everything connected into a parameter, found by the name it was created under. */
  drivers(name: string): unknown[]
  /** How many connections into parameters stand right now, whatever they are. */
  wires(): number
  /** Every parameter created under a name — a chain may have several of the same kind. */
  params(name: string): FakeParam[]
  /** Every node created of a kind, in the order they were built. */
  nodes(kind: string): Array<Record<string, unknown>>
}

/**
 * The parameter factory of the most recently built fake.
 *
 * Needed because a worklet node is constructed through a **global** — `new AudioWorkletNode(ctx, …)`
 * — rather than through the context, so the stub cannot be handed a fake. Pointing it at the current
 * one keeps a worklet's parameters in the same registry as everything else, which is what lets a test
 * ask "did anything connect to this" without knowing which sort of node it lives on.
 */
let currentParam: ((name: string, initial?: number) => FakeParam) | null = null

/**
 * Installs the `AudioWorkletNode` jsdom has no notion of.
 *
 * Called from the test setup, so that every test sees a browser that has one. Without it they would
 * all take the fallback path — a bitcrusher with no sample-rate reduction — and the real behaviour
 * would go unexercised, which is the opposite of what a stub is for.
 */
export function installWorkletStub(): void {
  class AudioWorkletNodeStub {
    parameters: Map<string, unknown>

    constructor(_ctx: BaseAudioContext, _name: string) {
      this.parameters = new Map([['hold', currentParam?.('hold', 1) ?? { value: 1 }]])
    }

    connect(next: unknown) {
      return next
    }
    disconnect() {}
  }

  globalThis.AudioWorkletNode ??= AudioWorkletNodeStub as unknown as typeof AudioWorkletNode
}

export function fakeAudio(): FakeAudio {
  const journal: Write[] = []
  const params = new Map<string, FakeParam[]>()
  const built = new Map<string, Array<Record<string, unknown>>>()
  const ended: Array<() => void> = []
  let now = 0

  function param(name: string, initial = 0): FakeParam {
    const self: FakeParam = {
      value: initial,
      incoming: [],
      setValueAtTime(value) {
        self.value = value
        journal.push({ what: name, value, how: 'set' })
      },
      setTargetAtTime(value) {
        self.value = value
        journal.push({ what: name, value, how: 'target' })
      },
      linearRampToValueAtTime(value) {
        self.value = value
        journal.push({ what: name, value, how: 'linear' })
      },
      // Added when a glide started using it. A stub missing a method the engine calls does not report a
      // wrong value, it throws — and the failure names the test rather than the omission.
      exponentialRampToValueAtTime(value) {
        self.value = value
        journal.push({ what: name, value, how: 'exponential' })
      },
      cancelScheduledValues() {},
    }
    const kept = params.get(name)
    if (kept) kept.push(self)
    else params.set(name, [self])
    return self
  }

  /**
   * A node whose property writes are journaled.
   *
   * Through a proxy rather than by hand because the writes that matter most are the ones that are not
   * parameters: a convolver's buffer and a shaper's curve are how a rebuilt modulation shows itself,
   * and there is no method call to intercept.
   */
  function node(kind: string, fields: Record<string, unknown> = {}) {
    // Nodes record what reaches them too, and not only parameters: whether a gain has anything coming
    // into it is the difference between an inverter that negates a signal and one that outputs silence.
    // What a connection records as its source. The proxy rather than the object behind it, so that a
    // node found through `nodes()` and a node found through `drivers()` are the same thing to `===`.
    let self: unknown
    const target: Record<string, unknown> = {
      incoming: [] as unknown[],
      connect(next: unknown) {
        if (next && typeof next === 'object' && 'incoming' in next) {
          ;(next as { incoming: unknown[] }).incoming.push(self ?? target)
        }
        return next
      },
      disconnect(from?: unknown) {
        if (from && typeof from === 'object' && 'incoming' in from) {
          const list = (from as { incoming: unknown[] }).incoming
          const at = list.indexOf(self ?? target)
          if (at !== -1) list.splice(at, 1)
        }
      },
      ...fields,
    }

    const proxy = new Proxy(target, {
      set(store, key, value) {
        store[key as string] = value
        if (typeof value === 'number' || typeof value === 'string') {
          journal.push({ what: `${kind}.${String(key)}`, value })
        } else {
          // A buffer or a curve: what it holds is not the point, only that it was replaced.
          journal.push({ what: `${kind}.${String(key)}`, value: 'rebuilt' })
        }
        return true
      },
    })

    self = proxy
    const kept = built.get(kind)
    if (kept) kept.push(proxy)
    else built.set(kind, [proxy])
    return proxy
  }

  function source(kind: string, fields: Record<string, unknown> = {}) {
    const built = node(kind, {
      started: false,
      // Recorded rather than ignored: whether a source was stopped is the difference between a
      // modulator that was disposed and one still running for the rest of the session.
      stopped: false,
      start() {
        built.started = true
      },
      stop() {
        built.stopped = true
      },
      onended: null,
      ...fields,
    }) as Record<string, unknown> & {
      onended: (() => void) | null
      started: boolean
      stopped: boolean
    }
    ended.push(() => built.onended?.())
    return built
  }

  const ctx = {
    get currentTime() {
      return now
    },
    sampleRate: 48000,
    // Resolves: the stub node is what decides whether a processor is "registered", so this only has
    // to not refuse.
    audioWorklet: { addModule: () => Promise.resolve() },
    destination: node('destination'),
    createGain: () => node('gain', { gain: param('gain', 1) }),
    createBiquadFilter: () =>
      node('biquad', { frequency: param('frequency', 350), Q: param('Q', 1), type: 'lowpass' }),
    createDelay: () => node('delay', { delayTime: param('delayTime') }),
    createConvolver: () => node('convolver', { buffer: null, normalize: true }),
    createWaveShaper: () => node('shaper', { curve: null, oversample: 'none' }),
    createStereoPanner: () => node('panner', { pan: param('pan') }),
    createChannelMerger: () => node('merger'),
    createChannelSplitter: () => node('splitter'),
    createDynamicsCompressor: () =>
      node('compressor', {
        threshold: param('threshold'),
        knee: param('knee'),
        ratio: param('ratio'),
        attack: param('attack'),
        release: param('release'),
      }),
    createConstantSource: () => source('constant', { offset: param('offset', 1) }),
    createOscillator: () =>
      source('osc', {
        frequency: param('oscFrequency', 440),
        detune: param('detune'),
        type: 'sine',
        setPeriodicWave() {},
      }),
    createBufferSource: () =>
      source('bufferSource', {
        buffer: null,
        loop: false,
        playbackRate: param('playbackRate', 1),
      }),
    createPeriodicWave: () => ({}),
    createBuffer: (channels: number, length: number) => {
      // One array per channel, kept: a noise fill writes into it, and whether it wrote the same
      // samples twice is the whole question a seeded render asks.
      const data = Array.from({ length: channels }, () => new Float32Array(length))
      return {
        numberOfChannels: channels,
        length,
        sampleRate: 48000,
        getChannelData: (channel: number) => data[channel],
      }
    },
  } as unknown as BaseAudioContext

  currentParam = param

  return {
    ctx,
    journal,
    advance(seconds) {
      now += seconds
    },
    endAll() {
      // A copy: an ended voice may take others with it.
      for (const end of [...ended]) end()
    },
    drivers(name) {
      return (params.get(name) ?? []).flatMap((p) => p.incoming)
    },
    wires() {
      let total = 0
      for (const list of params.values()) {
        for (const p of list) total += p.incoming.length
      }
      return total
    },
    params(name) {
      return params.get(name) ?? []
    },
    nodes(kind) {
      return built.get(kind) ?? []
    },
  }
}
