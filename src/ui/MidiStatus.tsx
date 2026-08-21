import { useMidiStore } from '../input/midiStore'
import type { MidiState } from '../input/midi'

/**
 * A five-pin DIN socket, which is what MIDI has looked like since 1983 and reads faster than the word.
 *
 * Outlined rather than filled, like the star: this is chrome, and the fluorescent ramp belongs to
 * cascade depth.
 */
function MidiIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {/* The five pins in their real arrangement: three across the top, two below and outside. */}
      {[
        [10, 5.4],
        [5.6, 7.4],
        [14.4, 7.4],
        [7, 11.8],
        [13, 11.8],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.15" fill="currentColor" />
      ))}
    </svg>
  )
}

/**
 * What each state has to say for itself.
 *
 * Five rather than a lit/unlit pair, because saying "no device connected" to somebody whose browser
 * cannot do MIDI at all, or who has not been asked yet, sends them looking for a cable that would not
 * have helped. The distinction costs a string each.
 */
const TITLES: Record<MidiState, string> = {
  unsupported: 'This browser has no MIDI support',
  idle: 'Click to connect a MIDI device',
  denied: 'MIDI access refused — allow it in the browser to play from a keyboard',
  empty: 'MIDI device not connected',
  connected: 'MIDI connected',
}

/**
 * Whether MIDI is there, beside the load meter.
 *
 * State rather than a control, which is why it sits with the meter and not in the transport: §13.3's
 * rule is that the transport holds only what is touched while playing. It is clickable in one state
 * only — asking for access, which cannot happen on load without an unprompted permission dialog.
 */
export function MidiStatus() {
  const state = useMidiStore((s) => s.state)
  const devices = useMidiStore((s) => s.devices.join(', '))
  const connect = useMidiStore((s) => s.connect)

  const askable = state === 'idle' || state === 'denied'
  // The port's own name once there is one: it says *which* keyboard, which is the difference between
  // believing it works and knowing.
  const title = state === 'connected' && devices ? `MIDI: ${devices}` : TITLES[state]

  return (
    <button
      type="button"
      className={`midi-status${state === 'connected' ? ' on' : ''}`}
      onClick={askable ? connect : undefined}
      // Unclickable states are still hoverable, which is the whole point of the greyed icon.
      aria-disabled={!askable}
      title={title}
      aria-label={title}
    >
      <MidiIcon />
    </button>
  )
}
