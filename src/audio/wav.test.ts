import { describe, expect, it } from 'vitest'
import { encodeWav } from './wav'

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length))
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

describe('encodeWav', () => {
  const mono = () => encodeWav([new Float32Array([0, 0.5, -0.5, 1])], 48000)

  it('writes a RIFF/WAVE header a player can find its way around', () => {
    const bytes = mono()
    expect(ascii(bytes, 0, 4)).toBe('RIFF')
    expect(ascii(bytes, 8, 4)).toBe('WAVE')
    expect(ascii(bytes, 12, 4)).toBe('fmt ')
    expect(ascii(bytes, 36, 4)).toBe('data')
  })

  it('declares the size of everything after the size field, not of the file', () => {
    // The classic off-by-eight. A player that trusts it reads past the end or stops early.
    const bytes = mono()
    expect(view(bytes).getUint32(4, true)).toBe(bytes.length - 8)
  })

  it('declares uncompressed PCM at 16 bits', () => {
    const v = view(mono())
    expect(v.getUint16(20, true)).toBe(1)
    expect(v.getUint16(34, true)).toBe(16)
  })

  it('describes the frame layout consistently with the channel count', () => {
    const stereo = encodeWav([new Float32Array(4), new Float32Array(4)], 44100)
    const v = view(stereo)
    expect(v.getUint16(22, true)).toBe(2) // channels
    expect(v.getUint32(24, true)).toBe(44100) // sample rate
    expect(v.getUint16(32, true)).toBe(4) // block align: 2 channels x 2 bytes
    expect(v.getUint32(28, true)).toBe(44100 * 4) // bytes per second
  })

  it('sizes the file from the frames and the channels', () => {
    expect(mono()).toHaveLength(44 + 4 * 2)
    expect(encodeWav([new Float32Array(4), new Float32Array(4)], 44100)).toHaveLength(44 + 4 * 4)
  })

  it('scales samples so that full scale does not wrap to silence', () => {
    // 1.0 x 32768 overflows to -32768: the loudest sample would come out as the quietest.
    const v = view(mono())
    expect(v.getInt16(44, true)).toBe(0)
    expect(v.getInt16(46, true)).toBe(16384) // 0.5
    // -16383, not -16384: JS rounds a half towards positive infinity, so the negative side lands one
    // step short. Half a least-significant bit of asymmetry, about -96 dB, and not worth code.
    expect(v.getInt16(48, true)).toBe(-16383)
    expect(v.getInt16(50, true)).toBe(32767) // 1.0
  })

  it('clips rather than wrapping when a render runs hot', () => {
    const bytes = encodeWav([new Float32Array([2, -2])], 48000)
    const v = view(bytes)
    expect(v.getInt16(44, true)).toBe(32767)
    expect(v.getInt16(46, true)).toBe(-32767)
  })

  it('interleaves the channels frame by frame', () => {
    const bytes = encodeWav([new Float32Array([1, 1]), new Float32Array([-1, -1])], 48000)
    const v = view(bytes)
    expect(v.getInt16(44, true)).toBe(32767) // frame 0, left
    expect(v.getInt16(46, true)).toBe(-32767) // frame 0, right
    expect(v.getInt16(48, true)).toBe(32767) // frame 1, left
  })

  it('stops at the shortest channel rather than reading past its end', () => {
    const bytes = encodeWav([new Float32Array([1, 1, 1]), new Float32Array([1])], 48000)
    expect(bytes).toHaveLength(44 + 1 * 4)
  })

  it('refuses a buffer with no channels at all', () => {
    expect(() => encodeWav([], 48000)).toThrow()
  })
})
