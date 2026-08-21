/**
 * How far MIDI has got, shared between the listener and the interface.
 *
 * A store rather than component state because the listening belongs to the runtime — audio and input
 * live outside the render cycle — while what has to be *shown* belongs to a component. One owner, one
 * reader.
 */
import { create } from 'zustand'
import { listenToMidi, type MidiStatus } from './midi'

interface MidiStore extends MidiStatus {
  /** Set by the listener. */
  report(status: MidiStatus): void
  /** Asks for access, which shows the browser's prompt. Called from the interface, never on load. */
  connect(): void
}

/** Installed by the runtime, so `connect` can re-run the listener rather than owning one itself. */
let restart: (() => void) | null = null

export function onConnectRequest(handler: () => void): void {
  restart = handler
}

export const useMidiStore = create<MidiStore>((set) => ({
  state: 'idle',
  devices: [],
  report: (status) => set(status),
  connect: () => restart?.(),
}))

/** The listener, reporting into the store. Returns a teardown. */
export async function startMidi(
  handlers: Parameters<typeof listenToMidi>[0]['handlers'],
  prompt: boolean,
): Promise<() => void> {
  return listenToMidi({
    handlers,
    prompt,
    onStatus: (status) => useMidiStore.getState().report(status),
  })
}
