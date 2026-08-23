import { SCALES, type ScaleName } from '../audio/scales'
import {
  defaultDelayParams,
  defaultWarpParams,
  defaultFxParams,
  defaultOscParams,
  DEFAULT_STEP_COUNT,
  normaliseStepCount,
  STEP_COUNTS,
} from '../nodes/registry'
import { cutoffToSlider, MAX_RESONANCE, MIN_RESONANCE, sliderToCutoff } from '../audio/filter'
import { FILTER_TYPES } from '../audio/filter'
import {
  MAX_BPM,
  MAX_DECAY,
  MAX_DELAY_MS,
  MAX_SLOP,
  MAX_WARP,
  SWINGS,
  SPEEDS,
  MAX_FEEDBACK,
  MAX_NOTE,
  MAX_RATE,
  MAX_SWEEP,
  MIN_BPM,
  MAX_MOD_ATTACK,
  MAX_MOD_DECAY,
  MIN_DECAY,
  MIN_DELAY_MS,
  MIN_MOD_ATTACK,
  MIN_MOD_DECAY,
  MIN_NOTE,
  MIN_RATE,
  MIN_SWEEP,
  type DelayParams,
  type WarpParams,
  type DistortionShape,
  type Division,
  type EdgeKind,
  type EffectKind,
  type FxParams,
  type IgniteBehaviour,
  type ModParams,
  type OscParams,
  type Patch,
  type PatchEdge,
  type PatchNode,
  type PropagateMode,
  type StartParams,
  type Waveform,
  MAX_RATCHET,
  type Step,
} from '../types/patch'
import { MAX_BITS, MAX_REDUCTION, MIN_BITS, MIN_REDUCTION } from '../audio/dsp'
import { BitReader, BitWriter } from './bits'

/**
 * The patch as the shortest shareable string we can manage.
 *
 * Every field is packed at its real width and the whole thing is base64url'd. The default
 * eight-node patch lands around 130 characters against roughly 2700 as JSON.
 *
 * The lookup tables below are addressed **by position**, so their order is the wire format.
 * Adding a value at the end is safe and renaming one in place is safe; moving or removing a
 * value silently changes what every existing code decodes to. `version` exists for when a
 * change cannot be made that way — bump it and branch on it in `decodePatch`.
 */
const CODE_VERSION = 1

/**
 * Widths chosen with room to grow rather than to fit today. Each of these indexes an append-only
 * table, and running out of room in one would mean a format break to widen it — so they are wide
 * enough that it will not happen. The cost is a couple of bits per patch.
 */
const NODE_TYPE_BITS = 4
const EFFECT_BITS = 5
const WAVEFORM_BITS = 5
const STEP_COUNT_BITS = 3
/** How many parameters the writer knew about, per node type. See `writeParams`. */
const FIELD_COUNT_BITS = 6
/**
 * Reserved, written as zero. Somewhere for a patch-wide option to go — the obvious next one being
 * a flag saying that steps carry velocity again — without needing a version bump.
 */
const HEADER_FLAG_BITS = 4

/**
 * Header flag 1: the Ignites carry a trigger (PLAN §17).
 *
 * The flags were written as zero and read-and-ignored from the first version, reserved for exactly
 * this. Using one keeps every code already in the world readable: an old code has the bit clear, so
 * its Ignites decode as automatic — which is what they were.
 *
 * That matters more than it did before the gallery existed. The wall stores long codes, so a format
 * that broke would take every published patch with it.
 */
const FLAG_IGNITE_TRIGGER = 1

/**
 * Header flag 2: there is modulation, so cables need two bits and MOD nodes carry parameters.
 *
 * The second use of the reserved flags, and the reason for using one rather than widening the format
 * outright: an edge kind has been one bit since the first version, and a third kind needs two. With
 * the flag clear, every code already in the world still reads its cables as event or audio — which is
 * all they ever were.
 */
const FLAG_MODULATION = 2

/** Cable kinds, in the order their index is written. Appended to, never reordered. */
/** Widths for a warp's fields. Wide enough that each table can grow without a format change. */
const WARP_SPEED_BITS = 4
const WARP_SWING_BITS = 4
/** Velocity and chance in fiftieths, which covers 0 to 4 in a byte. */
const WARP_LEVEL_BITS = 8
/** Slop in hundredths, which covers its whole range in six bits with room to spare. */
const WARP_SLOP_BITS = 6

