import { describe, expect, it } from 'vitest'
import {
  canRedo,
  canUndo,
  createHistory,
  HISTORY_LIMIT,
  record,
  redo,
  seal,
  undo,
  type History,
} from './history'

/**
 * The rules from PLAN §16, tested on a stand-in state so the cases are about the history and not
 * about patches. What a step is decided the shape of this file: a gesture emitting a hundred changes
 * has to leave one entry, and a gesture that changed nothing has to leave none.
 */

const same = (a: string, b: string) => a === b
const put = (history: History<string>, state: string, label: string) =>
  record(history, state, label, same)

describe('recording', () => {
  it('keeps the newest state as the present', () => {
    const h = put(createHistory('a'), 'b', 'move')
    expect(h.present.state).toBe('b')
  })

  it('pushes the previous state into the past', () => {
    const h = put(createHistory('a'), 'b', 'move')
    expect(h.past.map((entry) => entry.state)).toEqual(['a'])
  })

  it('records nothing when the state has not changed', () => {
    // A drag that ends where it began is not a step (§16.1).
    const before = put(createHistory('a'), 'b', 'move')
    const after = put(before, 'b', 'resize')
    expect(after).toBe(before)
  })

  it('collapses a run under one label into a single entry', () => {
    // The case the whole rule exists for: a slider emits a change per frame.
    let h = createHistory('0')
    for (let i = 1; i <= 100; i++) h = put(h, String(i), 'gain')

    expect(h.present.state).toBe('100')
    expect(h.past).toHaveLength(1)
    expect(h.past[0].state).toBe('0')
  })

  it('starts a new entry when the label changes', () => {
    let h = put(createHistory('a'), 'b', 'move')
    h = put(h, 'c', 'gain')
    expect(h.past.map((entry) => entry.state)).toEqual(['a', 'b'])
  })

  it('drops the oldest once the cap is reached', () => {
    let h = createHistory('0')
    for (let i = 1; i <= HISTORY_LIMIT + 30; i++) h = put(h, String(i), `step-${i}`)

    expect(h.past).toHaveLength(HISTORY_LIMIT)
    // The oldest survivors, not the oldest of all: '0' is long gone.
    expect(h.past[0].state).not.toBe('0')
  })
})

describe('sealing a gesture', () => {
  it('makes the next change of the same kind a separate step', () => {
    // Dragging a node, letting go, and dragging it again is two steps. Labels alone cannot tell them
    // apart, so releasing says so.
    let h = put(createHistory('a'), 'b', 'move')
    h = seal(h)
    h = put(h, 'c', 'move')
    expect(h.past.map((entry) => entry.state)).toEqual(['a', 'b'])
  })

  it('changes nothing else about the history', () => {
    const before = put(createHistory('a'), 'b', 'move')
    const after = seal(before)
    expect(after.present.state).toBe('b')
    expect(after.past).toEqual(before.past)
  })

  it('is idempotent, so releasing twice is harmless', () => {
    const once = seal(put(createHistory('a'), 'b', 'move'))
    expect(seal(once)).toBe(once)
  })
})

describe('undoing', () => {
  it('has nothing to undo at the start', () => {
    const h = createHistory('a')
    expect(canUndo(h)).toBe(false)
    expect(undo(h)).toBe(h)
  })

  it('steps back to the previous state', () => {
    const h = undo(put(createHistory('a'), 'b', 'move'))
    expect(h.present.state).toBe('a')
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(true)
  })

  it('walks back through several steps in order', () => {
    let h = put(createHistory('a'), 'b', 'one')
    h = put(h, 'c', 'two')
    h = put(h, 'd', 'three')

    expect(undo(h).present.state).toBe('c')
    expect(undo(undo(h)).present.state).toBe('b')
    expect(undo(undo(undo(h))).present.state).toBe('a')
  })

  it('does not merge the next change into the entry it landed on', () => {
    // Undoing into a 'gain' entry and then moving a gain slider must not overwrite it.
    let h = put(createHistory('a'), 'b', 'gain')
    h = put(h, 'c', 'move')
    h = undo(h)
    h = put(h, 'z', 'gain')

    expect(h.past.map((entry) => entry.state)).toEqual(['a', 'b'])
  })
})

describe('redoing', () => {
  it('has nothing to redo until something is undone', () => {
    const h = put(createHistory('a'), 'b', 'move')
    expect(canRedo(h)).toBe(false)
    expect(redo(h)).toBe(h)
  })

  it('puts back what was undone', () => {
    const h = redo(undo(put(createHistory('a'), 'b', 'move')))
    expect(h.present.state).toBe('b')
    expect(canRedo(h)).toBe(false)
  })

  it('survives a walk back and forward through several steps', () => {
    let h = put(createHistory('a'), 'b', 'one')
    h = put(h, 'c', 'two')
    h = undo(undo(h))
    expect(h.present.state).toBe('a')
    expect(redo(redo(h)).present.state).toBe('c')
  })

  it('is abandoned by an edit, which is what every editor does', () => {
    let h = put(createHistory('a'), 'b', 'one')
    h = undo(h)
    expect(canRedo(h)).toBe(true)

    h = put(h, 'z', 'two')
    expect(canRedo(h)).toBe(false)
    expect(h.present.state).toBe('z')
  })

  it('is not abandoned by a change that changed nothing', () => {
    // Recording an identical state is a no-op, so it must not quietly eat the redo stack.
    let h = put(createHistory('a'), 'b', 'one')
    h = undo(h)
    h = put(h, 'a', 'two')
    expect(canRedo(h)).toBe(true)
  })
})
