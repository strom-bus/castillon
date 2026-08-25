import { useEffect, useState } from 'react'
import { engine } from '../audio/runtime'

/** Decibels of gain reduction below which the limiter is doing something a person could hear. */
const AUDIBLE_DB = 0.5

/** How long the light stays on after the last time the limiter was seen working. */
const HOLD_MS = 600

/**
 * Whether the output is being held back, beside the control that holds it.
 *
 * **Not on the load meter**, which was the other place it could have gone. That bar measures *work* and
 * this is about *level*, and the two are not the same question: a patch can be held back at a tenth of
 * the budget with one loud oscillator, and sit at ninety-five per cent without ever reaching the
 * limiter. Colouring the bar for this would point at the wrong fix — delete a node, when what is wanted
 * is to turn something down — and the bar already uses colour for a second fact, the layering threshold.
 * The same reasoning put the MIDI socket here rather than out on the canvas: a thing is read as
 * belonging to whatever it sits next to.
 *
 * So it sits against VOL, which is both what causes it and what cures it.
 *
 * **What it means is the limiter working, not the output breaking.** Nothing here ever clips: the master
 * runs into a limiter before the speakers, so an output past what fits is squashed rather than torn.
 * That is worth knowing anyway — a squashed mix is not the mix that was written, and nothing else on
 * screen would say so.
 */
export function ClipLight() {
  const [lit, setLit] = useState(false)

  /*
   * Twenty times a second, with a hold, because being held back is a *transient* and a poll can fall
   * between two of them.
   *
   * The limiter's own release is a tenth of a second, so anything that really overloads it stays visible
   * for longer than the gap between two looks — the setting that makes the limiter sound right is what
   * makes it observable. The hold is for the eye rather than the arithmetic: a light that came on for
   * fifty milliseconds is a light nobody sees.
   */
  useEffect(() => {
    let until = 0
    const timer = setInterval(() => {
      const now = Date.now()
      if (engine.limiting() < -AUDIBLE_DB) until = now + HOLD_MS
      setLit((current) => {
        const next = now < until
        return current === next ? current : next
      })
    }, 50)
    return () => clearInterval(timer)
  }, [])

  return (
    <span
      className={`clip-light${lit ? ' lit' : ''}`}
      title={
        lit
          ? 'The output is being held back by the limiter. Nothing is breaking, but what you are hearing is squashed — turn VOL down, or a branch.'
          : 'Lights when the output is loud enough that the limiter starts holding it back.'
      }
      aria-label="Output limiting"
    />
  )
}
