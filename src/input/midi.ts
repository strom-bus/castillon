/**
 * MIDI as a trigger source, beside the keyboard.
 *
 * A second *caller*, not a second implementation. The trigger layer (§17.3) takes a press and a release
 * against an identity, so all this does is turn note messages into `midi:60` and hand them over — the
 * Ignite's hold or toggle behaviour, the rate limiting, the cascade, none of it knows MIDI exists. That
 * was the whole point of building it that way before there was anything to plug in.
 *
 * Channel is deliberately ignored. An identity is the note and nothing else, so a key plays the same
 * Ignite whichever channel the controller happens to be set to — which is a setting most people never
 * look at and would only produce a keyboard that mysteriously stopped working.
 */

export const MIDI_SOURCE = 'midi'

/** The identity a note answers to, matching what `bindingKey` builds from a stored binding. */
export function midiIdentity(note: number): string {
  return `${MIDI_SOURCE}:${note}`
}

/**
 * How far MIDI has got, which is what the interface has to show.
 *
 * Five states rather than a lit/unlit pair, because they need different things said about them and
 * saying the wrong one is worse than saying nothing. A browser that cannot do MIDI at all, a browser
 * that has not been asked yet, one that was asked and refused, access granted with nothing plugged in,
 * and something actually there.
 */
export type MidiState = 'unsupported' | 'idle' | 'denied' | 'empty' | 'connected'

export interface MidiStatus {
  state: MidiState
  /** Port names, so a connected device can say which one it is rather than merely that it is there. */
  devices: string[]
}

export interface MidiHandlers {
  press(identity: string): void
  release(identity: string): void
}

/** Whether this browser has Web MIDI at all. Absent on Safari and behind a flag on Firefox. */
export function midiSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function'
}

type Message = ArrayLike<number>

/**
 * What a MIDI message means for the trigger layer, or null if it means nothing here.
 *
 * The quirk worth knowing: a **note-on with velocity zero is a release**. Plenty of hardware never
 * sends note-off at all and says it this way instead, so reading only 0x80 would leave notes held
 * down for ever — and an Ignite held for ever is a cascade that never stops.
 *
 * Everything else is ignored on purpose: control changes, pitch bend, clock, sysex. Triggering is what
 * this is for, and a knob arriving as a trigger would fire cascades by accident.
 */
export function triggerFor(data: Message): { identity: string; press: boolean } | null {
  if (data.length < 3) return null
  const command = data[0] & 0xf0

  if (command === 0x90) return { identity: midiIdentity(data[1]), press: data[2] > 0 }
  if (command === 0x80) return { identity: midiIdentity(data[1]), press: false }
  return null
}

/** Whether access has already been granted, so a returning visitor is not asked again. */
async function alreadyGranted(): Promise<boolean> {
  try {
    // Not every browser knows this permission name, and querying an unknown one throws.
    const status = await navigator.permissions.query({ name: 'midi' as PermissionName })
    return status.state === 'granted'
  } catch {
    return false
  }
}

export interface MidiOptions {
  handlers: MidiHandlers
  onStatus(status: MidiStatus): void
  /**
   * Whether to ask for access even if it has not been granted before.
   *
   * False on load: `requestMIDIAccess` shows a permission prompt, and one that appears unasked for on
   * a page nobody has touched yet is the kind of thing people refuse on principle. So the interface
   * offers a button, and this is true when they press it.
   */
  prompt?: boolean
}

/**
 * Starts listening. Returns a teardown.
 *
 * Idempotent in effect: calling it again with `prompt` after a refusal simply asks again, which is what
 * pressing the button a second time should do.
 */
export async function listenToMidi({
  handlers,
  onStatus,
  prompt = false,
}: MidiOptions): Promise<() => void> {
  if (!midiSupported()) {
    onStatus({ state: 'unsupported', devices: [] })
    return () => {}
  }

  if (!prompt && !(await alreadyGranted())) {
    onStatus({ state: 'idle', devices: [] })
    return () => {}
  }

  let access: MIDIAccess
  try {
    access = await navigator.requestMIDIAccess()
  } catch {
    onStatus({ state: 'denied', devices: [] })
    return () => {}
  }

  /**
   * Notes currently down, so they can be let go of if the device leaves.
   *
   * Unplugging a controller mid-note sends no note-off, so without this the Ignite it was holding
   * would sound for ever. The same hazard the keyboard has when the window loses focus, and the same
   * answer.
   */
  const held = new Set<string>()

  function onMessage(event: MIDIMessageEvent) {
    const trigger = event.data && triggerFor(event.data)
    if (!trigger) return

    if (trigger.press) {
      held.add(trigger.identity)
      handlers.press(trigger.identity)
    } else if (held.delete(trigger.identity)) {
      handlers.release(trigger.identity)
    }
  }

  function releaseAll() {
    for (const identity of [...held]) {
      held.delete(identity)
      handlers.release(identity)
    }
  }

  function attach() {
    const devices: string[] = []
    for (const input of access.inputs.values()) {
      input.onmidimessage = onMessage
      devices.push(input.name ?? 'MIDI device')
    }
    onStatus({ state: devices.length > 0 ? 'connected' : 'empty', devices })
  }

  // Ports come and go, and one plugged in after the page loaded has to work without a reload.
  access.onstatechange = () => {
    releaseAll()
    attach()
  }
  attach()

  return () => {
    access.onstatechange = null
    for (const input of access.inputs.values()) input.onmidimessage = null
    releaseAll()
  }
}
