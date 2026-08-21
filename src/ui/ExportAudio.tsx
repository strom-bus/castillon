import { useState } from 'react'
import { MAX_PASSES, MIN_PASSES, renderPatch } from '../audio/render'
import { channelsOf, encodeWav } from '../audio/wav'
import { encodePatch } from '../state/patchCode'
import { toPatch, usePatchStore } from '../state/patchStore'
import { shortCodeFor } from '../state/shortCode'
import { NumberInput } from './NumberInput'

/**
 * Renders the patch to a WAV file.
 *
 * Length is asked for in laps of the cascade rather than in seconds, which was the user's call and a
 * better one: a count of passes never cuts a phrase in half, and it still means the same thing after
 * a change of tempo. Where several cascades of different lengths are running, the longest one
 * governs and the shorter ones simply come round more often — the same thing that happens on
 * playback.
 *
 * The file is named after the patch's short code, so a WAV found months later can be traced back to
 * the patch that made it.
 */
export function ExportAudio() {
  const [passes, setPasses] = useState(4)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(): Promise<void> {
    // Guarded here rather than by disabling the button: a disabled control is also the one thing
    // that cannot be retried when a render hangs.
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const patch = toPatch()
      // The same string names the file and seeds the render, which is the point: a WAV found later
      // leads back to its patch, and re-rendering that patch reproduces the file.
      const code = encodePatch(patch)
      const { buffer, plan } = await renderPatch(
        patch,
        passes,
        usePatchStore.getState().masterGain,
        code,
      )
      const name = `castillon-${shortCodeFor(code)}-${plan.passes}x.wav`
      save(encodeWav(channelsOf(buffer), buffer.sampleRate), name)
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'The render failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="export">
      <button type="button" className="btn" onClick={run} title="Render the patch to a WAV file">
        {busy ? 'RENDERING' : 'EXPORT'}
      </button>
      <label className="field">
        <span>REPS</span>
        <NumberInput
          value={passes}
          min={MIN_PASSES}
          max={MAX_PASSES}
          ariaLabel="Repetitions to render"
          onCommit={setPasses}
        />
      </label>
      {error && (
        <span className="export-error" role="status">
          {error}
        </span>
      )}
    </div>
  )
}

/**
 * Hands the bytes to the browser as a download.
 *
 * The object URL is released on a timer rather than immediately: revoking it in the same turn as the
 * click cancels the download in some browsers, and the leak of waiting a second is nothing next to
 * silently producing no file.
 */
function save(bytes: Uint8Array<ArrayBuffer>, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
