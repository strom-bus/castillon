var __defProp = Object.defineProperty
var __name = (target, value) => __defProp(target, 'name', { value, configurable: true })

// src/audio/clock.ts
var DIVISION_BEATS = {
  '1/4': 1,
  '1/8': 0.5,
  '1/16': 0.25,
}
var DIVISIONS = Object.keys(DIVISION_BEATS)
function stepDuration(bpm, division) {
  return (60 / bpm) * DIVISION_BEATS[division]
}
__name(stepDuration, 'stepDuration')
function midiToFreq(note) {
  return 440 * Math.pow(2, (note - 69) / 12)
}
__name(midiToFreq, 'midiToFreq')

// src/types/patch.ts
var MIN_DECAY = 0.1
var MAX_DECAY = 10
var MAX_FEEDBACK = 0.95
var MIN_RATE = 0.1
var MAX_RATE = 20
var MIN_SWEEP = 0.5
var MAX_SWEEP = 35
var MIN_DELAY_MS = 10
var MAX_DELAY_MS = 4e3
var MIN_BPM = 20
var MIN_NOTE = 24

// src/audio/dsp.ts
var MIN_BITS = 2
var MAX_BITS = 16
var CURVE_POINTS = 1024
var SHAPES = {
  overdrive(x, amount) {
    const k = amount * 30
    return ((1 + k) * x) / (1 + k * Math.abs(x))
  },
  distortion(x, amount) {
    const k = amount * 40
    return k === 0 ? x : Math.tanh(x * (1 + k)) / Math.tanh(1 + k)
  },
  /**
   * Full-wave rectification, which doubles the frequency: this is how an analogue octave-up pedal
   * works, and why it sounds fuzzy rather than clean. `amount` adds grit on top rather than fading
   * the effect in — an octaver at its lowest setting still octaves, since that is what it is.
   *
   * Rectifying leaves a DC offset behind, so the chain that uses this has to block DC.
   */
  octave(x, amount) {
    const rectified = 2 * Math.abs(x) - 1
    const k = amount * 20
    return k === 0 ? rectified : ((1 + k) * rectified) / (1 + k * Math.abs(rectified))
  },
  fuzz(x, amount) {
    const k = amount * 60
    if (k === 0) return x
    const biased = x + amount * 0.15
    const shaped = Math.sign(biased) * (1 - Math.exp(-Math.abs(biased) * (1 + k)))
    return shaped / (1 - Math.exp(-(1 + amount * 0.15) * (1 + k)))
  },
}
function distortionCurve(shape, amount, points = CURVE_POINTS) {
  const clamped = Math.min(1, Math.max(0, amount))
  const fn = SHAPES[shape] ?? SHAPES.overdrive
  const curve = new Float32Array(points)
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1
    curve[i] = Math.max(-1, Math.min(1, fn(x, clamped)))
  }
  return curve
}
__name(distortionCurve, 'distortionCurve')
function crushCurve(bits, points = CURVE_POINTS) {
  const clamped = Math.min(MAX_BITS, Math.max(MIN_BITS, Math.round(bits)))
  const steps = Math.pow(2, clamped) - 1
  const curve = new Float32Array(points)
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1
    curve[i] = Math.round(((x + 1) / 2) * steps) / steps / 0.5 - 1
  }
  return curve
}
__name(crushCurve, 'crushCurve')
function impulseResponse(seconds, sampleRate, random = Math.random) {
  const length = Math.max(1, Math.floor(seconds * sampleRate))
  return [0, 1].map(() => {
    const channel = new Float32Array(length)
    for (let i = 0; i < length; i++) {
      const envelope = Math.pow(1 - i / length, 2)
      channel[i] = (random() * 2 - 1) * envelope
    }
    return channel
  })
}
__name(impulseResponse, 'impulseResponse')

// src/audio/filter.ts
var FILTER_TYPES = ['off', 'lowpass', 'highpass', 'bandpass']
var MIN_CUTOFF = 20
var MAX_CUTOFF = 18e3
var MIN_RESONANCE = 0.1
var MAX_RESONANCE = 24
var RANGE = Math.log(MAX_CUTOFF / MIN_CUTOFF)
function cutoffToSlider(hz) {
  const clamped = Math.min(MAX_CUTOFF, Math.max(MIN_CUTOFF, hz))
  return Math.log(clamped / MIN_CUTOFF) / RANGE
}
__name(cutoffToSlider, 'cutoffToSlider')
function sliderToCutoff(position) {
  const clamped = Math.min(1, Math.max(0, position))
  return MIN_CUTOFF * Math.exp(clamped * RANGE)
}
__name(sliderToCutoff, 'sliderToCutoff')