const EDGE_KINDS = ['event', 'audio', 'mod', 'warp'] as const

/** How a short string is written: a length and then its characters. */
const BINDING_SOURCE_BITS = 1
const BINDING_LENGTH_BITS = 5
const BINDING_CHAR_BITS = 7
const MAX_BINDING_LENGTH = 24

/** A modulator's rate, as hundredths of a hertz. Twenty hertz needs eleven bits. */
const MOD_RATE_BITS = 11
const MOD_DEPTH_BITS = 7
// Three, since a stepped random made five shapes of four. The header carries the count, so widening a
// field is a format change like any other and nothing saved before it needs to survive.
const MOD_WAVE_BITS = 3
const MOD_KIND_BITS = 1
const MOD_FIRES_BITS = 1
/** Enough for the whole millisecond range of each, since a MOD is one node and bits are not scarce. */
const MOD_ATTACK_BITS = 11
const MOD_DECAY_BITS = 13
const MOD_WAVES = ['sine', 'triangle', 'square', 'sawtooth', 'random'] as const

// Appended, never reordered: a code stores the index, so moving an entry would rewrite history. Four
// bits leave room for sixteen, of which five are used.
// Append-only, and there is room: four bits hold sixteen and six are used.
const NODE_TYPES = ['start', 'osc', 'delay', 'fx', 'mod', 'warp'] as const

const EFFECT_CODES: EffectKind[] = [
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
  'octave',
]

const SHAPE_CODES: DistortionShape[] = ['overdrive', 'distortion', 'fuzz', 'octave']

const WAVEFORM_CODES: Waveform[] = [
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

const DIVISION_CODES: Division[] = ['1/4', '1/8', '1/16']

const PROPAGATE_CODES: PropagateMode[] = ['onEnd', 'onStart', 'onStep']

/** Node coordinates are stored on a 4 px grid; nothing in this UI is placed finer than that. */
const POSITION_GRID = 4

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function quantise(value: number, scale: number, min: number, max: number): number {
  return clamp(Math.round((Number.isFinite(value) ? value : min) * scale), min, max)
}

function indexBitsFor(count: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(2, count))))
}

/**
 * A parameter's place in the wire format: how many bits it takes and how a value maps onto them.
 *
 * The tables below are the format. Their **order is append-only** — a new parameter goes on the
 * end — and each entry's width and mapping are fixed once codes exist.
 */
interface Field<P> {
  key: keyof P & string
  bits: number
  /** Value → the integer stored. Also what equality is judged on, so precision loss is not a diff. */
  pack(value: never): number
  unpack(stored: number): unknown
}

function field<P>(
  key: keyof P & string,
  bits: number,
  pack: (value: never) => number,
  unpack: (stored: number) => unknown,
): Field<P> {
  return { key, bits, pack, unpack }
}

/** A switch: one bit, and the mask above it means an untouched one costs nothing at all. */
function flagField<P>(key: keyof P & string): Field<P> {
  return field<P>(
    key,
    1,
    (value) => (value ? 1 : 0),
    (stored) => stored === 1,
  )
}

/** An index into an append-only table, which is how every enumerated parameter travels. */
function indexField<P, T>(key: keyof P & string, bits: number, table: T[]): Field<P> {
  return field<P>(
    key,
    bits,
    (value) => Math.max(0, table.indexOf(value as T)),
    (stored) => table[stored] ?? table[0],
  )
}

/** A number scaled and clamped into a fixed width. */
function scaledField<P>(
  key: keyof P & string,
  bits: number,
  scale: number,
  min: number,
  max: number,
): Field<P> {
  return field<P>(
    key,
    bits,
    (value) => quantise(value as unknown as number, scale, min, max) - min,
    (stored) => (stored + min) / scale,
  )
}

