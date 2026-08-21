/**
 * Intercepting a press so a binding can be assigned by playing it.
 *
 * The keyboard does this with a capture-phase listener: the capture takes the keystroke before the
 * shortcuts and the bound Ignites see it, so assigning a key does not also fire whatever is already on
 * it. MIDI has no DOM event to intercept, so it needs the same idea one layer in — the runtime asks
 * here first, and hands the press over instead of passing it on.
 *
 * A module-level slot rather than a store: there is exactly one capture listening at a time, and the
 * runtime has to be able to ask synchronously while a note arrives.
 */

let listener: ((identity: string) => void) | null = null

/** Starts intercepting, or stops when given null. Returns nothing: the caller owns the teardown. */
export function learnFrom(handler: ((identity: string) => void) | null): void {
  listener = handler
}

/**
 * Offers a press to whatever is listening for a binding.
 *
 * True means it was taken and must not go any further. Releases are offered too and always swallowed
 * while a capture is open, so the note that assigned a binding cannot also stop an Ignite on the way
 * back up.
 */
export function takenForBinding(identity: string): boolean {
  if (!listener) return false
  listener(identity)
  return true
}

/** Whether a capture is open, which is what makes a release worth swallowing. */
export function learning(): boolean {
  return listener !== null
}
