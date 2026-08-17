import { toPatch } from '../state/patchStore'
import { ActivityBus } from '../viz/activity'
import { AudioEngine } from './engine'
import { CascadeScheduler } from './scheduler'

/**
 * Instancias únicas del motor. Viven fuera de React a propósito: el audio no puede depender
 * del ciclo de render, y el store de React no debe re-renderizar en cada nota.
 */
export const engine = new AudioEngine()
export const activity = new ActivityBus(() => engine.now())
export const scheduler = new CascadeScheduler({
  engine,
  activity,
  getPatch: () => toPatch(),
})

/** Debe llamarse desde un gesto del usuario (política de autoplay del navegador). */
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

export function panic(): void {
  engine.panic()
  activity.clear()
}
