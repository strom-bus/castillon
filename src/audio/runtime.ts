import { listenToKeyboard } from '../input/keyboard'
import { learning, takenForBinding } from '../input/learn'
import { onConnectRequest, startMidi } from '../input/midiStore'
import { press, release } from '../input/triggers'
import { toPatch } from '../state/patchStore'
import { ActivityBus } from '../viz/activity'
import { AudioEngine } from './engine'
import { applyOps } from './engine'
import { diff, EMPTY_GRAPH, graphOf, type AudioGraph } from './router'
import { CascadeScheduler } from './scheduler'

/**
 * The engine's single instances. They deliberately live outside React: audio cannot depend on
 * the render cycle, and the React store must not re-render on every note.
 */
export const engine = new AudioEngine()
export const activity = new ActivityBus(() => engine.now())
export const scheduler = new CascadeScheduler({
  engine,
  activity,
  getPatch: () => toPatch(),
})

/** The audio graph as last applied to Web Audio. Only the reconciler writes to it. */
let applied: AudioGraph = EMPTY_GRAPH

/**
 * Brings the live audio graph in line with the patch. Safe to call on every store change: for
 * anything that is not audio — dragging a node, editing a step, typing in the tempo — the diff is
 * empty and nothing touches the audio thread.
 */
export function reconcile(): void {
  if (!engine.started) return
  const next = graphOf(toPatch())
  applyOps(engine, diff(applied, next), next.bpm)
  applied = next
}

/** Everything that has to be true before a note can be scheduled. */
async function ready(): Promise<void> {
  await engine.start()
  // The graph has to exist before the first note is scheduled into it.
  reconcile()
  activity.start()
}

/** Must be called from a user gesture (browser autoplay policy). */
export async function play(): Promise<void> {
  await ready()
  scheduler.start()
}

/**
 * Connects an input source to the bound Ignites.
 *
 * A key press is itself a user gesture, so it may start the audio — which it has to, because a bound
 * Ignite is meant to play without anyone having pressed Play first (§17.4). The engine resolves
 * immediately once started, so only the very first press pays for it.
 */
export function installTriggers(): () => void {
  const handlers = {
    press(identity: string) {
      // A capture waiting for a binding takes it instead. The keyboard does this for itself with a
      // capture-phase listener; MIDI has no DOM event to intercept, so it asks here.
      if (takenForBinding(identity)) return
      void ready().then(() => press(toPatch(), identity, scheduler))
    },
    release(identity: string) {
      // Swallowed while a capture is open, so the note that assigned a binding cannot also stop an
      // Ignite on the way back up.
      if (learning()) return
      release(toPatch(), identity, scheduler)
    },
  }

  const stopKeyboard = listenToKeyboard(handlers)

  /**
   * MIDI is the same handlers behind a different source, which is what §17.3 was built for. It comes
   * up without prompting: `requestMIDIAccess` shows a permission dialog, and one that appears on a page
   * nobody has touched yet is the kind people refuse on principle. Granted before, it reconnects
   * silently; otherwise the interface offers a button and that is what asks.
   */
  let stopMidi: (() => void) | null = null
  let live = true

  function connectMidi(prompt: boolean) {
    stopMidi?.()
    stopMidi = null
    void startMidi(handlers, prompt).then((teardown) => {
      if (live) stopMidi = teardown
      else teardown()
    })
  }

  onConnectRequest(() => connectMidi(true))
  connectMidi(false)

  return () => {
    live = false
    stopKeyboard()
    stopMidi?.()
  }
}

/**
 * Starts the cascade over on a patch that has just been replaced wholesale.
 *
 * Order matters: silence first, then rebuild the graph, then seed. Scheduled voices carry absolute
 * audio-clock times, so without `panic` the patch that was thrown away keeps sounding for as long as
 * its longest note had left to run.
 *
 * Does nothing when stopped, so replacing a patch never starts audio on its own.
 */
export function restartCascade(): void {
  if (!scheduler.active) return
  engine.panic()
  activity.clear()
  reconcile()
  scheduler.restart()
}

export function stop(): void {
  scheduler.stop()
  engine.panic()
  activity.clear()
  activity.stop()
}
