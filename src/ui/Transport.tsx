import { useCallback, useEffect, useState } from 'react'
import { LAYER_THRESHOLD, MAX_LOAD } from '../audio/load'
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

/**
 * What the patch costs to run, as a share of the budget.
 *
 * Two segments rather than one number, because the interesting part is the split: effects are paid
 * for the whole time they exist, so a rack of them is spent before a note is played. Seeing that
 * standing cost is what explains why a heavy patch stops layering early — and why an unwired reverb
 * is worth deleting.
 */
function LoadMeter({ playing }: { playing: boolean }) {
  const [load, setLoad] = useState({ voices: 0, effects: 0 })

  useEffect(() => {
    let frame = 0
    const tick = () => {
      setLoad({ voices: engine.voiceLoadAt(engine.now()), effects: engine.effectLoad() })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // Effects cost whether or not the transport is running, so this watches either way.
  }, [playing])

  const total = load.voices + load.effects
  const share = (points: number) => `${Math.min(100, (points / MAX_LOAD) * 100)}%`

  return (
    <div
      className="meter"
      title={`Effects ${load.effects.toFixed(1)} + voices ${load.voices.toFixed(1)} of ${MAX_LOAD}. Past ${LAYER_THRESHOLD * 100}% oscillators restart instead of layering.`}
    >
      <div className="meter-bar">
        <div className="meter-fill effects" style={{ width: share(load.effects) }} />
        <div
          className={`meter-fill${total >= MAX_LOAD * LAYER_THRESHOLD ? ' hot' : ''}`}
          style={{ width: share(load.voices) }}
        />
      </div>
      <span className="meter-label">{Math.round((total / MAX_LOAD) * 100)}%</span>
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

      <LoadMeter playing={playing} />

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
