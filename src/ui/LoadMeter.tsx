import { useEffect, useState } from 'react'
import { LAYER_THRESHOLD, MAX_LOAD } from '../audio/load'
import { engine } from '../audio/runtime'

/**
 * What the patch costs to run, as a share of the budget.
 *
 * Two segments rather than one number, because the interesting part is the split: effects are paid
 * for the whole time they exist, so a rack of them is spent before a note is played. Seeing that
 * standing cost is what explains why a heavy patch stops layering early — and why an unwired reverb
 * is worth deleting.
 *
 * It sits in the canvas opposite the palette, which is the pairing: on the left what you can add, on
 * the right what it costs. Nothing about it belongs to the transport — effects are charged whether
 * or not anything is playing, so it watches on its own rather than being told when to look.
 */
export function LoadMeter() {
  const [load, setLoad] = useState({ voices: 0, effects: 0 })

  /*
   * Ten times a second, and only a state change when the reading actually moved.
   *
   * It used to poll on every animation frame and set state each time, so React re-rendered this
   * sixty times a second for as long as the tab was open — with the transport stopped and nothing
   * to show. On a page whose real job is keeping an audio scheduler fed, that is the wrong thing to
   * spend frames on. Ten hertz is imperceptible on a bar this size, and the equality check means a
   * patch sitting still costs nothing at all.
   */
  useEffect(() => {
    const timer = setInterval(() => {
      const next = { voices: engine.voiceLoadAt(engine.now()), effects: engine.effectLoad() }
      setLoad((current) =>
        current.voices === next.voices && current.effects === next.effects ? current : next,
      )
    }, 100)
    return () => clearInterval(timer)
  }, [])

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