const OSC_FIELDS: Field<OscParams>[] = [
  indexField('waveform', WAVEFORM_BITS, WAVEFORM_CODES),
  scaledField('pulseWidth', 7, 100, 5, 95),
  indexField('division', 2, DIVISION_CODES),
  scaledField('gain', 7, 100, 0, 100),
  scaledField('attack', 9, 1, 1, 500),
  scaledField('release', 11, 1, 5, 2000),
  scaledField('gate', 7, 100, 5, 100),
  indexField('filterType', 2, FILTER_TYPES),
  // Cutoff travels as its position on the log slider, not as Hz: 10 bits there is finer than the
  // ear, where 10 bits of raw Hz would be coarse down low and wasted up top.
  field<OscParams>(
    'cutoff',
    10,
    (value) => Math.round(cutoffToSlider(value as unknown as number) * 1023),
    (stored) => sliderToCutoff(stored / 1023),
  ),
  scaledField('resonance', 8, 10, MIN_RESONANCE * 10, MAX_RESONANCE * 10),
  indexField('propagateMode', 2, PROPAGATE_CODES),
  // Appended, which costs nothing: `readParams` reads only as many fields as are declared, so a code
  // written before this existed simply stops early and the reference below supplies the rest.
  scaledField('decay', 11, 1, 0, 2000),
  scaledField('keyTrack', 7, 100, 0, 100),
  flagField('useChance'),
  flagField('useRatchet'),
  indexField('scale', 4, SCALES as ScaleName[]),
  scaledField('scaleRoot', 4, 1, 0, 11),
  scaledField('glide', 10, 1, 0, 1000),
  // Stored shifted, since the field encoder works in non-negative steps and this one runs either way.
  scaledField('detune', 7, 1, -50, 50),
]

const FX_FIELDS: Field<FxParams>[] = [
  indexField('effect', EFFECT_BITS, EFFECT_CODES),
  scaledField('mix', 7, 100, 0, 100),
  scaledField('decay', 7, 10, MIN_DECAY * 10, MAX_DECAY * 10),
  scaledField('drive', 7, 100, 0, 100),
  indexField('time', 2, DIVISION_CODES),
  scaledField('feedback', 7, 100, 0, MAX_FEEDBACK * 100),
  indexField('filterType', 2, FILTER_TYPES),
  field<FxParams>(
    'cutoff',
    10,
    (value) => Math.round(cutoffToSlider(value as unknown as number) * 1023),
    (stored) => sliderToCutoff(stored / 1023),
  ),
  scaledField('resonance', 8, 10, MIN_RESONANCE * 10, MAX_RESONANCE * 10),
  scaledField('rate', 8, 10, MIN_RATE * 10, MAX_RATE * 10),
  scaledField('depth', 7, 100, 0, 100),
  scaledField('bits', 4, 1, MIN_BITS, MAX_BITS),
  // Appended rather than slotted beside `bits`: the order here is the wire format, and appending is
  // the growth this format was built for — `readParams` reads only as many fields as were declared.
  scaledField('reduction', 5, 1, MIN_REDUCTION, MAX_REDUCTION),
  // Shifted so a signed position needs no sign bit of its own.
  field<FxParams>(
    'pan',
    8,
    (value) => quantise((value as unknown as number) + 1, 100, 0, 200),
    (stored) => stored / 100 - 1,
  ),
  scaledField('width', 7, 100, 0, 100),
  indexField('shape', 2, SHAPE_CODES),
  scaledField('sweep', 9, 10, MIN_SWEEP * 10, MAX_SWEEP * 10),
]

/**
 * What the mask is measured against, and **frozen**: these are part of the wire format, so they are
 * deliberately kept apart from the defaults a new node is created with. Those are a design choice
 * that can be retuned — mix and cutoff already have been — and retuning one must not change what
 * every code ever written decodes to.
 */
const OSC_REFERENCE: OscParams = {
  waveform: 'square',
  pulseWidth: 0.5,
  detune: 0,
  steps: [],
  division: '1/8',
  gain: 0.25,
  attack: 4,
  decay: 0,
  release: 40,
  glide: 0,
  gate: 0.6,
  filterType: 'off',
  cutoff: 2000,
  resonance: 1,
  keyTrack: 0,
  useChance: false,
  useRatchet: false,
  scale: 'free',
  scaleRoot: 0,
  propagateMode: 'onEnd',
}

const FX_REFERENCE: FxParams = {
  effect: 'reverb',
  mix: 0.5,
  decay: 2.5,
  drive: 0.4,
  time: '1/8',
  feedback: 0.4,
  filterType: 'lowpass',
  cutoff: 4000,
  resonance: 1,
  rate: 1.5,
  depth: 0.4,
  bits: 8,
  reduction: MIN_REDUCTION,
  pan: 0,
  width: 0.3,
  shape: 'overdrive',
  sweep: 6,
}

