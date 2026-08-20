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

/** Must be called from a user gesture (browser autoplay policy). */
export async function play(): Promise<void> {
  await engine.start()
  // The graph has to exist before the first note is scheduled into it.
  reconcile()
  activity.start()
  scheduler.start()
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
