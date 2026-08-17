/**
 * Minimal MSB-first bit stream. The patch code packs fields at their real widths — a division
 * is 2 bits, not the 8 a byte-aligned format would spend — which is where most of the size
 * saving over JSON comes from.
 */

export class BitWriter {
  private bytes: number[] = []
  private current = 0
  private used = 0

  write(value: number, bits: number): void {
    for (let i = bits - 1; i >= 0; i--) {
      this.current = (this.current << 1) | ((value >>> i) & 1)
      this.used++
      if (this.used === 8) {
        this.bytes.push(this.current)
        this.current = 0
        this.used = 0
      }
    }
  }

  /** Unsigned LEB128: small numbers cost one byte, large ones grow as needed. */
  writeVarint(value: number): void {
    let remaining = value >>> 0
    for (;;) {
      const chunk = remaining & 0x7f
      remaining = remaining >>> 7
      if (remaining === 0) {
        this.write(chunk, 8)
        return
      }
      this.write(chunk | 0x80, 8)
    }
  }

  /** Zig-zag first, so small negatives stay small. */
  writeSignedVarint(value: number): void {
    this.writeVarint((value << 1) ^ (value >> 31))
  }

  finish(): Uint8Array {
    const out = this.bytes.slice()
    if (this.used > 0) out.push(this.current << (8 - this.used))
    return Uint8Array.from(out)
  }
}

export class BitReader {
  private bytes: Uint8Array
  private position = 0

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }

  read(bits: number): number {
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

  readVarint(): number {
    let result = 0
    let shift = 0
    for (;;) {
      const byte = this.read(8)
      result |= (byte & 0x7f) << shift
      if ((byte & 0x80) === 0) return result >>> 0
      shift += 7
      if (shift > 28) throw new Error('varint too long')
    }
  }

  readSignedVarint(): number {
    const value = this.readVarint()
    return (value >>> 1) ^ -(value & 1)
  }
}