/**
 * Only what differs from the reference is written, behind a bitmask saying which.
 *
 * This is where most of the saving lives. A fixed layout paid for every parameter of every node
 * whether it had been touched or not, and in a real patch almost nothing is: a mask bit costs one
 * bit against the seven to eleven the value would have.
 *
 * Equality is judged on the *packed* integer, so a value that quantises to the reference counts as
 * unchanged rather than being stored to say the same thing.
 */
function writeParams<P>(writer: BitWriter, fields: Field<P>[], params: P, reference: P): void {
  const changed = fields.map(
    (f) => f.pack(params[f.key] as never) !== f.pack(reference[f.key] as never),
  )
  for (const bit of changed) writer.write(bit ? 1 : 0, 1)
  fields.forEach((f, i) => {
    if (changed[i]) writer.write(f.pack(params[f.key] as never), f.bits)
  })
}

/**
 * `declared` is how many fields the writer had, taken from the header rather than assumed.
 *
 * That one number is what lets a parameter be added without invalidating a single existing code. An
 * older code declares fewer fields, so exactly that many mask bits are read and anything added
 * since simply takes its reference value — which is what it meant when the code was written.
 *
 * A code declaring *more* fields than this build knows is refused rather than guessed at: the widths
 * of the unknown ones are unknowable, so every bit after them would be misread. Failing is the only
 * honest answer, and the app updating itself makes it a rare one.
 */
function readParams<P extends object>(
  reader: BitReader,
  fields: Field<P>[],
  reference: P,
  declared: number,
): P {
  if (declared > fields.length) throw new Error('patch code is from a newer build')

  const changed = fields.slice(0, declared).map(() => reader.read(1) === 1)
  const params = { ...reference } as Record<string, unknown>
  changed.forEach((bit, i) => {
    if (bit) params[fields[i].key] = fields[i].unpack(reader.read(fields[i].bits))
  })
  return params as P
}

/**
 * What a step carries besides its note, one column each.
 *
 * A column rather than a field per step, so a whole column can be left out when nothing in the sequence
 * uses it — which is the usual case for all four of these.
 */
interface StepColumn {
  bits: number
  /** What the column reads when nothing has touched it, so an untouched column can be skipped. */
  rest: number
  pack(step: Step): number
  unpack(step: Step, stored: number): void
}

const STEP_COLUMNS: StepColumn[] = [
  // Sixteen levels of loudness, which is finer than anyone sets by hand and a quarter of the bits a
  // continuous value would want.
  {
    bits: 4,
    rest: 15,
    pack: (step) => clamp(Math.round((step.velocity ?? 1) * 15), 0, 15),
    unpack: (step, stored) => {
      step.velocity = stored / 15
    },
  },
  {
    bits: 4,
    rest: 15,
    pack: (step) => clamp(Math.round((step.chance ?? 1) * 15), 0, 15),
    unpack: (step, stored) => {
      step.chance = stored / 15
    },
  },
  // Stored as hits minus one, so an ordinary note is zero and an unused column is a run of them.
  {
    bits: 2,
    rest: 0,
    pack: (step) => clamp(Math.round(step.ratchet ?? 1), 1, MAX_RATCHET) - 1,
    unpack: (step, stored) => {
      step.ratchet = stored + 1
    },
  },
  // Signed, so it travels shifted: seven values either side of a flat roll, which is finer than anybody
  // sets a ramp by hand.
  {
    bits: 4,
    rest: 7,
    pack: (step) => clamp(Math.round(((step.ratchetRamp ?? 0) + 1) * 7), 0, 14),
    unpack: (step, stored) => {
      step.ratchetRamp = stored / 7 - 1
    },
  },
  {
    bits: 1,
    rest: 0,
    pack: (step) => (step.slide ? 1 : 0),
    unpack: (step, stored) => {
      step.slide = stored === 1
    },
  },
]

/**
 * How many columns a step carries, for a test that hand-builds a code.
 *
 * Counted from the table rather than written down, so it cannot fall behind it. Exported for the same
 * reason the field totals are: a test writing a code by hand has to write a *valid* one, and one short
 * of a column is not an older code but a truncated one — the reader runs off the end of it and what it
 * finds there is nobody's intention. That is exactly what happened when a fifth column arrived.
 */
export const STEP_COLUMN_TOTAL = STEP_COLUMNS.length