// src/audio/effects.ts
var RAMP = 0.02
function tone(ctx) {
  const filter2 = ctx.createBiquadFilter()
  filter2.type = 'lowpass'
  filter2.Q.value = 0.7
  filter2.frequency.value = MAX_CUTOFF
  return filter2
}
__name(tone, 'tone')
function setTone(filter2, params, at) {
  const hz = Math.min(MAX_CUTOFF, Math.max(MIN_CUTOFF, params.cutoff ?? MAX_CUTOFF))
  filter2.frequency.setTargetAtTime(hz, at, RAMP)
}
__name(setTone, 'setTone')
var reverb = {
  kind: 'reverb',
  label: 'Reverb',
  params: ['decay', 'cutoff'],
  defaults: { decay: 2.5, cutoff: 4e3 },
  // Long enough that removing the node lets the tail out rather than cutting it off.
  releaseTime: 0.4,
  create(ctx) {
    const convolver = ctx.createConvolver()
    const damping = tone(ctx)
    convolver.connect(damping)
    let built = -1
    return {
      input: convolver,
      output: damping,
      update(params, { at }) {
        setTone(damping, params, at)
        const decay = Math.round(params.decay * 10) / 10
        if (decay === built) return
        built = decay
        const channels = impulseResponse(decay, ctx.sampleRate)
        const buffer = ctx.createBuffer(channels.length, channels[0].length, ctx.sampleRate)
        channels.forEach((channel, i) => buffer.getChannelData(i).set(channel))
        convolver.buffer = buffer
      },
      dispose() {
        convolver.disconnect()
        damping.disconnect()
      },
    }
  },
}
var distortion = {
  kind: 'distortion',
  label: 'Distortion',
  params: ['shape', 'drive', 'cutoff'],
  defaults: { drive: 0.4, cutoff: 4e3 },
  releaseTime: 0.02,
  create(ctx) {
    const shaper = ctx.createWaveShaper()
    shaper.oversample = '4x'
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
        const key = `${shape}:${amount}`
        if (key === built) return
        built = key
        shaper.curve = distortionCurve(shape, amount)
      },
      dispose() {
        shaper.disconnect()
        dcBlock.disconnect()
        post.disconnect()
      },
    }
  },
}
var crush = {
  kind: 'crush',
  label: 'Bitcrusher',
  params: ['bits', 'cutoff'],
  defaults: { bits: 6, cutoff: 6e3 },
  releaseTime: 0.02,
  create(ctx) {
    const shaper = ctx.createWaveShaper()
    shaper.oversample = 'none'
    const post = tone(ctx)
    shaper.connect(post)
    let built = -1
    return {
      input: shaper,
      output: post,
      update(params, { at }) {
        setTone(post, params, at)
        const bits = Math.round(params.bits ?? MAX_BITS)
        if (bits === built) return
        built = bits
        shaper.curve = crushCurve(bits)
      },
      dispose() {
        shaper.disconnect()
        post.disconnect()
      },
    }
  },
}
var MAX_ECHO_SECONDS = 4
var echo = {
  kind: 'echo',
  label: 'Echo',
  params: ['time', 'feedback', 'width', 'cutoff'],
  labels: { width: 'Spread' },
  defaults: { time: '1/8', feedback: 0.4, width: 0, cutoff: 3e3 },
  releaseTime: 0.3,
  create(ctx) {
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
    second.connect(damping)
    damping.connect(feedback)
    feedback.connect(first)
    return {
      input: first,
      output: out,
      update(params, { at, bpm }) {
        setTone(damping, params, at)
        const seconds = Math.min(MAX_ECHO_SECONDS, stepDuration(bpm, params.time ?? '1/8'))
        first.delayTime.setTargetAtTime(seconds, at, RAMP)
        second.delayTime.setTargetAtTime(seconds, at, RAMP)
        feedback.gain.setTargetAtTime(Math.min(0.95, Math.max(0, params.feedback ?? 0)), at, RAMP)
        const spread = Math.min(1, Math.max(0, params.width ?? 0))
        left.pan.setTargetAtTime(-spread, at, RAMP)
        right.pan.setTargetAtTime(spread, at, RAMP)
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
var filter = {
  kind: 'filter',
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
        biquad.type = type === 'off' ? 'lowpass' : type
        const hz = type === 'off' ? MAX_CUTOFF : (params.cutoff ?? 2e3)
        biquad.frequency.setTargetAtTime(Math.min(MAX_CUTOFF, Math.max(MIN_CUTOFF, hz)), at, RAMP)
        biquad.Q.setTargetAtTime(Math.max(0.1, params.resonance ?? 1), at, RAMP)
      },
      dispose() {
        biquad.disconnect()
      },
    }
  },
}
var MAX_CHORUS_FEEDBACK = 0.7
var chorus = {
  kind: 'chorus',
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
        const centre = Math.min(MAX_SWEEP, Math.max(MIN_SWEEP, params.sweep ?? 6)) / 1e3
        line.delayTime.setTargetAtTime(centre, at, RAMP)
        lfo.frequency.setTargetAtTime(Math.max(0.01, params.rate ?? 1.5), at, RAMP)
        swing.gain.setTargetAtTime((params.depth ?? 0.4) * centre * 0.9, at, RAMP)
        feedback.gain.setTargetAtTime(
          Math.min(MAX_CHORUS_FEEDBACK, Math.max(0, params.feedback ?? 0)),
          at,
          RAMP,
        )
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
var PHASER_STAGES = 4
var MAX_PHASER_FEEDBACK = 0.6
var phaser = {
  kind: 'phaser',
  label: 'Phaser',
  params: ['rate', 'depth', 'feedback', 'cutoff'],
  labels: { cutoff: 'Centre' },
  defaults: { rate: 0.5, depth: 0.7, feedback: 0.3, cutoff: 600 },
  releaseTime: 0.05,
  create(ctx) {
    const stages = Array.from({ length: PHASER_STAGES }, () => {
      const filter2 = ctx.createBiquadFilter()
      filter2.type = 'allpass'
      filter2.Q.value = 0.6
      return filter2
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
    for (const stage of stages) swing.connect(stage.frequency)
    lfo.start()
    return {
      input: stages[0],
      output: last,
      update(params, { at }) {
        const centre = Math.min(MAX_CUTOFF, Math.max(MIN_CUTOFF, params.cutoff ?? 600))
        stages.forEach((stage, i) => {
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
var tremolo = {
  kind: 'tremolo',
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
        amp.gain.setTargetAtTime(1 - depth / 2, at, RAMP)
        swing.gain.setTargetAtTime(depth / 2, at, RAMP)
        lfo.frequency.setTargetAtTime(Math.max(0.01, params.rate ?? 4), at, RAMP)
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
var ring = {
  kind: 'ring',
  label: 'Ring mod',
  params: ['cutoff'],
  // The carrier frequency, which the cutoff field already covers with the right range and a log
  // slider to set it on.
  labels: { cutoff: 'Freq' },
  defaults: { cutoff: 300 },
  releaseTime: 0.02,
  create(ctx) {
    const multiplier = ctx.createGain()
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
      dispose() {
        carrier.stop()
        carrier.disconnect()
        multiplier.disconnect()
      },
    }
  },
}
var MAX_WIDTH_SECONDS = 0.02
var pan = {
  kind: 'pan',
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
var EFFECTS = [reverb, echo, distortion, crush, filter, chorus, phaser, tremolo, ring, pan]
var byKind = new Map(EFFECTS.map((e) => [e.kind, e]))

// src/audio/engine.ts
var MAX_VOICES = 64
var OVERLAP_THRESHOLD = 0.75

// src/nodes/registry.ts
var FLASH = 0.12
var start = {
  // Kept as 'start' rather than 'ignite': the type reads better than the label in a stack
  // trace or a serialised patch, and the two do not have to match.
  type: 'start',
  label: 'IGNITE',
  defaults: /* @__PURE__ */ __name(() => ({}), 'defaults'),
  schedule({ node, time, activity }) {
    activity.push({ kind: 'node', id: node.id, time, duration: FLASH })
    return { endTime: time, outgoing: [time] }
  },
}
var DEFAULT_DELAY_MS = 500
function defaultDelayParams() {
  return { delayMs: DEFAULT_DELAY_MS }
}
__name(defaultDelayParams, 'defaultDelayParams')
var delay = {
  type: 'delay',
  label: 'DELAY',
  defaults: defaultDelayParams,
  schedule({ node, time, activity }) {
    const params = node.params
    const ms = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, params.delayMs ?? DEFAULT_DELAY_MS))
    const wait = ms / 1e3
    activity.push({ kind: 'node', id: node.id, time, duration: wait })
    return { endTime: time + wait, outgoing: [time + wait] }
  },
}
var STEP_COUNTS = [2, 4, 8, 16]
var DEFAULT_STEP_COUNT = 4
function normaliseStepCount(count) {
  return STEP_COUNTS.includes(count) ? count : DEFAULT_STEP_COUNT
}
__name(normaliseStepCount, 'normaliseStepCount')
var DEFAULT_NOTES = [48, 52, 55, 60]
function defaultOscParams() {
  return {
    waveform: 'square',
    pulseWidth: 0.5,
    steps: DEFAULT_NOTES.map((note) => ({ note, active: true, velocity: 1 })),
    division: '1/8',
    gain: 0.25,
    attack: 4,
    release: 40,
    gate: 0.6,
    filterType: 'off',
    cutoff: 2e3,
    resonance: 1,
    propagateMode: 'onEnd',
  }
}
__name(defaultOscParams, 'defaultOscParams')
var osc = {
  type: 'osc',
  label: 'OSC',
  defaults: defaultOscParams,
  schedule({ node, time, bpm, engine, activity }) {
    const params = node.params
    const step = stepDuration(bpm, params.division)
    const stillSounding = engine.nodeBusyUntil(node.id) > time
    if (stillSounding && engine.voicesAt(time) >= MAX_VOICES * OVERLAP_THRESHOLD) {
      engine.releaseNodeVoices(node.id, time)
    }
    const count = normaliseStepCount(params.steps?.length ?? DEFAULT_STEP_COUNT)
    activity.push({ kind: 'node', id: node.id, time, duration: step * count })
    for (let i = 0; i < count; i++) {
      const at = time + i * step
      const s = params.steps[i]
      activity.push({ kind: 'step', id: node.id, step: i, time: at, duration: step })
      if (!s || !s.active) continue
      engine.playNote({
        nodeId: node.id,
        time: at,
        freq: midiToFreq(s.note),
        // ?? keeps patches saved before waveforms existed playable.
        waveform: params.waveform ?? 'square',
        pulseWidth: params.pulseWidth ?? 0.5,
        duration: step * params.gate,
        gain: params.gain * s.velocity,
        attack: params.attack,
        release: params.release,
        filterType: params.filterType ?? 'off',
        cutoff: params.cutoff ?? 2e3,
        resonance: params.resonance ?? 1,
      })
    }
    const endTime = time + count * step
    let outgoing
    switch (params.propagateMode) {
      case 'onStart':
        outgoing = [time]
        break
      case 'onStep':
        outgoing = Array.from({ length: count }, (_, i) => time + i * step)
        break
      default:
        outgoing = [endTime]
    }
    return { endTime, outgoing }
  },
}
function defaultFxParams() {
  return {
    effect: 'reverb',
    mix: 0.5,
    decay: 2,
    drive: 0.4,
    shape: 'overdrive',
    time: '1/8',
    feedback: 0.35,
    filterType: 'lowpass',
    // Open enough that an effect does not arrive sounding muffled.
    cutoff: 6e3,
    resonance: 1,
    rate: 1.5,
    depth: 0.4,
    bits: 8,
    pan: 0,
    width: 0.3,
    sweep: 6,
  }
}
__name(defaultFxParams, 'defaultFxParams')
var fx = {
  type: 'fx',
  label: 'FX',
  defaults: defaultFxParams,
}
var NODE_DEFINITIONS = [start, osc, fx, delay]
var byType = new Map(NODE_DEFINITIONS.map((d) => [d.type, d]))

// src/state/bits.ts
var BitReader = class {
  static {
    __name(this, 'BitReader')
  }
  bytes
  position = 0
  constructor(bytes) {
    this.bytes = bytes
  }
  read(bits) {
    let value = 0
    for (let i = 0; i < bits; i++) {
      const index = this.position >>> 3
      if (index >= this.bytes.length) throw new Error('patch code ended early')
      const bit = (this.bytes[index] >>> (7 - (this.position & 7))) & 1
      value = (value << 1) | bit
      this.position++
    }
    return value >>> 0
  }
  readVarint() {
    let result = 0
    let shift = 0
    for (;;) {
      const byte = this.read(8)
      result |= (byte & 127) << shift
      if ((byte & 128) === 0) return result >>> 0
      shift += 7
      if (shift > 28) throw new Error('varint too long')
    }
  }
  readSignedVarint() {
    const value = this.readVarint()
    return (value >>> 1) ^ -(value & 1)
  }
}

// src/state/patchCode.ts
var CODE_VERSION = 1
var NODE_TYPE_BITS = 4
var EFFECT_BITS = 5
var WAVEFORM_BITS = 5
var STEP_COUNT_BITS = 3
var FIELD_COUNT_BITS = 6
var HEADER_FLAG_BITS = 4
var NODE_TYPES = ['start', 'osc', 'delay', 'fx']
var EFFECT_CODES = [
  'reverb',
  'echo',
  'distortion',
  'crush',
  'filter',
  'chorus',
  'ring',
  'pan',
  // Appended, so the positions above are untouched.
  'phaser',
  'tremolo',
]
var SHAPE_CODES = ['overdrive', 'distortion', 'fuzz', 'octave']
var WAVEFORM_CODES = [
  'square',
  'pulse',
  'sawtooth',
  'triangle',
  // Appended, so existing positions are untouched.
  'sine',
  'white',
  'pink',
  'brown',
  'blue',
  'ramp',
]
var DIVISION_CODES = ['1/4', '1/8', '1/16']
var PROPAGATE_CODES = ['onEnd', 'onStart', 'onStep']
var POSITION_GRID = 4
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}
__name(clamp, 'clamp')
function quantise(value, scale, min, max) {
  return clamp(Math.round((Number.isFinite(value) ? value : min) * scale), min, max)
}
__name(quantise, 'quantise')
function indexBitsFor(count) {
  return Math.max(1, Math.ceil(Math.log2(Math.max(2, count))))
}
__name(indexBitsFor, 'indexBitsFor')
function field(key, bits, pack, unpack) {
  return { key, bits, pack, unpack }
}
__name(field, 'field')
function indexField(key, bits, table) {
  return field(
    key,
    bits,
    (value) => Math.max(0, table.indexOf(value)),
    (stored) => table[stored] ?? table[0],
  )
}
__name(indexField, 'indexField')
function scaledField(key, bits, scale, min, max) {
  return field(
    key,
    bits,
    (value) => quantise(value, scale, min, max) - min,
    (stored) => (stored + min) / scale,
  )
}
__name(scaledField, 'scaledField')
var OSC_FIELDS = [
  indexField('waveform', WAVEFORM_BITS, WAVEFORM_CODES),
  scaledField('pulseWidth', 7, 100, 5, 95),
  indexField('division', 2, DIVISION_CODES),
  scaledField('gain', 7, 100, 0, 100),
  scaledField('attack', 9, 1, 1, 500),
  scaledField('release', 11, 1, 5, 2e3),
  scaledField('gate', 7, 100, 5, 100),
  indexField('filterType', 2, FILTER_TYPES),
  // Cutoff travels as its position on the log slider, not as Hz: 10 bits there is finer than the
  // ear, where 10 bits of raw Hz would be coarse down low and wasted up top.
  field(
    'cutoff',
    10,
    (value) => Math.round(cutoffToSlider(value) * 1023),
    (stored) => sliderToCutoff(stored / 1023),
  ),
  scaledField('resonance', 8, 10, MIN_RESONANCE * 10, MAX_RESONANCE * 10),
  indexField('propagateMode', 2, PROPAGATE_CODES),
]
var FX_FIELDS = [
  indexField('effect', EFFECT_BITS, EFFECT_CODES),
  scaledField('mix', 7, 100, 0, 100),
  scaledField('decay', 7, 10, MIN_DECAY * 10, MAX_DECAY * 10),
  scaledField('drive', 7, 100, 0, 100),
  indexField('time', 2, DIVISION_CODES),
  scaledField('feedback', 7, 100, 0, MAX_FEEDBACK * 100),
  indexField('filterType', 2, FILTER_TYPES),
  field(
    'cutoff',
    10,
    (value) => Math.round(cutoffToSlider(value) * 1023),
    (stored) => sliderToCutoff(stored / 1023),
  ),
  scaledField('resonance', 8, 10, MIN_RESONANCE * 10, MAX_RESONANCE * 10),
  scaledField('rate', 8, 10, MIN_RATE * 10, MAX_RATE * 10),
  scaledField('depth', 7, 100, 0, 100),
  scaledField('bits', 4, 1, MIN_BITS, MAX_BITS),
  // Shifted so a signed position needs no sign bit of its own.
  field(
    'pan',
    8,
    (value) => quantise(value + 1, 100, 0, 200),
    (stored) => stored / 100 - 1,
  ),
  scaledField('width', 7, 100, 0, 100),
  indexField('shape', 2, SHAPE_CODES),
  scaledField('sweep', 9, 10, MIN_SWEEP * 10, MAX_SWEEP * 10),
]
var OSC_REFERENCE = {
  waveform: 'square',
  pulseWidth: 0.5,
  steps: [],
  division: '1/8',
  gain: 0.25,
  attack: 4,
  release: 40,
  gate: 0.6,
  filterType: 'off',
  cutoff: 2e3,
  resonance: 1,
  propagateMode: 'onEnd',
}
var FX_REFERENCE = {
  effect: 'reverb',
  mix: 0.5,
  decay: 2.5,
  drive: 0.4,
  time: '1/8',
  feedback: 0.4,
  filterType: 'lowpass',
  cutoff: 4e3,
  resonance: 1,
  rate: 1.5,
  depth: 0.4,
  bits: 8,
  pan: 0,
  width: 0.3,
  shape: 'overdrive',
  sweep: 6,
}
function readParams(reader, fields, reference, declared) {
  if (declared > fields.length) throw new Error('patch code is from a newer build')
  const changed = fields.slice(0, declared).map(() => reader.read(1) === 1)
  const params = { ...reference }
  changed.forEach((bit, i) => {
    if (bit) params[fields[i].key] = fields[i].unpack(reader.read(fields[i].bits))
  })
  return params
}
__name(readParams, 'readParams')
function readOsc(reader, declared) {
  const params = readParams(reader, OSC_FIELDS, OSC_REFERENCE, declared)
  const count = STEP_COUNTS[reader.read(STEP_COUNT_BITS)] ?? DEFAULT_STEP_COUNT
  const steps = []
  for (let i = 0; i < count; i++) {
    const active = reader.read(1) === 1
    const note = reader.read(6) + MIN_NOTE
    steps.push({ note, active, velocity: 1 })
  }
  return { ...params, steps }
}
__name(readOsc, 'readOsc')
function readFx(reader, declared) {
  return readParams(reader, FX_FIELDS, FX_REFERENCE, declared)
}
__name(readFx, 'readFx')
var OSC_FIELD_TOTAL = OSC_FIELDS.length
var FX_FIELD_TOTAL = FX_FIELDS.length
function decodePatch(code) {
  try {
    const reader = new BitReader(fromBase64Url(code.trim()))
    if (reader.read(4) !== CODE_VERSION) return null
    const bpm = reader.read(10) + MIN_BPM
    const loop = reader.read(1) === 1
    const oscFields = reader.read(FIELD_COUNT_BITS)
    const fxFields = reader.read(FIELD_COUNT_BITS)
    reader.read(HEADER_FLAG_BITS)
    const nodeCount = reader.readVarint()
    if (nodeCount > 5e3) return null
    const nodes = []
    for (let i = 0; i < nodeCount; i++) {
      const type = NODE_TYPES[reader.read(NODE_TYPE_BITS)]
      if (!type) return null
      const x = reader.readSignedVarint() * POSITION_GRID
      const y = reader.readSignedVarint() * POSITION_GRID
      let params = {}
      if (type === 'osc') {
        params = readOsc(reader, oscFields)
      } else if (type === 'fx') {
        params = readFx(reader, fxFields)
      } else if (type === 'delay') {
        params = { delayMs: reader.read(9) * 10 }
      }
      nodes.push({ id: `n${i}`, type, position: { x, y }, params })
    }
    const edgeCount = reader.readVarint()
    if (edgeCount > 2e4) return null
    const bits = indexBitsFor(nodes.length)
    const edges = []
    for (let i = 0; i < edgeCount; i++) {
      const kind = reader.read(1) === 1 ? 'audio' : 'event'
      const source = reader.read(bits)
      const target = reader.read(bits)
      if (source >= nodes.length || target >= nodes.length) return null
      edges.push({
        id: `e${i}`,
        kind,
        source: nodes[source].id,
        target: nodes[target].id,
      })
    }
    return { version: 1, bpm, loop, nodes, edges }
  } catch {
    return null
  }
}
__name(decodePatch, 'decodePatch')
function fromBase64Url(code) {
  const base64 = code.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
__name(fromBase64Url, 'fromBase64Url')

// src/state/shortCode.ts
var ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
var SHORT_CODE_LENGTH = 6
var MAX_SHORT_CODE_LENGTH = 10
function hash(input) {
  let high = 3421674724
  let low = 2216829733
  for (let i = 0; i < input.length; i++) {
    low ^= input.charCodeAt(i) & 255
    const lowShift8 = (low << 8) >>> 0
    const highShift8 = (((high << 8) >>> 0) | (low >>> 24)) >>> 0
    const lowShift40 = 0
    const highShift40 = (low << 8) >>> 0
    let nextLow = low * 179
    let nextHigh = high * 179 + Math.floor(nextLow / 4294967296)
    nextLow = nextLow >>> 0
    nextLow = (nextLow + lowShift8) >>> 0
    nextHigh = (nextHigh + highShift8 + (nextLow < lowShift8 ? 1 : 0)) >>> 0
    nextLow = (nextLow + lowShift40) >>> 0
    nextHigh = (nextHigh + highShift40) >>> 0
    low = nextLow
    high = nextHigh >>> 0
  }
  return [high >>> 0, low >>> 0]
}
__name(hash, 'hash')
function shortCodeFor(patchCode, length = SHORT_CODE_LENGTH) {
  const trimmed = patchCode.trim()
  let [high, low] = hash(trimmed)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += ALPHABET[low & 31]
    low = ((low >>> 5) | ((high & 31) << 27)) >>> 0
    high = high >>> 5
    if (high === 0 && low === 0) [high, low] = hash(`${trimmed}#${i}`)
  }
  return out
}
__name(shortCodeFor, 'shortCodeFor')
function normaliseShortCode(input) {
  return input.trim().toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0').replace(/U/g, 'V')
}
__name(normaliseShortCode, 'normaliseShortCode')

// src/share/worker.ts
var MAX_PATCH_BYTES = 4096
var CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}
function text(body, status = 200) {
  return new Response(body, {
    status,
    headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8' },
  })
}
__name(text, 'text')
async function publish(store, code) {
  const trimmed = code.trim()
  if (trimmed.length === 0) return text('empty', 400)
  if (trimmed.length > MAX_PATCH_BYTES) return text('too large', 413)
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return text('not a patch code', 400)
  if (!decodePatch(trimmed)) return text('not a patch code', 400)
  for (let length = 6; length <= MAX_SHORT_CODE_LENGTH; length++) {
    const key = shortCodeFor(trimmed, length)
    const existing = await store.get(key)
    if (existing === null) {
      await store.put(key, trimmed)
      return text(key)
    }
    if (existing === trimmed) return text(key)
  }
  return text('could not find a free code', 507)
}
__name(publish, 'publish')
async function resolve(store, id) {
  const key = normaliseShortCode(id)
  if (key.length === 0 || key.length > MAX_SHORT_CODE_LENGTH) return text('no such code', 404)
  const code = await store.get(key)
  return code === null ? text('no such code', 404) : text(code)
}
__name(resolve, 'resolve')
async function handle(request, store) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const path = new URL(request.url).pathname.replace(/^\/+|\/+$/g, '')
  if (request.method === 'POST') return publish(store, await request.text())
  if (request.method === 'GET') {
    return path === '' ? text('castillon share service') : resolve(store, path)
  }
  return text('method not allowed', 405)
}
__name(handle, 'handle')
var worker_default = {
  fetch(request, env) {
    return handle(request, env.PATCHES)
  },
}
export { MAX_PATCH_BYTES, worker_default as default, handle }
//# sourceMappingURL=worker.js.map
