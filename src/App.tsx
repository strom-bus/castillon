import '@xyflow/react/dist/style.css'
import './ui/styles.css'

import { useEffect } from 'react'
import { installTriggers, reconcile, restartCascade } from './audio/runtime'
import { useGalleryWindow } from './gallery/window'
import { installHistory } from './history/patchHistory'
import { decodePatch } from './state/patchCode'
import { loadStoredPatch, savePatch } from './state/persistence'
import { resolveShortCode, sharingAvailable } from './state/shareService'
import { looksLikeShortCode } from './state/shortCode'
import { toPatch, usePatchStore } from './state/patchStore'
import { Canvas } from './ui/Canvas'
import { Gallery } from './ui/Gallery'
import { GalleryButton } from './ui/GalleryButton'
import { Inspector } from './ui/Inspector'
import { Logo } from './ui/Logo'
import { Transport } from './ui/Transport'

const AUTOSAVE_MS = 500

export default function App() {
  const galleryOpen = useGalleryWindow((s) => s.open)
  const showGallery = useGalleryWindow((s) => s.show)
  const hideGallery = useGalleryWindow((s) => s.hide)

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

  // Undo watches the patch from here on. Installed after the stored patch has loaded, so the first
  // step back reaches how the patch was found rather than an empty canvas.
  useEffect(() => installHistory(), [])

  // Bound Ignites listen from here. The keyboard is one source; MIDI would be another, and nothing
  // above this line would change (§17.3).
  useEffect(() => installTriggers(), [])

  // A replaced patch is not an edit: the cascade in flight belongs to nodes that are gone, so it is
  // silenced and seeded again rather than left to fade out while the transport still says it plays.
  useEffect(() => {
    let seen = usePatchStore.getState().patchRun
    return usePatchStore.subscribe((state) => {
      if (state.patchRun === seen) return
      seen = state.patchRun
      restartCascade()
    })
  }, [])

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
        <h1 className="brand">
          <Logo className="brand-mark" />
          <span>
            Castill<span className="brand-lit">_ÓN</span>
          </span>
        </h1>
        <GalleryButton onClick={showGallery} />
      </header>
      <Transport />
      {galleryOpen && <Gallery onClose={hideGallery} />}
      <div className="workspace">
        <Canvas />
        <Inspector />
      </div>
    </div>
  )
}