function writeOsc(writer: BitWriter, raw: OscParams): void {
  const params = { ...defaultOscParams(), ...raw }
  writeParams(writer, OSC_FIELDS, params, OSC_REFERENCE)

  const count = normaliseStepCount(params.steps?.length ?? DEFAULT_STEP_COUNT)
  writer.write(STEP_COUNTS.indexOf(count), STEP_COUNT_BITS)

  const steps = Array.from(
    { length: count },
    (_, i) => params.steps[i] ?? { note: 60, active: false, velocity: 1 },
  )
  for (const step of steps) {
    writer.write(step.active ? 1 : 0, 1)
    writer.write(clamp(Math.round(step.note), MIN_NOTE, MAX_NOTE) - MIN_NOTE, 6)
  }

  /*
   * The rest of a step, a column at a time, each behind a bit saying whether it is there at all.
   *
   * Written this way for the same reason the parameters are: almost nothing in a real patch is touched.
   * A sixteen-step node that uses none of these pays four bits for the whole node; one that sets every
   * velocity pays sixty-four for that column and still nothing for the other three. Written flat it
   * would be eleven bits a step whether or not a single one differed from its default.
   */
  for (const column of STEP_COLUMNS) {
    const used = steps.some((step) => column.pack(step) !== column.rest)
    writer.write(used ? 1 : 0, 1)
    if (!used) continue
    for (const step of steps) writer.write(column.pack(step), column.bits)
  }
}

function readOsc(reader: BitReader, declared: number): OscParams {
  const params = readParams(reader, OSC_FIELDS, OSC_REFERENCE, declared)
  const count = STEP_COUNTS[reader.read(STEP_COUNT_BITS)] ?? DEFAULT_STEP_COUNT

  const steps: Step[] = []
  for (let i = 0; i < count; i++) {
    const active = reader.read(1) === 1
    const note = reader.read(6) + MIN_NOTE
    steps.push({ note, active, velocity: 1 })
  }

  for (const column of STEP_COLUMNS) {
    if (reader.read(1) !== 1) continue
    for (const step of steps) column.unpack(step, reader.read(column.bits))
  }

  return { ...params, steps }
}

/**
 * An Ignite's trigger.
 *
 * One bit for automatic, which is the overwhelming case and costs nothing. A bound one then spends a
 * bit on its behaviour and writes its key as characters — a table of key names would be smaller and
 * would fail the moment somebody binds a key nobody thought of.
 */
function writeStart(writer: BitWriter, raw: StartParams): void {
  const bound = raw.trigger === 'bound'
  writer.write(bound ? 1 : 0, 1)
  if (!bound) return

  writer.write(raw.behaviour === 'toggle' ? 1 : 0, 1)
  // Which source the code belongs to. Without it a MIDI binding came back as a *key* binding named
  // "60", which answers to nothing — a shared patch that looked bound and was not.
  writer.write(raw.binding?.source === 'midi' ? 1 : 0, BINDING_SOURCE_BITS)
  const code = (raw.binding?.code ?? '').slice(0, MAX_BINDING_LENGTH)
  writer.write(code.length, BINDING_LENGTH_BITS)
  for (const char of code) {
    // Seven bits: every key code is ASCII, and a stray character becomes a question mark rather than
    // corrupting the bits that follow.
    const point = char.codePointAt(0) ?? 63
    writer.write(point < 128 ? point : 63, BINDING_CHAR_BITS)
  }
}

function readStart(reader: BitReader): StartParams {
  if (reader.read(1) === 0) return {}

  const behaviour: IgniteBehaviour = reader.read(1) === 1 ? 'toggle' : 'hold'
  const source = reader.read(BINDING_SOURCE_BITS) === 1 ? 'midi' : 'key'
  const length = reader.read(BINDING_LENGTH_BITS)
  let code = ''
  for (let i = 0; i < length; i++) code += String.fromCharCode(reader.read(BINDING_CHAR_BITS))

  return {
    trigger: 'bound',
    behaviour,
    binding: code ? { source, code } : null,
  }
}

/** A length-prefixed ASCII string, which is how an open set of names travels. */
function writeText(writer: BitWriter, text: string): void {
  const cut = text.slice(0, MAX_BINDING_LENGTH)
  writer.write(cut.length, BINDING_LENGTH_BITS)
  for (const char of cut) {
    const point = char.codePointAt(0) ?? 63
    writer.write(point < 128 ? point : 63, BINDING_CHAR_BITS)
  }
}

