import { useCallback, useEffect, useRef, useState } from 'react'
import { gallery, galleryIsShared } from '../gallery/client'
import { countryOf, relativeAge } from '../gallery/format'
import type { GalleryEntry, GallerySort } from '../gallery/types'
import { decodePatch } from '../state/patchCode'
import { usePatchStore } from '../state/patchStore'
import { shortCodeFor } from '../state/shortCode'
import { CascadeThumb } from './CascadeThumb'
import { StarIcon } from './StarIcon'

/**
 * The gallery, as a window over the app rather than a page of its own.
 *
 * That was a deliberate choice (PLAN §12.5) and it buys more than saving a router: from a window laid
 * over the canvas, choosing a patch loads it into the canvas already underneath. A separate page
 * would have had to navigate back and hand the patch over somehow.
 *
 * Sorted by most recent unless asked otherwise, because a popularity ranking that is the default
 * ossifies: whatever went up first collects the stars and nothing new is ever seen (§12.7).
 */

export function Gallery({ onClose }: { onClose: () => void }) {
  const [sort, setSort] = useState<GallerySort>('recent')
  const [page, setPage] = useState(0)
  /*
   * The reading and the moment it was taken, together. Ages are shown relative to now, and reading
   * the clock during render makes them shift on any repaint for no reason the viewer can see — so the
   * clock is read once, when the list arrives, and the labels stay put until it is fetched again.
   */
  const [loaded, setLoaded] = useState<{
    entries: GalleryEntry[]
    hasMore: boolean
    at: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadPatch = usePatchStore((s) => s.loadPatch)
  const closer = useRef<HTMLButtonElement>(null)

  const refresh = useCallback(async (order: GallerySort) => {
    try {
      const page = await gallery.list(order, 0)
      setLoaded({ ...page, at: Date.now() })
    } catch {
      setError('The gallery could not be reached.')
      setLoaded({ entries: [], hasMore: false, at: Date.now() })
    }
  }, [])

  /**
   * Appends the next page rather than replacing what is on screen.
   *
   * The clock is not re-read, so the ages already showing do not jump while a page is added under
   * them — the reading and the moment it was taken stay one thing.
   */
  const more = useCallback(async (order: GallerySort, after: number) => {
    try {
      const page = await gallery.list(order, after + 1)
      setLoaded((current) =>
        current
          ? { ...current, entries: [...current.entries, ...page.entries], hasMore: page.hasMore }
          : current,
      )
      setPage(after + 1)
    } catch {
      setError('There was no answer for the next page.')
    }
  }, [])

  useEffect(() => {
    // A remote gallery is an external system, which is the one case an effect is for. The rule cannot
    // tell that from a state update the render could have derived, and the fetch on mount has to
    // happen somewhere.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh(sort)
  }, [refresh, sort])

  // Escape closes it, which is what every window over a page is expected to do.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    closer.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function toggleStar(entry: GalleryEntry): Promise<void> {
    try {
      const updated = await gallery.star(entry.id)
      setLoaded((current) =>
        current
          ? {
              ...current,
              entries: current.entries.map((item) => (item.id === updated.id ? updated : item)),
            }
          : current,
      )
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'That star did not stick.')
    }
  }

  async function withdraw(entry: GalleryEntry): Promise<void> {
    // This one stays. The die and Reset lost their confirmations because undo can answer for them;
    // withdrawing deletes a row on a server, which nothing here can put back.
    if (!confirm(`Withdraw “${entry.name}” from the gallery?`)) return
    try {
      await gallery.remove(entry.id)
      await refresh(sort)
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'That entry could not be withdrawn.')
    }
  }

  function open(entry: GalleryEntry): void {
    const patch = decodePatch(entry.code)
    if (!patch) {
      setError('That patch could not be read. Its code may be from a newer version.')
      return
    }
    loadPatch(patch)
    onClose()
  }

  return (
    // The backdrop closes on a click, but only its own: a click that started on a card must not.
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal gallery"
        role="dialog"
        aria-modal="true"
        aria-label="Patch gallery"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="gallery-head">
          <h2>GALLERY</h2>
          <div className="gallery-sort">
            {(['recent', 'popular'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={`btn${sort === option ? ' on' : ''}`}
                onClick={() => {
                  setPage(0)
                  setSort(option)
                }}
              >
                {option === 'recent' ? 'RECENT' : 'POPULAR'}
              </button>
            ))}
          </div>
          <button ref={closer} type="button" className="btn" onClick={onClose}>
            CLOSE
          </button>
        </header>

        {!galleryIsShared && (
          <p className="gallery-note">
            Nothing is shared yet: these are the patches you have published from this browser.
          </p>
        )}
        {error && (
          <p className="gallery-note" role="status">
            {error}
          </p>
        )}

        {loaded === null ? (
          <p className="gallery-note">Loading…</p>
        ) : loaded.entries.length === 0 ? (
          <p className="gallery-note">
            No patches here yet. Publish one with SHARE, beside the patch code.
          </p>
        ) : (
          <ul className="gallery-grid">
            {loaded.entries.map((entry) => (
              <li key={entry.id} className="card">
                <button
                  type="button"
                  className="card-open"
                  onClick={() => open(entry)}
                  title="Load this patch"
                >
                  <CascadeThumb
                    patch={
                      decodePatch(entry.code) ?? {
                        version: 1,
                        bpm: 120,
                        loop: true,
                        nodes: [],
                        edges: [],
                      }
                    }
                  />
                </button>
                <div className="card-body">
                  <span className="card-name">{entry.name}</span>
                  <span className="card-meta">
                    {entry.author}
                    {countryOf(entry.country) && ` · ${countryOf(entry.country)}`} ·{' '}
                    {relativeAge(entry.createdAt, loaded.at)}
                  </span>
                  <span className="card-code">{shortCodeFor(entry.code)}</span>
                </div>
                <div className="card-actions">
                  <button
                    type="button"
                    className={`btn btn-icon star${entry.starred ? ' on' : ''}`}
                    onClick={() => void toggleStar(entry)}
                    aria-label={entry.starred ? 'Remove star' : 'Give a star'}
                    aria-pressed={entry.starred}
                  >
                    <StarIcon filled={entry.starred} />
                  </button>
                  <span className="card-stars">{entry.stars}</span>
                  {entry.mine && (
                    <button
                      type="button"
                      className="btn btn-icon"
                      onClick={() => void withdraw(entry)}
                      aria-label="Withdraw this patch"
                      title="Withdraw this patch"
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {loaded?.hasMore && (
          <div className="gallery-more">
            <button type="button" className="btn" onClick={() => void more(sort, page)}>
              MORE
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Flat, and only ever shown on an entry this browser published within the day (§12.6). */
function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M 3.5 5.5 H 16.5" />
        <path d="M 5.5 5.5 L 6.5 17 H 13.5 L 14.5 5.5" />
        <path d="M 7.5 5.5 V 3.2 H 12.5 V 5.5" />
      </g>
    </svg>
  )
}
