import { useCallback, useEffect, useState } from 'react'
import { engine, play, stop } from '../audio/runtime'
import { usePatchStore } from '../state/patchStore'
import { MAX_BPM, MIN_BPM } from '../types/patch'
import { NumberInput } from './NumberInput'
import { ExportAudio } from './ExportAudio'
import { PatchCode } from './PatchCode'
import { UndoRedo } from './UndoRedo'

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
      <button type="button" className="btn" onClick={resetPatch}>
        RESET
      </button>
      <UndoRedo />

      <span className="divider" />

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

      <div className="spacer" />

      <ExportAudio />

      <span className="divider" />

      <PatchCode />
    </div>
  )
}
