import { useEffect, useState } from 'react'
import { activity } from '../audio/runtime'
import { edgeKey, nodeKey } from './activity'

/**
 * Estado visual de un nodo. Es estado local del componente, no del store global: así una nota
 * repinta un nodo y no los cien que haya en el lienzo.
 */
export function useNodeActivity(id: string): { pulsing: boolean; currentStep: number } {
  const [pulsing, setPulsing] = useState(false)
  const [currentStep, setCurrentStep] = useState(-1)

  useEffect(() => {
    let nodeTimer: number | undefined
    let stepTimer: number | undefined

    const unsubscribe = activity.subscribe(nodeKey(id), (event) => {
      if (event.kind === 'node') {
        setPulsing(true)
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

  return { pulsing, currentStep }
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
