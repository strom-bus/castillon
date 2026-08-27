import { useEffect, useRef, useState } from 'react'
import { gallery } from '../gallery/client'
import { MAX_AUTHOR_LENGTH, MAX_NAME_LENGTH } from '../gallery/types'
import { useGalleryWindow } from '../gallery/window'

/**
 * Publishing a patch to the gallery: a name for it, and a nickname for you.
 *
 * The country is not asked for and not mentioned. It comes from the request, which is the only place
 * it can honestly come from, and a form is not where infrastructure gets explained — the two letters
 * on the card say everything a reader needs. What the app keeps belongs somewhere durable, not in a
 * dialog nobody rereads.
 *
 * The nickname is remembered, because typing it again every time is a chore and it is not a secret.
 * The patch name is not: it belongs to the patch, not to the person.
 *
 * Publishing opens the gallery rather than reporting success and closing. Seeing the patch on the
 * wall, with its own drawing and the means to withdraw it beside it, says more than a sentence
 * claiming it worked — and it saves reopening the window to check.
 */

const NICKNAME_KEY = 'castillon.gallery.nickname'

export function SharePatch({ code, onClose }: { code: string; onClose: () => void }) {
  const [name, setName] = useState('')
  const [author, setAuthor] = useState(() => localStorage.getItem(NICKNAME_KEY) ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)
  const showGallery = useGalleryWindow((s) => s.show)

  useEffect(() => {
    first.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await gallery.publish({ code, name, author })
      localStorage.setItem(NICKNAME_KEY, author.trim())
      onClose()
      // On the gallery, not the presets: it cannot be empty now, and what somebody wants to see after
      // adding a thing is the thing they added.
      showGallery('gallery')
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'That could not be published.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal share"
        role="dialog"
        aria-modal="true"
        aria-label="Share this patch"
        onClick={(event) => event.stopPropagation()}
      >
        <h2>SHARE THIS PATCH</h2>

        <>
          <label className="share-field">
            <span>PATCH NAME</span>
            <input
              ref={first}
              type="text"
              value={name}
              maxLength={MAX_NAME_LENGTH}
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
          </label>

          <label className="share-field">
            <span>YOUR NICKNAME</span>
            <input
              type="text"
              value={author}
              maxLength={MAX_AUTHOR_LENGTH}
              spellCheck={false}
              onChange={(e) => setAuthor(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
          </label>

          <p className="gallery-note">Anyone can see this.</p>
          {error && (
            <p className="gallery-note" role="status">
              {error}
            </p>
          )}

          <div className="share-actions">
            <button type="button" className="btn" onClick={onClose}>
              CANCEL
            </button>
            <button type="button" className="btn primary" onClick={() => void submit()}>
              {busy ? 'PUBLISHING' : 'PUBLISH'}
            </button>
          </div>
        </>
      </div>
    </div>
  )
}
