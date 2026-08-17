import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { decodePatch, encodePatch } from '../state/patchCode'
import { toPatch, usePatchStore } from '../state/patchStore'

/**
 * The whole patch as one short string.
 *
 * Typing or pasting a valid code loads it immediately. While the field has focus it holds
 * whatever you typed, so live re-encoding of the patch never overwrites you mid-paste.
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
  const [invalid, setInvalid] = useState(false)
  const [copied, setCopied] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(timer)
  }, [copied])

  const onChange = useCallback(
    (value: string) => {
      setDraft(value)
      if (value.trim() === '') {
        setInvalid(false)
        return
      }
      const patch = decodePatch(value)
      if (patch) {
        loadPatch(patch)
        setInvalid(false)
      } else {
        setInvalid(true)
      }
    },
    [loadPatch],
  )

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      // Clipboard blocked: select the text so it can be copied by hand.
      input.current?.select()
    }
  }, [code])

  return (
    <div className="patch-code">
      <span className="patch-code-label">PATCH CODE</span>
      <input
        ref={input}
        type="text"
        spellCheck={false}
        autoComplete="off"
        className={invalid ? 'invalid' : undefined}
        value={draft ?? code}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => {
          setDraft(e.target.value)
          e.target.select()
        }}
        onBlur={() => {
          setDraft(null)
          setInvalid(false)
        }}
        title="Copy this to share the patch, or paste one in to load it"
      />
      <button type="button" className="btn" onClick={copy}>
        {copied ? 'COPIED' : 'COPY'}
      </button>
    </div>
  )
}