function readText(reader: BitReader): string {
  const length = reader.read(BINDING_LENGTH_BITS)
  let text = ''
  for (let i = 0; i < length; i++) text += String.fromCharCode(reader.read(BINDING_CHAR_BITS))
  return text
}

/**
 * A modulator.
 *
 * The target is written as text rather than as an index, and that is the point: it is a parameter key
 * of whatever effect the cable landed on, so the set is open and a table of names would fail the
 * moment an effect gained a parameter.
 */
/**
 * A warp's five dimensions.
 *
 * Only `transpose` used to travel. The other three were added to the node and never to the code, so a
 * warp set to two-thirds speed came back at 1 — the preset built around exactly that shared as a
 * different patch, silently, in the version that shipped. What hid it is that the round-trip check
 * compared `encode(decode(code))` with `code`, which is stability and not fidelity: both encodes dropped
 * the same fields, so the two strings matched perfectly while the patch between them changed.
 *
 * Written unconditionally rather than behind a presence bitmask. A warp is one node, the five fields come
 * to twenty-four bits, and a conditional layout is a second thing both ends have to agree about — which
 * is the class of mistake being fixed here, not one to introduce while fixing it.
 */
function writeWarp(writer: BitWriter, raw: WarpParams): void {
  // Shifted so the sign travels without a bit of its own: five bits carry the whole range twice over.
  writer.write(quantise(raw.transpose ?? 0, 1, -MAX_WARP, MAX_WARP) + MAX_WARP, 5)
  // Ratios by index into their tables, which are append-only, so a new ratio never moves an old one.
  writer.write(indexOfNearest(SPEEDS, raw.speed ?? 1), WARP_SPEED_BITS)
  writer.write(indexOfNearest(SWINGS, raw.swing ?? 1), WARP_SWING_BITS)
  writer.write(raw.useSwing === true ? 1 : 0, 1)
  // Slop in hundredths of its own range, which is a share and not a time — see MAX_SLOP.
  writer.write(quantise((raw.slop ?? 0) * 100, 1, 0, MAX_SLOP * 100), WARP_SLOP_BITS)
  writer.write(raw.useSlop === true ? 1 : 0, 1)
  // Free numbers, so hundredths of their range rather than an index.
  writer.write(quantise((raw.velocity ?? 1) * 50, 1, 0, 200), WARP_LEVEL_BITS)
  writer.write(quantise((raw.chance ?? 1) * 50, 1, 0, 200), WARP_LEVEL_BITS)
}

function readWarp(reader: BitReader): WarpParams {
  const transpose = reader.read(5) - MAX_WARP
  const speed = SPEEDS[reader.read(WARP_SPEED_BITS)] ?? 1
  const swing = SWINGS[reader.read(WARP_SWING_BITS)] ?? 1
  const useSwing = reader.read(1) === 1
  const slop = reader.read(WARP_SLOP_BITS) / 100
  const useSlop = reader.read(1) === 1
  const velocity = reader.read(WARP_LEVEL_BITS) / 50
  const chance = reader.read(WARP_LEVEL_BITS) / 50
  return { transpose, speed, swing, useSwing, slop, useSlop, velocity, chance }
}

/**
 * Where in an append-only table a value belongs, by nearness rather than by equality.
 *
 * A code can carry a ratio the table does not hold — an older code, or a hand-built patch — and
 * `indexOf` answers -1 for those, which would silently store the first entry. Nearest stores the closest
 * thing the format can say, which is the honest lossy answer a code is allowed to give.
 */
function indexOfNearest(table: readonly number[], value: number): number {
  let best = 0
  for (let i = 1; i < table.length; i++) {
    if (Math.abs(table[i]! - value) < Math.abs(table[best]! - value)) best = i
  }
  return best
}

function writeMod(writer: BitWriter, raw: ModParams): void {
  // One bit for the kind, and both kinds' parameters written either way. A MOD is one node in a patch
  // and the few spare bits are not worth a conditional layout that both ends have to agree on.
  writer.write(raw.kind === 'env' ? 1 : 0, MOD_KIND_BITS)
  writer.write(raw.fires === 'note' ? 1 : 0, MOD_FIRES_BITS)
  writer.write(raw.byVelocity === true ? 1 : 0, 1)
  const wave = MOD_WAVES.indexOf(raw.wave ?? 'sine')
  writer.write(wave < 0 ? 0 : wave, MOD_WAVE_BITS)
  writer.write(quantise((raw.rate ?? 2) * 100, 1, 0, (1 << MOD_RATE_BITS) - 1), MOD_RATE_BITS)
  writer.write(quantise((raw.depth ?? 0.6) * 100, 1, 0, 100), MOD_DEPTH_BITS)
  writer.write(quantise(raw.attack ?? 40, 1, MIN_MOD_ATTACK, MAX_MOD_ATTACK), MOD_ATTACK_BITS)
  writer.write(quantise(raw.decay ?? 600, 1, MIN_MOD_DECAY, MAX_MOD_DECAY), MOD_DECAY_BITS)
  writeText(writer, raw.target ?? 'level')
}

