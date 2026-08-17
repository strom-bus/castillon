import '@xyflow/react/dist/style.css'
import './ui/styles.css'

import { useEffect } from 'react'
import { loadStoredPatch, savePatch } from './state/persistence'
import { toPatch, usePatchStore } from './state/patchStore'
import { Canvas } from './ui/Canvas'
import { Inspector } from './ui/Inspector'
import { Transport } from './ui/Transport'

const AUTOSAVE_MS = 500

export default function App() {
  const loadPatch = usePatchStore((s) => s.loadPatch)

  useEffect(() => {
    const stored = loadStoredPatch()
    if (stored) loadPatch(stored)
  }, [loadPatch])

  // Debounced autosave: dragging a node fires dozens of changes per second.
  useEffect(() => {
    let timer: number | undefined
    const unsubscribe = usePatchStore.subscribe(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => savePatch(toPatch()), AUTOSAVE_MS)
    })
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [])

  return (
    <div className="app">
      <header className="titlebar">
        <h1 className="brand">Castill_ON</h1>
        <span className="brand-alt">COLMENA</span>
      </header>
      <Transport />
      <div className="workspace">
        <Canvas />
        <Inspector />
      </div>
    </div>
  )
}
