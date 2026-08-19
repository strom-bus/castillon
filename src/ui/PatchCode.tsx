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
 * The short code is what is shown, because it is what anyone would want to pass on. It is derived
 * from the long code rather than issued, so it can be computed here and is correct the moment you
 * stop editing — but it only *resolves* for anybody else once the patch behind it has been
 * published. Until then it is shown dimmed, and Copy publishes before copying so that what lands on
 * the clipboard always works.
 *
 * The long code is still the thing that contains the patch, and is still what works with no network
 * at all. It is one click-run away rather than gone: five quick clicks on Copy turns on a developer
 * mode that shows it, which is how the codes committed into this repo get regenerated.
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
  const short = useMemo(() => shortCodeFor(code), [code])

  const [devMode, setDevMode] = useState(storedDevMode)
  const [draft, setDraft] = useState<string | null>(null)
  const [status, setStatus] = useState<'' | 'invalid' | 'looking' | 'missing' | 'failed'>('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  /** Long codes published this session, so a patch returned to is known to be reachable already. */
  const [published, setPublished] = useState<Set<string>>(new Set())

  const input = useRef<HTMLInputElement>(null)
  const clicks = useRef<number[]>([])
  /** Only the most recent lookup may act, or a slow one could overwrite a newer patch. */
  const lookup = useRef(0)

  // Without a service there is no short code worth showing: it could never resolve for anyone.
  const showLong = devMode || !sharingAvailable
  const shown = showLong ? code : short
  const reachable = published.has(code)

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
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      // Clipboard blocked: select the text so it can be copied by hand.
      input.current?.select()
    }
  }, [])

  const onCopy = useCallback(async () => {
    // The click-run is counted first, so the mode still turns on when copying itself is failing.
    const now = Date.now()
    clicks.current = [...clicks.current, now].filter((t) => now - t < DEV_MODE_WINDOW)
    if (clicks.current.length >= DEV_MODE_CLICKS) {
      clicks.current = []
      setDevMode((on) => !on)
      return
    }

    if (showLong) return write(code)

    if (reachable) return write(shareLink(short))

    if (busy) return
    setBusy(true)
    try {
      const id = await publishPatch(code)
      setPublished((seen) => new Set(seen).add(code))
      window.location.hash = id
      await write(shareLink(id))
      setStatus('')
    } catch {
      setStatus('failed')
    } finally {
      setBusy(false)
    }
  }, [busy, code, reachable, short, showLong, write])

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
            if (resolved) setPublished((seen) => new Set(seen).add(resolved))
            setStatus('')
            setDraft(null)
          })
          .catch(() => attempt === lookup.current && setStatus('failed'))
        return
      }

      // A long code still works whether or not it is on show: it is how a patch travels without a
      // service, and pasting one is how you get its short code.
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

  const dimmed = !showLong && !reachable

  return (
    <div className="patch-code">
      <span className="patch-code-label">{devMode ? 'PATCH CODE · DEV' : 'CODE'}</span>
      <input
        ref={input}
        type="text"
        spellCheck={false}
        autoComplete="off"
        aria-label="Patch code"
        className={[
          status === 'invalid' || status === 'missing' ? 'invalid' : '',
          dimmed ? 'unpublished' : '',
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
            : dimmed
              ? 'Copy to publish this patch and get a link that works'
              : 'Published — this code opens this patch'
        }
      />
      <button
        type="button"
        className="btn"
        onClick={onCopy}
        title={showLong ? 'Copy the patch code' : 'Publish if needed, and copy a link'}
      >
        {busy ? '…' : copied ? 'COPIED' : 'COPY'}
      </button>

      {status === 'looking' && <span className="patch-code-note">looking up…</span>}
      {status === 'missing' && <span className="patch-code-note">no such code</span>}
      {status === 'failed' && <span className="patch-code-note">share service unreachable</span>}
    </div>
  )
}

function shareLink(id: string): string {
  return `${window.location.origin}${window.location.pathname}#${id}`
}