function readMod(reader: BitReader): ModParams {
  const kind = reader.read(MOD_KIND_BITS) === 1 ? 'env' : 'lfo'
  const fires = reader.read(MOD_FIRES_BITS) === 1 ? 'note' : 'trigger'
  const byVelocity = reader.read(1) === 1
  const wave = MOD_WAVES[reader.read(MOD_WAVE_BITS)] ?? 'sine'
  const rate = reader.read(MOD_RATE_BITS) / 100
  const depth = reader.read(MOD_DEPTH_BITS) / 100
  const attack = reader.read(MOD_ATTACK_BITS)
  const decay = reader.read(MOD_DECAY_BITS)
  const target = readText(reader)
  return { kind, fires, byVelocity, wave, rate, depth, attack, decay, target: target || 'level' }
}

function writeFx(writer: BitWriter, raw: FxParams): void {
  writeParams(writer, FX_FIELDS, { ...defaultFxParams(), ...raw }, FX_REFERENCE)
}

function readFx(reader: BitReader, declared: number): FxParams {
  return readParams(reader, FX_FIELDS, FX_REFERENCE, declared)
}

/** How many parameters this build knows about, which is what the header declares. */
export const OSC_FIELD_TOTAL = OSC_FIELDS.length
export const FX_FIELD_TOTAL = FX_FIELDS.length

export function encodePatch(patch: Patch): string {
  const writer = new BitWriter()

  writer.write(CODE_VERSION, 4)
  writer.write(clamp(Math.round(patch.bpm), MIN_BPM, MAX_BPM) - MIN_BPM, 10)
  writer.write(patch.loop ? 1 : 0, 1)
  // Declared once for the patch rather than per node: one encoder writes the whole thing, so every
  // node of a type shares the count. Twelve bits for a format that survives new parameters.
  writer.write(OSC_FIELDS.length, FIELD_COUNT_BITS)
  writer.write(FX_FIELDS.length, FIELD_COUNT_BITS)
  // Only set when something needs it, so a patch of automatic Ignites still writes the byte it always
  // did and produces the same code it always produced.
  const anyBound = patch.nodes.some(
    (node) => node.type === 'start' && (node.params as StartParams).trigger === 'bound',
  )
  // Two bits are needed by anything past the first two kinds, so the flag covers all of them: there
  // were three when it was named and there are four now, and the question it answers is the same one.
  const anyModulation =
    patch.nodes.some((node) => node.type === 'mod' || node.type === 'warp') ||
    patch.edges.some((e) => e.kind === 'mod' || e.kind === 'warp')
  writer.write(
    (anyBound ? FLAG_IGNITE_TRIGGER : 0) | (anyModulation ? FLAG_MODULATION : 0),
    HEADER_FLAG_BITS,
  )

  const nodes = patch.nodes.filter((n) => (NODE_TYPES as readonly string[]).includes(n.type))
  writer.writeVarint(nodes.length)

  for (const node of nodes) {
    writer.write((NODE_TYPES as readonly string[]).indexOf(node.type), NODE_TYPE_BITS)
    writer.writeSignedVarint(Math.round(node.position.x / POSITION_GRID))
    writer.writeSignedVarint(Math.round(node.position.y / POSITION_GRID))

    if (node.type === 'osc') {
      writeOsc(writer, node.params as OscParams)
    } else if (node.type === 'fx') {
      writeFx(writer, node.params as FxParams)
    } else if (node.type === 'delay') {
      const { delayMs } = { ...defaultDelayParams(), ...(node.params as DelayParams) }
      writer.write(quantise(delayMs / 10, 1, MIN_DELAY_MS / 10, MAX_DELAY_MS / 10), 9)
    } else if (node.type === 'warp') {
      writeWarp(writer, { ...defaultWarpParams(), ...(node.params as WarpParams) })
    } else if (node.type === 'start' && anyBound) {
      writeStart(writer, node.params as StartParams)
    } else if (node.type === 'mod') {
      writeMod(writer, node.params as ModParams)
    }
  }

  // Edges address nodes by their position in the list above, so the ids never travel.
  const indexOf = new Map(nodes.map((n, i) => [n.id, i]))
  const edges = patch.edges.filter((e) => indexOf.has(e.source) && indexOf.has(e.target))
  writer.writeVarint(edges.length)

  const bits = indexBitsFor(nodes.length)
  // One bit until a third kind existed. Two only when there is modulation, so a patch without any
  // writes the bytes it always wrote and nothing already shared changes.
  const kindBits = anyModulation ? 2 : 1
  for (const edge of edges) {
    writer.write(Math.max(0, EDGE_KINDS.indexOf(edge.kind)), kindBits)
    writer.write(indexOf.get(edge.source) as number, bits)
    writer.write(indexOf.get(edge.target) as number, bits)
  }

  return toBase64Url(writer.finish())
}

