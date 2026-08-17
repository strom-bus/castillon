import { useCallback, useEffect, useState } from 'react'
import { MAX_VOICES } from '../audio/engine'
import { engine, play, stop } from '../audio/runtime'
import { usePatchStore } from '../state/patchStore'
import { MAX_BPM, MIN_BPM } from '../types/patch'
import { PatchCode } from './PatchCode'

/**
 * A number field you can actually type in.
 *
 * The store clamps tempo to its legal range, which is right — but clamping on every keystroke
 * makes the field unusable: typing the "1" of 144 becomes 20 before you reach the 4, and
 * clearing the field to start over reads as 0 and snaps to 20 as well. So the draft is held
 * locally while it is being edited, committed the moment it is a legal value, and clamped only
 * on blur.
 */
function NumberField({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (raw: string) => {
    const parsed = Number(raw)
    onCommit(raw.trim() === '' || Number.isNaN(parsed) ? value : parsed)
    setDraft(null)
  }

  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={draft ?? String(value)}
        onChange={(e) => {
          const raw = e.target.value
          setDraft(raw)
          // Arrow keys and any in-range typing take effect straight away; anything else waits,
          // so a half-typed number never becomes the tempo.
          const parsed = Number(raw)
          if (raw.trim() !== '' && Number.isInteger(parsed) && parsed >= min && parsed <= max) {
            onCommit(parsed)
            setDraft(null)
          }
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
        }}
      />
    </label>
  )
}

/** Voice counter: makes the budget degradation visible rather than mysterious. */
function VoiceMeter({ playing }: { playing: boolean }) {
  const [voices, setVoices] = useState(0)

  useEffect(() => {
    if (!playing) {
      setVoices(0)
      return
    }
    let frame = 0
    const tick = () => {
      setVoices(engine.voicesAt(engine.now()))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  const ratio = voices / MAX_VOICES
  return (
    <div className="meter" title="Voices sounding / budget">
      <div className="meter-bar">
        <div
          className={`meter-fill${ratio >= 0.75 ? ' hot' : ''}`}
          style={{ width: `${Math.min(100, ratio * 100)}%` }}
        />
      </div>
      <span className="meter-label">
        {voices}/{MAX_VOICES}
      </span>
    </div>
  )
}

export function Transport() {
  const [playing, setPlaying] = useState(false)
  const bpm = usePatchStore((s) => s.bpm)
  const loop = usePatchStore((s) => s.loop)
  const masterGain = usePatchStore((s) => s.masterGain)
  const setBpm = usePatchStore((s) => s.setBpm)
  const setLoop = usePatchStore((s) => s.setLoop)
  const setMasterGain = usePatchStore((s) => s.setMasterGain)
  const resetPatch = usePatchStore((s) => s.resetPatch)

  useEffect(() => {
    engine.setMasterGain(masterGain)
  }, [masterGain])

  const toggle = useCallback(async () => {
    if (playing) {
      stop()
      setPlaying(false)
    } else {
      await play()
      setPlaying(true)
    }
  }, [playing])

  return (
    <div className="transport">
      <button type="button" className={`btn primary${playing ? ' on' : ''}`} onClick={toggle}>
        {playing ? '■ STOP' : '▶ PLAY'}
      </button>

      <NumberField label="BPM" value={bpm} min={MIN_BPM} max={MAX_BPM} onCommit={setBpm} />

      <label className="field checkbox">
        <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
        <span>LOOP</span>
      </label>

      <label className="field">
        <span>VOL</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={masterGain}
          onChange={(e) => setMasterGain(Number(e.target.value))}
        />
      </label>

      <VoiceMeter playing={playing} />

      <div className="spacer" />

      <button
        type="button"
        className="btn"
        onClick={() => {
          if (confirm('Discard the current patch and load the example again?')) resetPatch()
        }}
      >
        RESET
      </button>
      <PatchCode />
    </div>
  )
}
