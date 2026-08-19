import '@xyflow/react/dist/style.css'
import './ui/styles.css'

import { useEffect } from 'react'
import { reconcile } from './audio/runtime'
import { decodePatch } from './state/patchCode'
import { loadStoredPatch, savePatch } from './state/persistence'
import { resolveShortCode, sharingAvailable } from './state/shareService'
import { looksLikeShortCode } from './state/shortCode'
import { toPatch, usePatchStore } from './state/patchStore'
import { Canvas } from './ui/Canvas'
import { Inspector } from './ui/Inspector'
import { Transport } from './ui/Transport'

const AUTOSAVE_MS = 500

export default function App() {
  const loadPatch = usePatchStore((s) => s.loadPatch)

  useEffect(() => {
    // A shared link wins over whatever this browser was last working on: someone following a link
    // means to see that patch, and their own is still in localStorage afterwards.
    const shared = window.location.hash.replace(/^#/, '')
    if (sharingAvailable && looksLikeShortCode(shared)) {
      resolveShortCode(shared)
        .then((code) => {
          const patch = code ? decodePatch(code) : null
          if (patch) loadPatch(patch)
          else {
            const stored = loadStoredPatch()
            if (stored) loadPatch(stored)
          }
        })
        .catch(() => {
          const stored = loadStoredPatch()
          if (stored) loadPatch(stored)
        })
      return
    }

    const stored = loadStoredPatch()
    if (stored) loadPatch(stored)
  }, [loadPatch])

  // The audio graph follows the patch. Unthrottled on purpose: the reconciler diffs, so a change
  // that is not about routing costs a couple of map builds and emits nothing.
  useEffect(() => usePatchStore.subscribe(reconcile), [])

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
      </header>
      <Transport />
      <div className="workspace">
        <Canvas />
        <Inspector />
      </div>
    </div>
  )
}
