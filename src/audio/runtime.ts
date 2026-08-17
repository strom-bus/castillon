import { toPatch } from '../state/patchStore'
import { ActivityBus } from '../viz/activity'
import { AudioEngine } from './engine'
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

/** Must be called from a user gesture (browser autoplay policy). */
export async function play(): Promise<void> {
  await engine.start()
  activity.start()
  scheduler.start()
}

export function stop(): void {
  scheduler.stop()
  engine.panic()
  activity.clear()
  activity.stop()
}
