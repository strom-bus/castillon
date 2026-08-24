import { useEffect, useState } from 'react'
import { activity } from '../audio/runtime'
import { edgeKey, nodeKey } from './activity'

export interface NodeActivity {
  pulsing: boolean
  currentStep: number
  /** Bumped on every trigger, so an animation can be restarted by keying off it. */
  runId: number
  /** Seconds the current activation lasts. Drives the delay node's progress bar. */
  duration: number
}

/**
 * A node's visual state. Component-local state, not the global store: that way one note
 * repaints one node instead of the hundred others on the canvas.
 */
export function useNodeActivity(id: string): NodeActivity {
  const [pulsing, setPulsing] = useState(false)
  const [currentStep, setCurrentStep] = useState(-1)
  const [run, setRun] = useState({ id: 0, duration: 0 })

  useEffect(() => {
    let nodeTimer: number | undefined
    let stepTimer: number | undefined

    const unsubscribe = activity.subscribe(nodeKey(id), (event) => {
      if (event.kind === 'node') {
        setPulsing(true)
        setRun((previous) => ({ id: previous.id + 1, duration: event.duration }))
        window.clearTimeout(nodeTimer)
        nodeTimer = window.setTimeout(() => setPulsing(false), event.duration * 1000)
      } else if (event.kind === 'step') {
        setCurrentStep(event.step)
        window.clearTimeout(stepTimer)
        stepTimer = window.setTimeout(() => setCurrentStep(-1), event.duration * 1000)
      }
    })

    return () => {
      unsubscribe()
      window.clearTimeout(nodeTimer)
      window.clearTimeout(stepTimer)
    }
  }, [id])

  return { pulsing, currentStep, runId: run.id, duration: run.duration }
}

/**
 * Whether a cable is carrying a trigger right now, and which way it is going.
 *
 * The direction is part of the reading rather than a decoration: the same cable carries a descent and a
 * climb in any patch wired from both of the Ignite's ports, so a pulse that always ran source to target
 * would be telling the opposite of the truth half the time.
 */
export function useEdgeActivity(id: string): { active: boolean; up: boolean } {
  const [active, setActive] = useState(false)
  const [up, setUp] = useState(false)

  useEffect(() => {
    let timer: number | undefined
    const unsubscribe = activity.subscribe(edgeKey(id), (event) => {
      setActive(true)
      setUp(event.kind === 'edge' && event.up === true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setActive(false), event.duration * 1000)
    })
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [id])

  return { active, up }
}

/**
 * Whether any of several nodes is currently sounding.
 *
 * For a node whose state is a fact about somewhere else. A warp never lights up on its own — nothing
 * triggers it — so what it has to show is whether the thing it is moving is playing, and it may be
 * attached to more than one. Hooks cannot be called in a loop, so the subscriptions live in one effect
 * keyed by the joined ids.
 */
export function useAnyNodeActivity(ids: readonly string[]): boolean {
  /*
   * Which set of nodes is currently sounding, rather than whether one is.
   *
   * Storing the key instead of a boolean does two things at once. It keeps the effect from having to
   * reset anything on the way in — a synchronous setState there starts a second render for nothing —
   * and it makes a stale reading impossible: if what this is attached to changes, the key changes with
   * it and last set of nodes stops matching, so the answer goes false without anybody clearing it.
   */
  const [liveFor, setLiveFor] = useState<string | null>(null)
  // Joined, because the array is rebuilt on every render and would restart the effect each time.
  const key = ids.join('|')

  useEffect(() => {
    const watching = key ? key.split('|') : []
    if (watching.length === 0) return

    const sounding = new Set<string>()
    const timers = new Map<string, number>()

    const unsubscribes = watching.map((id) =>
      activity.subscribe(nodeKey(id), (event) => {
        if (event.kind !== 'node') return
        sounding.add(id)
        setLiveFor(key)
        window.clearTimeout(timers.get(id))
        timers.set(
          id,
          window.setTimeout(() => {
            sounding.delete(id)
            if (sounding.size === 0) setLiveFor(null)
          }, event.duration * 1000),
        )
      }),
    )

    return () => {
      for (const stop of unsubscribes) stop()
      for (const timer of timers.values()) window.clearTimeout(timer)
    }
  }, [key])

  return key !== '' && liveFor === key
}
