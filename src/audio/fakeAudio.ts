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

import { WORKLET_PARAMS } from './worklets/names'

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
    /**
     * What is connected into it, and what it is connected to, recorded the same way every other node
     * here records it.
     *
     * It used to record neither — `connect` returned its argument and forgot — which made a processor a
     * hole in the graph the fake can see: a chain that failed to hook its worklet up to what comes after
     * it looked identical to one that did. That is the third gap of this kind found in this file, and
     * they all read as a gap in the engine rather than in the stub.
     */
    incoming: unknown[] = []

    constructor(_ctx: BaseAudioContext, name: string) {
      // Read from the same list the processors declare, so the stub cannot know a different set of
      // parameters from the thing it stands in for. It used to hold `['hold']` written out by hand,
      // which was right when there was one worklet and silently wrong once there were three.
      this.parameters = new Map(
        (WORKLET_PARAMS[name] ?? []).map((param) => [
          param.name,
          currentParam?.(param.name, param.defaultValue) ?? { value: param.defaultValue },
        ]),
      )
    }

    connect(next: unknown) {
      if (next && typeof next === 'object' && 'incoming' in next) {
        const list = (next as { incoming: unknown[] }).incoming
        // Once, however often it is asked: the spec says a connection already standing has no further
        // effect, and the rest of this fake counts it once for the same reason.
        if (!list.includes(this)) list.push(this)
      }
      return next
    }
    disconnect(from?: unknown) {
      if (from && typeof from === 'object' && 'incoming' in from) {
        const list = (from as { incoming: unknown[] }).incoming
        const at = list.indexOf(this)
        if (at !== -1) list.splice(at, 1)
      }
    }
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
          const list = (next as { incoming: unknown[] }).incoming
          /*
           * Once, however many times it is asked for. The spec is explicit that connecting an output to an
           * input it already reaches has no further effect, and a fake that counted it twice would say a
           * signal arrives at double strength where a browser says it arrives once — so a test built on
           * the count would be measuring the fake.
           *
           * Found by asserting that hooking an effect to the master twice changes nothing, which is true
           * of the real thing and was not of this.
           */
          if (!list.includes(self ?? target)) list.push(self ?? target)
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
      node('biquad', {
        frequency: param('frequency', 350),
        Q: param('Q', 1),
        // A real biquad has one, and only the shelving and peaking types read it — which is why it was
        // missing until an EQ arrived and every one of its bands failed on `undefined`. A fake that is
        // short of a parameter is a test that cannot reach it.
        gain: param('biquadGain', 0),
        type: 'lowpass',
      }),
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
        /*
         * A plain number and not a parameter, which is what the real one is: `reduction` is read-only
         * and reports how hard the compressor is working right now. Here it is writable, which is the
         * only way a test can ask what the interface does when the output is being held back — there is
         * no signal in this context to make it happen for real.
         */
        reduction: 0,
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
        // A buffer source carries one as well as an oscillator does, where it shifts the playback rate
        // rather than a frequency. Absent here, a vibrato on a noise voice looked like a cable that
        // connected to nothing — a gap in the stub reported as a gap in the engine.
        detune: param('detune'),
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
        // Real buffers have one and a random modulator reads it to pick where in the loop to start.
        // Without it that offset was always zero here, so every such modulator ran in lockstep and the
        // stub reported agreement the browser would not have.
        duration: length / 48000,
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
