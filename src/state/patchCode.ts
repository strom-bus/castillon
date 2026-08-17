import {
  defaultDelayParams,
  defaultOscParams,
  DEFAULT_STEP_COUNT,
  normaliseStepCount,
  STEP_COUNTS,
} from '../nodes/registry'
import { cutoffToSlider, MAX_RESONANCE, MIN_RESONANCE, sliderToCutoff } from '../audio/filter'
import { FILTER_TYPES } from '../audio/filter'
import {
  MAX_BPM,
  MAX_DELAY_MS,
  MAX_NOTE,
  MIN_BPM,
  MIN_DELAY_MS,
  MIN_NOTE,
  type DelayParams,
  type Division,
  type OscParams,
  type Patch,
  type PatchEdge,
  type PatchNode,
  type PropagateMode,
  type Waveform,
} from '../types/patch'
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

const NODE_TYPES = ['start', 'osc', 'delay'] as const

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

function writeOsc(writer: BitWriter, raw: OscParams): void {
  const params = { ...defaultOscParams(), ...raw }

  const waveform = Math.max(0, WAVEFORM_CODES.indexOf(params.waveform))
  writer.write(waveform, 4)
  writer.write(quantise(params.pulseWidth, 100, 5, 95), 7)
  writer.write(Math.max(0, DIVISION_CODES.indexOf(params.division)), 2)
  writer.write(quantise(params.gain, 100, 0, 100), 7)
  writer.write(quantise(params.attack, 1, 1, 500), 9)
  writer.write(quantise(params.release, 1, 5, 2000), 11)
  writer.write(quantise(params.gate, 100, 5, 100), 7)
  writer.write(Math.max(0, PROPAGATE_CODES.indexOf(params.propagateMode)), 2)

  writer.write(Math.max(0, FILTER_TYPES.indexOf(params.filterType)), 2)
  // Cutoff travels as its position on the log slider, not as Hz: 10 bits there is finer than
  // the ear, where 10 bits of raw Hz would be coarse down low and wasted up top.
  writer.write(Math.round(cutoffToSlider(params.cutoff) * 1023), 10)
  writer.write(quantise(params.resonance, 10, MIN_RESONANCE * 10, MAX_RESONANCE * 10), 8)

  const count = normaliseStepCount(params.steps?.length ?? DEFAULT_STEP_COUNT)
  writer.write(STEP_COUNTS.indexOf(count), 2)

  for (let i = 0; i < count; i++) {
    const step = params.steps[i] ?? { note: 60, active: false, velocity: 1 }
    writer.write(step.active ? 1 : 0, 1)
    writer.write(clamp(Math.round(step.note), MIN_NOTE, MAX_NOTE) - MIN_NOTE, 6)
    writer.write(quantise(step.velocity, 15, 0, 15), 4)
  }
}

function readOsc(reader: BitReader): OscParams {
  const waveform = WAVEFORM_CODES[reader.read(4)] ?? 'square'
  const pulseWidth = reader.read(7) / 100
  const division = DIVISION_CODES[reader.read(2)] ?? '1/8'
  const gain = reader.read(7) / 100
  const attack = reader.read(9)
  const release = reader.read(11)
  const gate = reader.read(7) / 100
  const propagateMode = PROPAGATE_CODES[reader.read(2)] ?? 'onEnd'

  const filterType = FILTER_TYPES[reader.read(2)] ?? 'off'
  const cutoff = sliderToCutoff(reader.read(10) / 1023)
  const resonance = reader.read(8) / 10

  const count = STEP_COUNTS[reader.read(2)] ?? DEFAULT_STEP_COUNT

  const steps = []
  for (let i = 0; i < count; i++) {
    const active = reader.read(1) === 1
    const note = reader.read(6) + MIN_NOTE
    const velocity = reader.read(4) / 15
    steps.push({ note, active, velocity })
  }

  return {
    waveform,
    pulseWidth,
    steps,
    division,
    gain,
    attack,
    release,
    gate,
    filterType,
    cutoff,
    resonance,
    propagateMode,
  }
}

export function encodePatch(patch: Patch): string {
  const writer = new BitWriter()

  writer.write(CODE_VERSION, 4)
  writer.write(clamp(Math.round(patch.bpm), MIN_BPM, MAX_BPM) - MIN_BPM, 10)
  writer.write(patch.loop ? 1 : 0, 1)

  const nodes = patch.nodes.filter((n) => (NODE_TYPES as readonly string[]).includes(n.type))
  writer.writeVarint(nodes.length)

  for (const node of nodes) {
    writer.write((NODE_TYPES as readonly string[]).indexOf(node.type), 3)
    writer.writeSignedVarint(Math.round(node.position.x / POSITION_GRID))
    writer.writeSignedVarint(Math.round(node.position.y / POSITION_GRID))

    if (node.type === 'osc') {
      writeOsc(writer, node.params as OscParams)
    } else if (node.type === 'delay') {
      const { delayMs } = { ...defaultDelayParams(), ...(node.params as DelayParams) }
      writer.write(quantise(delayMs / 10, 1, MIN_DELAY_MS / 10, MAX_DELAY_MS / 10), 9)
    }
  }

  // Edges address nodes by their position in the list above, so the ids never travel.
  const indexOf = new Map(nodes.map((n, i) => [n.id, i]))
  const edges = patch.edges.filter((e) => indexOf.has(e.source) && indexOf.has(e.target))
  writer.writeVarint(edges.length)

  const bits = indexBitsFor(nodes.length)
  for (const edge of edges) {
    writer.write(indexOf.get(edge.source) as number, bits)
    writer.write(indexOf.get(edge.target) as number, bits)
  }

  return toBase64Url(writer.finish())
}

/** Never throws: a malformed or truncated code is simply not a patch. */
export function decodePatch(code: string): Patch | null {
  try {
    const reader = new BitReader(fromBase64Url(code.trim()))

    if (reader.read(4) !== CODE_VERSION) return null
    const bpm = reader.read(10) + MIN_BPM
    const loop = reader.read(1) === 1

    const nodeCount = reader.readVarint()
    if (nodeCount > 5000) return null

    const nodes: PatchNode[] = []
    for (let i = 0; i < nodeCount; i++) {
      const type = NODE_TYPES[reader.read(3)]
      if (!type) return null
      const x = reader.readSignedVarint() * POSITION_GRID
      const y = reader.readSignedVarint() * POSITION_GRID

      let params: PatchNode['params'] = {}
      if (type === 'osc') {
        params = readOsc(reader)
      } else if (type === 'delay') {
        params = { delayMs: reader.read(9) * 10 }
      }

      nodes.push({ id: `n${i}`, type, position: { x, y }, params })
    }

    const edgeCount = reader.readVarint()
    if (edgeCount > 20000) return null

    const bits = indexBitsFor(nodes.length)
    const edges: PatchEdge[] = []
    for (let i = 0; i < edgeCount; i++) {
      const source = reader.read(bits)
      const target = reader.read(bits)
      if (source >= nodes.length || target >= nodes.length) return null
      edges.push({
        id: `e${i}`,
        kind: 'event',
        source: nodes[source].id,
        target: nodes[target].id,
      })
    }

    return { version: 1, bpm, loop, nodes, edges }
  } catch {
    return null
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(code: string): Uint8Array {
  const base64 = code.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
