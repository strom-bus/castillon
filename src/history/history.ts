/**
 * Undo and redo over whole-patch snapshots.
 *
 * Each entry is the entire patch, not a description of what changed (PLAN §16.2). A patch is already
 * flat serialisable JSON, `toPatch()` already produces one, and the router already reconciles live
 * audio by diffing two snapshots — so undoing is "put the store in this state" and the audio corrects
 * itself with no new code. Inverse operations would mean every future node type carrying its own
 * inverse, each one a place to get it wrong.
 *
 * Pure: it holds snapshots and knows nothing about React, the store, or what a gesture is. What
 * belongs to one gesture is decided by whoever records, which is what `label` is for.
 */

/** How many steps back are kept. Snapshots are cheap; a session's worth of them is not. */
export const HISTORY_LIMIT = 100

export interface Snapshot<T> {
  state: T
  /**
   * What produced it. Consecutive records sharing a label are one gesture — a slider dragged for a
   * second is a hundred changes and one intention — so the newest replaces the last rather than
   * stacking on it.
   */
  label: string
}

export interface History<T> {
  past: Snapshot<T>[]
  /** The state as it stands. Not in `past`, so undoing has something to step back *from*. */
  present: Snapshot<T>
  future: Snapshot<T>[]
}

export function createHistory<T>(state: T, label = 'initial'): History<T> {
  return { past: [], present: { state, label }, future: [] }
}

/**
 * Records a new state.
 *
 * Three things happen here, and each is a decision from §16:
 *
 * - **An unchanged state records nothing.** A drag that ends where it began is not a step, and
 *   `equal` is how the caller says what "unchanged" means for its own state.
 * - **A continuation replaces rather than stacks.** Same label as the present, and the present is
 *   overwritten: the gesture keeps one entry however many changes it emits.
 * - **Recording clears the future.** Editing after undoing abandons what was undone, which is what
 *   every editor does and what anyone expects.
 */
export function record<T>(
  history: History<T>,
  state: T,
  label: string,
  equal: (a: T, b: T) => boolean,
): History<T> {
  if (equal(history.present.state, state)) return history

  if (label === history.present.label) {
    return { past: history.past, present: { state, label }, future: [] }
  }

  const past = [...history.past, history.present]
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    present: { state, label },
    future: [],
  }
}

/**
 * Closes the current gesture without changing anything.
 *
 * Called when a drag is released or a field commits, so the *next* change starts a new entry even if
 * it carries the same label. Without it, dragging a node, letting go, and dragging it again would
 * collapse into one step — the two gestures are indistinguishable by label alone.
 */
export function seal<T>(history: History<T>): History<T> {
  return history.present.label === ''
    ? history
    : { ...history, present: { ...history.present, label: '' } }
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history
  const previous = history.past[history.past.length - 1]
  return {
    past: history.past.slice(0, -1),
    // Sealed on the way out: whatever is recorded next must not merge into the entry undone into.
    present: { ...previous, label: '' },
    future: [history.present, ...history.future],
  }
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history
  const [next, ...rest] = history.future
  return {
    past: [...history.past, history.present],
    present: { ...next, label: '' },
    future: rest,
  }
}
