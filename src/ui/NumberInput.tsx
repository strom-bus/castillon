import { useState } from 'react'

/**
 * A number input you can actually type in.
 *
 * The store clamps values to their legal range, which is right — but clamping on every keystroke
 * makes a field unusable: typing the "1" of 144 becomes the minimum before you reach the 4, and
 * clearing the field to start over reads as 0 and snaps to the minimum as well. So the draft is
 * held locally while it is being edited, committed the moment it is a legal value, and clamped
 * only on blur or Enter.
 */
export function NumberInput({
  value,
  min,
  max,
  step = 1,
  ariaLabel,
  className,
  onCommit,
}: {
  value: number
  min: number
  max: number
  step?: number
  ariaLabel?: string
  className?: string
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  /**
   * Clamped here rather than left to the caller: the input advertises a range through its own
   * min and max, so emitting a value outside it would be lying. Relying on each store action to
   * clamp instead worked for tempo and quietly did not for the delay wait.
   */
  const commit = (raw: string) => {
    const parsed = Number(raw)
    const usable = raw.trim() !== '' && Number.isFinite(parsed)
    onCommit(usable ? Math.min(max, Math.max(min, parsed)) : value)
    setDraft(null)
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      aria-label={ariaLabel}
      className={className}
      value={draft ?? String(value)}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        // Arrow keys and any in-range typing take effect straight away; anything else waits, so
        // a half-typed number never becomes the live value.
        const parsed = Number(raw)
        if (raw.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max) {
          onCommit(parsed)
          setDraft(null)
        }
      }}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  )
}
