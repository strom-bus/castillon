import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { decodePatch, encodePatch } from '../state/patchCode'
import { toPatch, usePatchStore } from '../state/patchStore'
import { publishPatch, resolveShortCode, sharingAvailable } from '../state/shareService'
import { looksLikeShortCode } from '../state/shortCode'

/**
 * The patch as one string, and the field that takes one back.
 *
 * Two kinds of input, and the difference is not cosmetic. A **long code contains the patch**: it
 * decodes on the spot, works with no network, and updates as you edit. A **short code refers to
 * one**: six characters cannot hold a patch, so it has to be looked up, which means a round trip and
 * a snapshot that was fixed when somebody pressed Share.
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

  const [draft, setDraft] = useState<string | null>(null)
  const [status, setStatus] = useState<'' | 'invalid' | 'looking' | 'missing' | 'failed'>('')
  const [copied, setCopied] = useState(false)
  const [sharing, setSharing] = useState(false)
  /** Remembers which patch a short code was published for, so it can be shown as stale. */
  const [shared, setShared] = useState<{ id: string; of: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  /** Only the most recent lookup may act, or a slow one could overwrite a newer patch. */
  const lookup = useRef(0)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(timer)
  }, [copied])

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
            setStatus('')
            setDraft(null)
          })
          .catch(() => attempt === lookup.current && setStatus('failed'))
        return
      }

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

  const copy = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      // Clipboard blocked: select the text so it can be copied by hand.
      input.current?.select()
    }
  }, [])

  const share = useCallback(async () => {
    setSharing(true)
    try {
      const id = await publishPatch(code)
      setShared({ id, of: code })
      // The link is the useful thing to have on the clipboard, not the bare code.
      window.location.hash = id
      await copy(`${window.location.origin}${window.location.pathname}#${id}`)
    } catch {
      setStatus('failed')
    } finally {
      setSharing(false)
    }
  }, [code, copy])

  const stale = shared !== null && shared.of !== code

  return (
    <div className="patch-code">
      <span className="patch-code-label">PATCH CODE</span>
      <input
        ref={input}
        type="text"
        spellCheck={false}
        autoComplete="off"
        aria-label="Patch code"
        className={status === 'invalid' || status === 'missing' ? 'invalid' : undefined}
        value={draft ?? code}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => {
          setDraft(e.target.value)
          e.target.select()
        }}
        onBlur={() => {
          setDraft(null)
          setStatus('')
        }}
        title="Copy this to share the patch, or paste a patch code or a short code in to load one"
      />
      <button type="button" className="btn" onClick={() => copy(code)}>
        {copied ? 'COPIED' : 'COPY'}
      </button>

      {sharingAvailable && (
        <button
          type="button"
          className="btn"
          onClick={share}
          disabled={sharing}
          title="Publish this patch and copy a short link to it"
        >
          {sharing ? '…' : 'SHARE'}
        </button>
      )}

      {shared && (
        <span
          className={`patch-code-short${stale ? ' stale' : ''}`}
          title={
            stale
              ? 'This code is a snapshot of an earlier state — share again for the current one'
              : 'Short code for this patch'
          }
        >
          {shared.id}
        </span>
      )}
      {status === 'looking' && <span className="patch-code-note">looking up…</span>}
      {status === 'missing' && <span className="patch-code-note">no such code</span>}
      {status === 'failed' && <span className="patch-code-note">share service unreachable</span>}
    </div>
  )
}
