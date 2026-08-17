import { useCallback, useEffect, useState } from 'react'
import { MAX_VOICES } from '../audio/engine'
import { engine, panic, play, stop } from '../audio/runtime'
import { exportPatch, importPatch } from '../state/persistence'
import { toPatch, usePatchStore } from '../state/patchStore'

/** Voice counter: makes the budget degradation visible (PLAN.md §2.2). */
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
  const loadPatch = usePatchStore((s) => s.loadPatch)
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
    <header className="transport">
      <div className="brand">CASTILLÓN</div>

      <button type="button" className={`btn primary${playing ? ' on' : ''}`} onClick={toggle}>
        {playing ? '■ STOP' : '▶ PLAY'}
      </button>
      <button type="button" className="btn" onClick={panic} title="Cut every voice">
        PANIC
      </button>

      <label className="field">
        <span>BPM</span>
        <input
          type="number"
          min={20}
          max={300}
          value={bpm}
          onChange={(e) => setBpm(Number(e.target.value))}
        />
      </label>

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
      <button type="button" className="btn" onClick={() => exportPatch(toPatch())}>
        EXPORT
      </button>
      <button
        type="button"
        className="btn"
        onClick={async () => {
          const patch = await importPatch()
          if (patch) loadPatch(patch)
        }}
      >
        IMPORT
      </button>
    </header>
  )
}