/** Never throws: a malformed or truncated code is simply not a patch. */
export function decodePatch(code: string): Patch | null {
  try {
    const reader = new BitReader(fromBase64Url(normalisePatchCode(code)))

    if (reader.read(4) !== CODE_VERSION) return null
    const bpm = reader.read(10) + MIN_BPM
    const loop = reader.read(1) === 1
    const oscFields = reader.read(FIELD_COUNT_BITS)
    const fxFields = reader.read(FIELD_COUNT_BITS)
    const flags = reader.read(HEADER_FLAG_BITS)
    const ignitesCarryTrigger = (flags & FLAG_IGNITE_TRIGGER) !== 0
    const hasModulation = (flags & FLAG_MODULATION) !== 0

    const nodeCount = reader.readVarint()
    if (nodeCount > 5000) return null

    const nodes: PatchNode[] = []
    for (let i = 0; i < nodeCount; i++) {
      const type = NODE_TYPES[reader.read(NODE_TYPE_BITS)]
      if (!type) return null
      const x = reader.readSignedVarint() * POSITION_GRID
      const y = reader.readSignedVarint() * POSITION_GRID

      let params: PatchNode['params'] = {}
      if (type === 'osc') {
        params = readOsc(reader, oscFields)
      } else if (type === 'fx') {
        params = readFx(reader, fxFields)
      } else if (type === 'delay') {
        params = { delayMs: reader.read(9) * 10 }
      } else if (type === 'warp') {
        params = readWarp(reader)
      } else if (type === 'start' && ignitesCarryTrigger) {
        params = readStart(reader)
      } else if (type === 'mod') {
        params = readMod(reader)
      }

      nodes.push({ id: `n${i}`, type, position: { x, y }, params })
    }

    const edgeCount = reader.readVarint()
    if (edgeCount > 20000) return null

    const bits = indexBitsFor(nodes.length)
    const edges: PatchEdge[] = []
    for (let i = 0; i < edgeCount; i++) {
      const kind: EdgeKind = EDGE_KINDS[reader.read(hasModulation ? 2 : 1)] ?? 'event'
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

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * A code as it will be read, with every space taken out — not only the ends.
 *
 * A long code is a hundred to three hundred characters of base64url and it travels through whatever
 * somebody has to hand: a chat window, a note, a text file, an email. All of those wrap, so a code
 * arrives with a newline or a run of spaces somewhere in the middle of it, and it used to fail.
 * Silently, because the field coloured itself and said nothing — so the symptom read as "long codes do
 * not work", which is exactly how it was reported.
 *
 * Note where the failure actually was, because it is not where it looks. `atob` ignores ASCII
 * whitespace on its own; what broke is the padding **computed from the length before stripping** — a
 * length inflated by two spaces pads to the wrong multiple of four and the decode throws. Which is why
 * this is its own exported function rather than a `replace` at the call site: it can then be tested for
 * what it returns, and a test on the decode alone proves nothing. `atob` in jsdom is more forgiving
 * about padding than a browser's, so removing the stripping leaves every such test passing.
 *
 * Whitespace is never part of a code, so accepting it anywhere is free.
 */
export function normalisePatchCode(code: string): string {
  return code.replace(/\s+/g, '')
}

function fromBase64Url(code: string): Uint8Array {
  const base64 = code.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
