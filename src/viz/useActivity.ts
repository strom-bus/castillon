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

export function useEdgeActivity(id: string): boolean {
  const [active, setActive] = useState(false)

  useEffect(() => {
    let timer: number | undefined
    const unsubscribe = activity.subscribe(edgeKey(id), (event) => {
      setActive(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setActive(false), event.duration * 1000)
    })
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [id])

  return active
}
