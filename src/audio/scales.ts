/**
 * Which notes a sequencer is allowed to land on (PLAN §18.17).
 *
 * Per oscillator and not per patch, which was the other candidate. A scale is not a property of the
 * piece but of the voice: a bass in pentatonic against a lead in minor is ordinary music, and one setting
 * for everything forbids it. The cost is that it has to be set on each oscillator, which is real — and
 * less bad than the alternative, since an oscillator that should not be quantised has an answer here and
 * a patch-wide setting would have none.
 *
 * It bites when a step is dragged and nowhere else. Changing the scale does not retune a sequence you
 * already wrote: what is on the screen is what plays, and a control that silently rewrote the notes would
 * break that. Fitting an existing sequence to a scale is a thing you ask for, not a thing that happens.
 */

export type ScaleName =
  | 'free'
  | 'major'
  | 'minor'
  | 'dorian'
  | 'phrygian'
  | 'mixolydian'
  | 'pentatonic'
  | 'minorPentatonic'
  | 'blues'
  | 'wholeTone'

/**
 * Semitones above the root, which is how a scale is a scale rather than a list of notes.
 *
 * Exported because the dice draws its notes from one of these, and drawing from its own private copy is
 * how the generator ended up choosing notes from a scale it then never declared on the oscillator.
 */
export const DEGREES: Record<Exclude<ScaleName, 'free'>, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
}

export const SCALES: readonly ScaleName[] = [
  'free',
  'major',
  'minor',
  'dorian',
  'phrygian',
  'mixolydian',
  'pentatonic',
  'minorPentatonic',
  'blues',
  'wholeTone',
]

export const SCALE_NAMES: Record<ScaleName, string> = {
  // Named for what it does rather than for what it is not: "free" is a way of playing, where "none" or
  // "off" reads as a feature switched off and makes the ordinary case sound like a lack.
  free: 'Free',
  major: 'Major',
  minor: 'Minor',
  dorian: 'Dorian',
  phrygian: 'Phrygian',
  mixolydian: 'Mixolydian',
  pentatonic: 'Pentatonic',
  minorPentatonic: 'Minor pentatonic',
  blues: 'Blues',
  wholeTone: 'Whole tone',
}

export const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Every note of a scale, as pitch classes, or null where anything goes. */
export function pitchesOf(scale: ScaleName, root: number): Set<number> | null {
  if (scale === 'free') return null
  return new Set(DEGREES[scale].map((step) => (((root + step) % 12) + 12) % 12))
}

/**
 * The nearest note in the scale, preferring upward on a tie.
 *
 * Nearest rather than rounded down, so dragging a bar feels like it is following the pointer instead of
 * lagging behind it. The tie goes up because a drag that has just moved up should not land below where
 * it started.
 */
export function snapToScale(note: number, scale: ScaleName, root: number): number {
  const allowed = pitchesOf(scale, root)
  if (!allowed) return note

  for (let away = 0; away <= 6; away++) {
    if (allowed.has((((note + away) % 12) + 12) % 12)) return note + away
    if (allowed.has((((note - away) % 12) + 12) % 12)) return note - away
  }
  return note
}

/**
 * A note moved by a number of steps, counted in whatever units the scale makes available.
 *
 * Degrees when there is a scale and semitones when there is not, which is the same control meaning what
 * a musician means by it in each case. "A third up" is two degrees; in a minor scale that is three
 * semitones and in a major one it is four, and neither is a number anybody wants to think about.
 *
 * It is also what lets one transform serve oscillators in different scales: each reads the same offset
 * in its own terms, so a bass in pentatonic and a lead in minor both move a third and stay in key.
 */
export function transposeBy(note: number, steps: number, scale: ScaleName, root: number): number {
  if (steps === 0) return note
  if (scale === 'free') return note + steps

  const allowed = [...(pitchesOf(scale, root) as Set<number>)].sort((a, b) => a - b)
  const size = allowed.length

  // Snapped first, so a note that is off the scale still has somewhere to count from. Without it a
  // transform would silently do nothing at all to any note it did not recognise.
  const here = snapToScale(note, scale, root)
  const pitch = ((here % 12) + 12) % 12
  const index = allowed.indexOf(pitch)
  if (index < 0) return note + steps

  const moved = index + steps
  // Floored rather than truncated, so counting down works the same way as counting up.
  const octaves = Math.floor(moved / size)
  const wrapped = ((moved % size) + size) % size

  // The octave the note is already in, plus the octaves the move crossed, plus where it lands within one.
  return here - pitch + allowed[wrapped]! + octaves * 12
}
