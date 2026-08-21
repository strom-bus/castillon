import { describe, expect, it, vi } from 'vitest'
import { bindingKey } from '../types/patch'
import { listenToMidi, midiIdentity, midiSupported, triggerFor } from './midi'

/**
 * MIDI as a trigger source: turning note messages into the identities the Ignites already answer to.
 *
 * Almost all of the risk is in `triggerFor`, which is why it is a pure function over three bytes. The
 * rest is bookkeeping — attaching handlers, watching for a device arriving or leaving — and the one
 * part of that worth testing is what happens to a note that was held when the cable came out.
 */

const noteOn = (note: number, velocity = 100, channel = 0) =>
  Uint8Array.of(0x90 | channel, note, velocity)
const noteOff = (note: number, channel = 0) => Uint8Array.of(0x80 | channel, note, 0)

describe('triggerFor', () => {
  it('reads a note-on as a press', () => {
    expect(triggerFor(noteOn(60))).toEqual({ identity: 'midi:60', press: true })
  })

  it('reads a note-off as a release', () => {
    expect(triggerFor(noteOff(60))).toEqual({ identity: 'midi:60', press: false })
  })

  it('reads a note-on at velocity zero as a release, which is how much hardware says it', () => {
    // Plenty of controllers never send note-off at all. Reading only 0x80 would leave notes held for
    // ever — and an Ignite held for ever is a cascade that never stops.
    expect(triggerFor(noteOn(60, 0))).toEqual({ identity: 'midi:60', press: false })
  })

  it('ignores the channel, so a key plays the same Ignite whatever the device is set to', () => {
    // A setting most people never look at, and one that would otherwise produce a keyboard that had
    // mysteriously stopped working.
    for (const channel of [0, 5, 15]) {
      expect(triggerFor(noteOn(60, 100, channel))?.identity).toBe('midi:60')
    }
  })

  it('ignores everything that is not a note', () => {
    // A knob arriving as a trigger would fire cascades by accident.
    const control = Uint8Array.of(0xb0, 74, 64)
    const bend = Uint8Array.of(0xe0, 0, 64)
    const clock = Uint8Array.of(0xf8, 0, 0)
    for (const message of [control, bend, clock]) expect(triggerFor(message)).toBeNull()
  })

  it('ignores a message too short to mean anything', () => {
    expect(triggerFor(Uint8Array.of(0x90))).toBeNull()
    expect(triggerFor(Uint8Array.of())).toBeNull()
  })
})

describe('the identity', () => {
  it('is the same string a stored binding builds', () => {
    // The contract with the trigger layer, and the reason MIDI needed no changes there: an Ignite
    // matches on this string and has no idea what produced it.
    expect(midiIdentity(60)).toBe(bindingKey({ source: 'midi', code: '60' }))
  })
})

/** A `MIDIAccess` that can be handed ports and taken apart again. */
function fakeAccess(names: string[]) {
  const inputs = new Map(
    names.map((name, i) => [String(i), { name, onmidimessage: null } as unknown as MIDIInput]),
  )
  const access = { inputs, onstatechange: null } as unknown as MIDIAccess
  return {
    access,
    send(message: Uint8Array) {
      for (const input of inputs.values()) {
        ;(input.onmidimessage as ((e: { data: Uint8Array }) => void) | null)?.({ data: message })
      }
    },
    unplug() {
      inputs.clear()
      ;(access.onstatechange as (() => void) | null)?.()
    },
  }
}

function withMidi(names: string[]) {
  const fake = fakeAccess(names)
  const original = navigator.requestMIDIAccess
  Object.defineProperty(navigator, 'requestMIDIAccess', {
    configurable: true,
    value: () => Promise.resolve(fake.access),
  })
  return {
    fake,
    restore() {
      if (original)
        Object.defineProperty(navigator, 'requestMIDIAccess', {
          configurable: true,
          value: original,
        })
      else Reflect.deleteProperty(navigator, 'requestMIDIAccess')
    },
  }
}

describe('listenToMidi', () => {
  it('reports what browsers without Web MIDI can do, which is nothing', () => {
    // jsdom is one of them, which is the honest default here.
    expect(midiSupported()).toBe(false)
  })

  it('does not ask for permission unless asked to', async () => {
    const request = vi.fn()
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: request })
    const status = vi.fn()

    await listenToMidi({ handlers: { press() {}, release() {} }, onStatus: status })

    // A permission dialog on a page nobody has touched is one people refuse on principle.
    expect(request).not.toHaveBeenCalled()
    expect(status).toHaveBeenCalledWith({ state: 'idle', devices: [] })
    Reflect.deleteProperty(navigator, 'requestMIDIAccess')
  })

  it('names the ports it found, so a connection can be believed', async () => {
    const midi = withMidi(['Arturia KeyStep 32'])
    const status = vi.fn()
    const stop = await listenToMidi({
      handlers: { press() {}, release() {} },
      onStatus: status,
      prompt: true,
    })

    expect(status).toHaveBeenLastCalledWith({
      state: 'connected',
      devices: ['Arturia KeyStep 32'],
    })
    stop()
    midi.restore()
  })

  it('says it is empty rather than connected when there is nothing plugged in', async () => {
    const midi = withMidi([])
    const status = vi.fn()
    const stop = await listenToMidi({
      handlers: { press() {}, release() {} },
      onStatus: status,
      prompt: true,
    })
    expect(status).toHaveBeenLastCalledWith({ state: 'empty', devices: [] })
    stop()
    midi.restore()
  })

  it('passes notes through as presses and releases', async () => {
    const midi = withMidi(['KeyStep'])
    const pressed: string[] = []
    const released: string[] = []
    const stop = await listenToMidi({
      handlers: { press: (i) => pressed.push(i), release: (i) => released.push(i) },
      onStatus: () => {},
      prompt: true,
    })

    midi.fake.send(noteOn(60))
    midi.fake.send(noteOff(60))
    expect(pressed).toEqual(['midi:60'])
    expect(released).toEqual(['midi:60'])
    stop()
    midi.restore()
  })

  it('releases a note that was held when the cable came out', async () => {
    // Unplugging mid-note sends no note-off, so without this the Ignite it was holding would sound for
    // ever. The same hazard the keyboard has when the window loses focus, and the same answer.
    const midi = withMidi(['KeyStep'])
    const released: string[] = []
    const stop = await listenToMidi({
      handlers: { press() {}, release: (i) => released.push(i) },
      onStatus: () => {},
      prompt: true,
    })

    midi.fake.send(noteOn(60))
    expect(released).toEqual([])
    midi.fake.unplug()
    expect(released).toEqual(['midi:60'])
    stop()
    midi.restore()
  })

  it('releases what is held when it is torn down', async () => {
    const midi = withMidi(['KeyStep'])
    const released: string[] = []
    const stop = await listenToMidi({
      handlers: { press() {}, release: (i) => released.push(i) },
      onStatus: () => {},
      prompt: true,
    })

    midi.fake.send(noteOn(64))
    stop()
    expect(released).toEqual(['midi:64'])
    midi.restore()
  })

  it('does not release a note it never saw pressed', async () => {
    // A note-off arriving alone — from a device that was already playing when the page loaded — must
    // not stop an Ignite that a *key* is holding.
    const midi = withMidi(['KeyStep'])
    const released: string[] = []
    const stop = await listenToMidi({
      handlers: { press() {}, release: (i) => released.push(i) },
      onStatus: () => {},
      prompt: true,
    })

    midi.fake.send(noteOff(60))
    expect(released).toEqual([])
    stop()
    midi.restore()
  })
})
