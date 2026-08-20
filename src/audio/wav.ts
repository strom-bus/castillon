/**
 * WAV, written by hand.
 *
 * Forty-four bytes of header and then the samples, which is why there is no encoder dependency here:
 * MP3 or AAC would mean shipping one for a format nobody needs to receive a patch in. WAV also opens
 * in every editor without a conversation.
 *
 * Sixteen-bit rather than float, for the same reason — it is what a DAW, a phone and a browser all
 * accept without asking. About 5 MB per thirty seconds in stereo.
 */

/** RIFF header, fixed size: 12 bytes of RIFF/WAVE, 24 of `fmt `, 8 of the `data` chunk header. */
const HEADER_BYTES = 44
const BITS_PER_SAMPLE = 16
/** Signed 16-bit runs to -32768, so scaling by 32767 keeps +1.0 from wrapping to silence. */
const FULL_SCALE = 32767

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}

/**
 * Interleaved 16-bit PCM with a RIFF header. Channels must be the same length; the first one sets
 * the frame count if they are not, so a short channel cannot read past its end.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array<ArrayBuffer> {
  if (channels.length === 0) throw new Error('encodeWav needs at least one channel')

  const frames = Math.min(...channels.map((channel) => channel.length))
  const blockAlign = channels.length * (BITS_PER_SAMPLE / 8)
  const dataBytes = frames * blockAlign

  const bytes = new Uint8Array(HEADER_BYTES + dataBytes)
  const view = new DataView(bytes.buffer)

  writeAscii(view, 0, 'RIFF')
  // Everything after this field, which is the whole file minus the first eight bytes.
  view.setUint32(4, HEADER_BYTES - 8 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')

  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // rest of this chunk
  view.setUint16(20, 1, true) // 1 = uncompressed PCM
  view.setUint16(22, channels.length, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // bytes per second
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, BITS_PER_SAMPLE, true)

  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = HEADER_BYTES
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of channels) {
      // Clamped, not wrapped: a sample over full scale should sound like clipping rather than
      // flipping sign, which is what an unchecked cast would do.
      const sample = Math.max(-1, Math.min(1, channel[frame]))
      view.setInt16(offset, Math.round(sample * FULL_SCALE), true)
      offset += 2
    }
  }

  return bytes
}

/** Pulls the channels out of a rendered buffer, so `encodeWav` itself needs no Web Audio. */
export function channelsOf(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
}
