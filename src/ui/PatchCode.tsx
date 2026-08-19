import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { decodePatch, encodePatch } from '../state/patchCode'
import { toPatch, usePatchStore } from '../state/patchStore'
import { publishPatch, resolveShortCode, sharingAvailable } from '../state/shareService'
import { looksLikeShortCode, shortCodeFor } from '../state/shortCode'

const DEV_MODE_KEY = 'castillon.devMode'
/** Clicks needed, and how long the run may take. Slow clicking is just copying. */
const DEV_MODE_CLICKS = 5
const DEV_MODE_WINDOW = 1500

function storedDevMode(): boolean {
  try {
    return localStorage.getItem(DEV_MODE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * The patch as a code, and the field that takes one back.
 *
 * The field holds a short code only when that code is **real and current**: generated, so the patch
 * behind it exists on the service, and still matching what is on the canvas. Editing empties it
 * rather than leaving something that looks usable, because a code shown before it exists is a code
 * somebody writes on a piece of paper.
 *
 * That is why Generate is its own button. Copy copies what is there and does nothing else — no
 * request, no new entry in the store, and the same code however many times it is pressed.
 *
 * The long code is what actually contains a patch and is what works with no network at all. Five
 * quick clicks on Copy turns on a developer mode that shows it, which is how the codes committed
 * into this repo get regenerated.
 */
export function PatchCode() {
  const nodes = usePatchStore((s) => s.nodes)
  const edges = usePatchStore((s) => s.edges)
  const bpm = usePatchStore((s) => s.bpm)
  const loop = usePatchStore((s) => s.loop)
  const loadPatch = usePatchStore((s) => s.loadPatch)

  // Built from the subscribed values rather than read straight off the store, so the memo's
  // dependencies are the real inputs and it recomputes exactly when the patch changes.
  const code = useMemo(
    () => encodePatch(toPatch({ bpm, loop, nodes, edges })),
    [nodes, edges, bpm, loop],
  )

  const [devMode, setDevMode] = useState(storedDevMode)
  const [draft, setDraft] = useState<string | null>(null)
  const [status, setStatus] = useState<'' | 'invalid' | 'looking' | 'missing' | 'failed'>('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  /**
   * Long codes known to be on the service. Keyed by the patch rather than by the moment of
   * generating, so returning to a patch already generated shows its code again instead of asking
   * for it twice — the code is derived from the content, so it cannot have changed.
   */
  const [generated, setGenerated] = useState<Set<string>>(new Set())

  const input = useRef<HTMLInputElement>(null)
  const clicks = useRef<number[]>([])
  /** Only the most recent lookup may act, or a slow one could overwrite a newer patch. */
  const lookup = useRef(0)

  // Without a service there is no short code worth showing: it could never resolve for anyone.
  const showLong = devMode || !sharingAvailable
  const ready = generated.has(code)
  const shown = showLong ? code : ready ? shortCodeFor(code) : ''

  useEffect(() => {
    try {
      localStorage.setItem(DEV_MODE_KEY, devMode ? '1' : '0')
    } catch {
      // Private browsing. The mode still works for this session.
    }
  }, [devMode])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(timer)
  }, [copied])

  const write = useCallback(async (value: string) => {
    if (value === '') return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      // Clipboard blocked: select the text so it can be copied by hand.
      input.current?.select()
    }
  }, [])

  const onCopy = useCallback(async () => {
    // The click-run is counted first, so the mode still turns on with nothing to copy and while a
    // request is in flight — which is when reaching for the long code matters most.
    const now = Date.now()
    clicks.current = [...clicks.current, now].filter((t) => now - t < DEV_MODE_WINDOW)

    if (clicks.current.length >= DEV_MODE_CLICKS) {
      clicks.current = []
      const on = !devMode
      setDevMode(on)
      // The run is a way of asking for the long code, not just of revealing it: the whole point is
      // to walk away with it, so turning the mode on copies it in the same gesture.
      if (on) await write(code)
      return
    }

    await write(shown)
  }, [code, devMode, shown, write])

  const onGenerate = useCallback(async () => {
    if (busy || ready) return
    setBusy(true)
    try {
      const id = await publishPatch(code)
      setGenerated((seen) => new Set(seen).add(code))
      // The address bar becomes a shareable link, which costs nothing and saves assembling one.
      window.location.hash = id
      setStatus('')
    } catch {
      setStatus('failed')
    } finally {
      setBusy(false)
    }
  }, [busy, code, ready])

  const onChange = useCallback(
    (value: string) => {
      setDraft(value)
      const trimmed = value.trim()
      if (trimmed === '') return setStatus('')

      if (looksLikeShortCode(trimmed) && sharingAvailable) {
        const attempt = ++lookup.current
        setStatus('looking')
        resolveShortCode(trimmed)
          .then((resolved) => {
            if (attempt !== lookup.current) return
            const patch = resolved ? decodePatch(resolved) : null
            if (!patch) return setStatus(resolved ? 'invalid' : 'missing')
            loadPatch(patch)
            // It resolved, so it is on the service: the field can show it straight away.
            if (resolved) setGenerated((seen) => new Set(seen).add(resolved))
            setStatus('')
            setDraft(null)
          })
          .catch(() => attempt === lookup.current && setStatus('failed'))
        return
      }

      // A long code still works whether or not it is on show: it is how a patch travels without a
      // service, and pasting one is how you get to a patch that was never published.
      const patch = decodePatch(trimmed)
      if (patch) {
        loadPatch(patch)
        setStatus('')
        setDraft(null)
      } else {
        setStatus('invalid')
      }
    },
    [loadPatch],
  )

  return (
    <div className="patch-code">
      <span className="patch-code-label">{devMode ? 'PATCH CODE · DEV' : 'PATCH CODE'}</span>
      <input
        ref={input}
        type="text"
        spellCheck={false}
        autoComplete="off"
        aria-label="Patch code"
        placeholder={showLong ? '' : 'generate or paste'}
        className={[
          status === 'invalid' || status === 'missing' ? 'invalid' : '',
          showLong ? 'long' : 'short',
        ]
          .filter(Boolean)
          .join(' ')}
        value={draft ?? shown}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => {
          setDraft(e.target.value)
          e.target.select()
        }}
        onBlur={() => {
          setDraft(null)
          setStatus('')
        }}
        title={
          showLong
            ? 'The whole patch as one string. Paste one in to load it.'
            : 'A code here exists and matches this patch. Paste one in to open it.'
        }
      />

      {!showLong && (
        <button
          type="button"
          className="btn"
          onClick={onGenerate}
          title={
            ready ? 'This patch already has a code' : 'Publish this patch and get a code for it'
          }
        >
          {busy ? '…' : ready ? 'GENERATED' : 'GENERATE'}
        </button>
      )}

      <button type="button" className="btn" onClick={onCopy} title="Copy what is in the field">
        {copied ? 'COPIED' : 'COPY'}
      </button>

      {status === 'looking' && <span className="patch-code-note">looking up…</span>}
      {status === 'missing' && <span className="patch-code-note">no such code</span>}
      {status === 'failed' && <span className="patch-code-note">share service unreachable</span>}
    </div>
  )
}
