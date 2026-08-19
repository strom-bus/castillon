import { useCallback, useEffect, useState } from 'react'
import { MAX_VOICES } from '../audio/engine'
import { engine, play, stop } from '../audio/runtime'
import { usePatchStore } from '../state/patchStore'
import { MAX_BPM, MIN_BPM } from '../types/patch'
import { NumberInput } from './NumberInput'
import { PatchCode } from './PatchCode'

/** Flat, five pips, drawn rather than fetched — there is no asset pipeline here and no need for one. */
function DiceIcon() {
  const pips = [
    [5, 5],
    [15, 5],
    [10, 10],
    [5, 15],
    [15, 15],
  ]
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect
        x="1"
        y="1"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {pips.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" fill="currentColor" />
      ))}
    </svg>
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
  const randomisePatch = usePatchStore((s) => s.randomisePatch)

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

      <label className="field">
        <span>BPM</span>
        <NumberInput value={bpm} min={MIN_BPM} max={MAX_BPM} onCommit={setBpm} />
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
        className="btn btn-icon"
        onClick={() => {
          if (confirm('Discard the current patch and roll a new one?')) randomisePatch()
        }}
        aria-label="Random patch"
        title="Roll a random patch"
      >
        <DiceIcon />
      </button>
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
