import type { ScaleName } from '../audio/scales'

/** Patch data model. Everything here is JSON-serialisable: no Web Audio objects. */

export type NodeId = string

/**
 * The four kinds of cable, which are the four overlaid graphs.
 *
 * Told apart by **behaviour** rather than by colour, because colour already means cascade depth
 * (PLAN §18) — so each of these moves differently and a reader never has to remember a palette:
 *
 * - `event` is the cascade, and it flows downward. Timestamped triggers, carrying no sound.
 * - `audio` is signal, and it glows. Sideways from an oscillator into an effect, because audio does
 *   not cascade: everything sounding plays at once into the master bus and an effect is a send off it.
 * - `mod` sweeps a parameter of whatever it points at, and pulses at its own rate.
 * - `warp` changes what a branch *plays*, and is drawn still. It is a fourth kind rather than a reuse
 *   of `mod` for the same reason `mod` was not a reuse of `audio`: it neither carries sound nor sweeps
 *   a value. Still because everything it changes lands on the next pass — an oscillator commits its
 *   whole sequence when triggered — so a cable that pulsed would promise something live.
 *
 * `mod` and `warp` share the side ports with `audio`, and which of the three a cable becomes comes
 * from what is at its two ends rather than from a setting.
 */
/*
 * Each of these is an **array first and a type second**, which is the way round that holds.
 *
 * A union has no length, so nothing at runtime can count one — which is how the README came to say
 * "three overlaid graphs" for as long as it did, and why a file was written to give the count a home.
 * That file said listing them "fails to compile if the union changes underneath it", and it only half
 * did: removing a kind broke the array, and *adding* one left it quietly short, which is the direction
 * the mistake actually goes in.
 *
 * Deriving the type from the array closes it. There is one place to add a kind, the count follows, and a
 * list that has fallen behind is no longer expressible.
 *
 * The wire format keeps its own copies of these on purpose — those are append-only and frozen, so
 * retuning an order here must not change what an existing patch code decodes to. `codecTables.test.ts`
 * is what holds the two together.
 */
export const EDGE_KINDS = ['event', 'audio', 'mod', 'warp'] as const
export type EdgeKind = (typeof EDGE_KINDS)[number]

export const DIVISIONS = ['1/4', '1/8', '1/16'] as const
export type Division = (typeof DIVISIONS)[number]

export const PROPAGATE_MODES = ['onEnd', 'onStart', 'onStep'] as const
export type PropagateMode = (typeof PROPAGATE_MODES)[number]

/**
 * `pulse` is not a native Web Audio type: it is synthesised with a `PeriodicWave`
 * (see audio/waveforms.ts). The noise colours are played back from generated buffers
 * (see audio/noise.ts). The rest are native oscillator types.
 */
export type Waveform =
  | 'sine'
  | 'triangle'
  | 'sawtooth'
  | 'ramp'
  | 'square'
  | 'pulse'
  | 'white'
  | 'pink'
  | 'brown'
  | 'blue'

/**
 * The oscillator's per-voice filter, and also one of the FX effects. They are not the same sound:
 * per voice, sixteen notes get sixteen filters; as an effect, one filter processes the sum.
 * `off` skips the biquad entirely.
 */
export type FilterType = 'off' | 'lowpass' | 'highpass' | 'bandpass'

/** Hits a step may fire inside its own slot. Four is a roll; past that it stops being one. */
export const MAX_RATCHET = 4

export interface Step {
  /** MIDI note. C1 = 24, C6 = 84. */
  note: number
  active: boolean
  velocity: number
  /**
   * How often this step actually sounds, 0–1. One is every time, which is what every step did before.
   *
   * Judged once for the whole step and not once per hit: a step happens or it does not, and if it does,
   * all of its hits do. Rolling for each hit of a four-hit ratchet turns it into a stutter — a good sound,
   * and a poor default, since it makes a plain sequence unpredictable in a way nobody asked for.
   */
  chance?: number
  /**
   * Hits inside the step's own slot. One is an ordinary note.
   *
   * Deliberately a count and not a count plus a mode. A roll is a rhythmic gesture and repeating the note
   * is what nearly everyone means by it; a mode toggle would cost every reader attention to serve the few
   * who leave it. If it ever wants to climb, that arrives as a signed number whose zero is "repeat" —
   * a value with a neutral point rather than a second control that only ever says "not the usual thing".
   */
  ratchet?: number
  /**
   * How much each hit of a roll changes in level, −1 to 1. Zero is flat, which is what a roll was.
   *
   * Level rather than pitch, of the two dimensions a roll could ramp in. A real roll decays — that is
   * what makes four hits sound like one gesture instead of four notes stuck together — where a climb in
   * pitch is an arpeggio inside a step, which is decoration. And signed rather than a mode: positive
   * fades away, negative swells, and zero is the ordinary roll, so the off position is inside the number
   * instead of being a second control that only ever says "not the usual thing".
   *
   * Nothing at all on a step with one hit, there being nothing to ramp across.
   */
  ratchetRamp?: number
  /**
   * Whether this note slides in from the one before it.
   *
   * Which note slides belongs to the note; how long the slide takes belongs to the oscillator, and stays
   * there as `glide`. That split is how the machines this gesture comes from do it, and it is also the
   * cheaper half: a flag is one bit a step where a time would be ten, and a sequence where every slide
   * lasts a different length is not a thing anybody has asked for.
   *
   * One value for a whole sequence could only ever say that every note glides or none does. The line
   * worth having is the one where some do.
   */
  slide?: boolean
}

export interface OscParams {
  waveform: Waveform
  /** Pulse duty cycle, 0–1. Only used with `waveform: 'pulse'`. */
  pulseWidth: number
  /**
   * Cents off the note, ±50. The cascade's answer to unison.
   *
   * A classic thickens a sound by stacking voices on one oscillator, which here would multiply the load
   * budget. The cascade already gives you several oscillators; what it does not give is a reason for two
   * of them to read as one voice instead of two. A few cents apart is that reason, and it adds no voices.
   */
  detune: number
  steps: Step[]
  division: Division
  /** 0–1 */
  gain: number
  /** Milliseconds. */
  attack: number
  /**
   * Milliseconds to fall from the attack peak to silence, or 0 to hold the peak until the note ends.
   *
   * There is deliberately no sustain level to go with it. A sustain stage exists on a keyboard because
   * a keyboard cannot know how long the key will be held; here every note is scheduled with a duration
   * known in advance, and then the two controls stop being independent — a decay reaching zero at a
   * third of the note is a pluck, and one that would take three times the note is a flat top. The time
   * alone already sweeps from percussive to sustained, and a level would only add the ability to stop
   * decaying, which is the same thing as choosing a longer decay (PLAN §18.9).
   */
  decay: number
  release: number
  /**
   * Milliseconds to slide from the previous step's pitch into this one's. 0 jumps, as before.
   *
   * Per oscillator rather than per patch, because in a cascade a step list belongs to one oscillator and
   * the slide is between *its* consecutive notes — which is the same gesture as a 303's, and the one
   * classic control that reads as melodic intent rather than as timbre. It also does something here that
   * it cannot do on a keyboard: the cascade retriggers the same oscillator over and over, so a glide
   * turns a list of steps into a continuous line rather than a sequence of separate events.
   */
  glide: number
  /** Fraction of the step the note lasts. 0.6 is percussive, 1 is legato. */
  gate: number
  filterType: FilterType
  /** Hz. Edited on a log slider; see audio/filter.ts. */
  cutoff: number
  /**
   * Whether this sequencer uses per-step chance at all. Off by default.
   *
   * A switch and not just the values, because the square under a bar already means armed or muted — and
   * once its fill can also mean a chance, a half-filled square has two readings. Knowing which the
   * sequencer is in takes the ambiguity out of the symbol. It also keeps the step panel to what is being
   * used: a control nobody has turned on is a question nobody asked.
   *
   * Switching it off keeps the values rather than clearing them, so it can be switched back on.
   */
  useChance?: boolean
  /**
   * How lopsided each pair of this sequence's steps is, as the long half against the short.
   *
   * Here as well as on a WARP, and the division between them is the one the instrument already draws:
   * `division` sets this sequence's step and a warp's `speed` scales it, so `swing` sets this sequence's
   * feel and a warp's `swing` scales that. Absolute on the node, relative on the warp.
   *
   * It cannot only be on the warp, and the reason is not convenience. A warp reaches the node it is
   * attached to *and everything below it*, so swinging one oscillator that has anything hanging off it is
   * not tedious, it is impossible. An impossible case is worse than a repetitive one.
   */
  swing?: number
  /** Whether that swing is applied. A bypass, so a groove can be heard straight and put back. */
  useSwing?: boolean
  /**
   * How loosely this sequence is played, as a share of its own shortest gap.
   *
   * The same division as `swing`: set here, added to by a warp. And the same reason for being here at
   * all — a warp cannot loosen one oscillator without loosening everything under it.
   */
  slop?: number
  /** Whether that looseness is applied. */
  useSlop?: boolean
  /** Whether this sequencer uses per-step ratchets at all. Off by default, and kept when off. */
  useRatchet?: boolean
  /**
   * Which notes dragging a bar is allowed to land on. `free` is anything, and is the default.
   *
   * It bites while editing and nowhere else: changing it never retunes a sequence already written, since
   * what is on the screen has to be what plays. See `audio/scales.ts`.
   */
  scale?: ScaleName
  /** The scale's root as a pitch class, 0 being C. Meaningless while the scale is free. */
  scaleRoot?: number
  /** Biquad Q. */
  resonance: number
  /**
   * How much of the note's pitch the cutoff follows, 0–1. At 1 it doubles every octave.
   *
   * Measured up from C1, so it only ever opens the filter. See `trackedCutoff` for why absolute Hz is
   * the wrong unit on an instrument that picks its own register.
   */
  keyTrack: number
  propagateMode: PropagateMode
}

/**
 * The effects an FX node can be. Append-only: the patch code stores the index into this order.
 * Only `gain` is implemented so far; the rest land one row at a time.
 */
export type EffectKind =
  | 'reverb'
  | 'echo'
  | 'distortion'
  | 'crush'
  | 'filter'
  | 'chorus'
  | 'phaser'
  | 'tremolo'
  | 'ring'
  | 'pan'
  | 'octave'
  | 'comb'
  | 'fold'

/**
 * One flat parameter set for every effect, with the inspector showing only the fields the current
 * effect declares. A discriminated union would give tidier types at the cost of a variable-shape
 * record in the store and a variable layout in the bit packer.
 *
 * Every field is encoded whether the current effect uses it or not. That costs a few bits and buys
 * two things: switching effect keeps whatever carries over, and adding an effect never changes the
 * patch code format.
 */
export interface FxParams {
  effect: EffectKind
  /**
   * How much effect. With effects wired as sends there is no dry signal inside one, so this is both
   * the return level and the amount of effect — the clean sound comes from the oscillator's own
   * `direct`, which is what keeps it from being counted twice.
   */
  mix: number
  /** Reverb tail, seconds. Also the comb resonator's ring, which is the same idea at a different scale. */
  decay: number
  /**
   * The note the comb resonator rings at, as a MIDI number.
   *
   * A note and not a frequency, because the whole point of a resonator is that it is *tuned*: it has to
   * agree with the sequence, and nobody agrees with a sequence in hertz. Whole semitones only — you tune
   * a resonator to the key, not to 437.
   */
  pitch: number
  /** Distortion amount, 0–1. Also how far a wavefolder drives the signal into its folds. */
  drive: number
  /**
   * How far off centre a wavefolder pushes the signal before folding it, -1 to 1.
   *
   * Its own field rather than borrowing `pan`, whose range is the same and whose meaning is not. Reuse is
   * the house style here — a ring modulator's Freq borrows `cutoff`, a resonator's Ring borrows `decay` —
   * and it earned a bug on the day this was written: an oscillator's vibrato and a resonator's tuning
   * both being called `pitch` made every vibrato in the instrument eight times too small, silently. A
   * bias is not a stereo position, and one appended field costs about a bit in a patch that uses it.
   */
  bias: number
  /** Which flavour of distortion. */
  shape: DistortionShape
  /** Echo time, as a beat division. */
  time: Division
  /** Echo feedback, 0–0.95. */
  feedback: number
  filterType: FilterType
  /**
   * Hz. Doubles as the tone control every effect has: a low-pass after the effect, which is what
   * keeps a reverb tail from sounding metallic and a drive from sounding harsh.
   */
  cutoff: number
  resonance: number
  /** Chorus rate, Hz. */
  rate: number
  /** Modulation depth, 0–1: chorus, phaser, tremolo. */
  depth: number
  /**
   * The chorus delay it modulates around, in milliseconds. Short is where flanging lives — a few
   * milliseconds gives harmonically spaced notches and a metallic sweep — and long is where
   * chorus does, heard as detuned doubling rather than as a comb.
   */
  sweep: number
  /** Bitcrusher resolution, in bits. */
  bits: number
  /**
   * Sample-rate reduction: how many outputs each sample is held for. 1 leaves the rate alone.
   *
   * The other half of a bitcrusher, and the half that needs an `AudioWorklet` — holding a value
   * between samples is memory, and a `WaveShaperNode` has none. Where a worklet is unavailable this
   * does nothing and the effect crushes bits alone.
   */
  reduction: number
  /** Stereo position: -1 hard left, 0 centre, 1 hard right. */
  pan: number
  /**
   * Stereo width, 0–1. Delays the right channel behind the left by a few milliseconds, which the
   * ear reads as space rather than as an echo.
   */
  width: number
}

export type DistortionShape = 'overdrive' | 'distortion' | 'fuzz' | 'octave'

export const MIN_DECAY = 0.1
export const MAX_DECAY = 10
export const MAX_FEEDBACK = 0.95
export const MIN_RATE = 0.1
export const MAX_RATE = 20
export const MIN_SWEEP = 0.5
export const MAX_SWEEP = 35

/** How far a WARP may move a branch. Two octaves either way is more than any patch has wanted. */
export const MAX_WARP = 14

/**
 * How far a ratio on a WARP may go either way.
 *
 * Four times is already a branch running at a quite different tempo from the one beside it; past that
 * the two stop sounding like the same piece. Stacking two warps can exceed it, which is allowed —
 * what is clamped is what one node may ask for.
 */
export const MIN_WARP_RATIO = 0.25
export const MAX_WARP_RATIO = 4

/** Ratios a WARP offers for speed, all musical rather than arbitrary. Neutral is 1. */
export const SPEEDS = [0.25, 1 / 3, 0.5, 2 / 3, 1, 1.5, 2, 3, 4] as const

/**
 * How lopsided a pair of steps is, as the ratio of the long half to the short.
 *
 * A ratio and not a displacement, which is what lets it join the other three. Two warps of half a step
 * would come to a whole step of delay, which is nonsense, so a displacement has to be clamped — and
 * clamping is the one thing that breaks the rule making any number of warps stack without deciding which
 * wins. As a ratio it multiplies like Speed does: straight is 1, and two light swings come to a heavy one.
 *
 * Named for what a musician would recognise. 1.5 is the light shuffle most drum machines call "swing";
 * 2 is the triplet feel, where the long half is twice the short; past 3 it stops being a groove and
 * becomes a pair of hits with a gap.
 */
export const SWINGS = [1, 1.2, 1.5, 1.75, 2, 2.5, 3] as const

/** Bounds for a swing arriving from a patch code, which need not have come from the list above. */
export const MIN_SWING = 1
export const MAX_SWING = 4

/**
 * How far a note may fall from where it was written, as a share of the shortest gap in its sequence.
 *
 * A share and not milliseconds, which is the whole design. Thirty milliseconds is five per cent of the
 * gap in a slow straight bass and two hundred and forty per cent of it in a fast branch with a heavy
 * swing — inaudible in one and the groove destroyed in the other, from one setting. A fixed number cannot
 * mean the same thing in two branches of a machine whose branches run at different speeds on purpose.
 *
 * Capped at a half because two notes each free to move by X close on each other by 2X, so at a half they
 * can meet and never cross. A note landing before the one in front of it does not sound human, it sounds
 * broken, and that is the line between loose and wrong.
 */
export const MAX_SLOP = 0.5

/**
 * The longest run of passes a SIEVE can count over.
 *
 * Sixteen because past that nobody can hear the pattern as a pattern — a branch that happens once every
 * twenty passes is not a rhythm, it is a surprise. And two sieves counting over the same run is how
 * alternation is written, so the useful values are small ones.
 */
export const MAX_EVERY = 16

/**
 * A node that lets a trigger through on some passes and not others.
 *
 * The sibling of a DELAY, which is the shape of the idea: a DELAY holds a trigger and passes it on late,
 * and this holds a trigger and passes it on *sometimes*. Both leave the branch below untouched and change
 * only whether and when it happens, which is why neither needed a new kind of cable.
 *
 * Two conditions, and they compose because both are neutral at rest. `every` and `offset` are the
 * counted one — "the first of every two", written 1:2 — and `chance` is the tossed one. A sieve added and
 * not touched passes everything, so putting one in a chain is never a change until it is asked to be.
 */
export interface SieveParams {
  /**
   * What the run is counted in: passes of the cascade, or triggers arriving at this node.
   *
   * Passes by default, which is what it has always done. They are the same thing in a plain chain — one
   * trigger reaches a node once per pass — and they come apart in exactly the places worth having:
   *
   * - Under an oscillator propagating **on every step**, a trigger arrives once per step, so counting
   *   them divides the step stream. Sixteen steps above and a sieve at 1:4 fires the branch on every
   *   fourth one, which nothing else here can do.
   * - Where a node has **several parents**, it is reached once per parent.
   * - Inside a **cycle**, where a node is reached again and again and "which pass is this" has no useful
   *   answer at all.
   *
   * That last one is why this exists rather than a JOIN. A node that waits for all of its parents cannot
   * be defined in a graph that permits cycles — a parent below the join can only fire after it, so the
   * join waits for something waiting for it and the pass never ends. Counting arrivals is well defined
   * everywhere, cannot deadlock, and does not quietly reintroduce a bar by making branches wait.
   */
  counts?: 'passes' | 'triggers'
  /** How long the run is. 1 counts nothing and lets everything through. */
  every: number
  /** Which pass of that run is this node's, counting from one. */
  offset: number
  /** And how often it lets one through when the count says it may. 1 is always. */
  chance: number
}

export interface WarpParams {
  /**
   * Steps to move everything below this node, counted in whatever units each oscillator can offer.
   *
   * Degrees where the oscillator has a scale and semitones where it is free, which is one number meaning
   * what a musician means by it in both cases — "a third up" is two steps, and whether that comes out as
   * three semitones or four is a question about the key rather than about the gesture. It is also what
   * lets one warp serve oscillators in different scales: each reads the offset in its own terms.
   */
  transpose: number
  /**
   * What to multiply the pace of everything below by. 1 leaves it alone.
   *
   * The one thing a cascade could not do before: two branches at different speeds. A DELAY sets them
   * apart by a fixed amount and they stay that far apart for ever; a ratio makes them drift, and keep
   * drifting, which is what the machine is for.
   *
   * Chosen from musical ratios rather than dragged, because a half and a third are worth having and 0.87
   * is not — against a grid an arbitrary ratio is only out of time.
   */
  speed?: number
  /**
   * How lopsided each pair of steps is below here, as the ratio of the long half to the short.
   *
   * The first of these whose effect depends on *where* a step sits rather than scaling every step alike,
   * which is a real step up in what the scheduler has to know. What it buys is a groove applied to a
   * whole branch: swinging four oscillators by hand is four edits, which is the argument WARP exists on.
   *
   * A pair keeps its total length, so a sequence takes exactly as long swung as straight and hands the
   * cascade on at the same moment. Swing changes how a branch *feels*, never when it ends — which is
   * what keeps it from being a Speed with extra steps.
   */
  swing?: number
  /**
   * Whether that swing is applied at all, kept separate from the ratio.
   *
   * A ratio of 1 is already straight, so this is not a second way of saying off — it is a bypass. What
   * you do with a groove is listen straight, then swung, then straight again, and a control that had to
   * be walked back to 1 and then found again loses the setting every time. The same reason `useChance`
   * and `useRatchet` are switches beside their values rather than inside them.
   */
  useSwing?: boolean
  /**
   * How loosely every note below is played, as a share of the shortest gap in its own sequence.
   *
   * Measured against the sequence rather than in milliseconds so that one setting means the same thing
   * wherever it lands — see `MAX_SLOP`. Swing and this compose rather than replace: swing decides the
   * shape of the bar and this decides how closely it is respected, which is a drummer with a shuffle who
   * is not perfectly tight. They act on different things, so nothing about them conflicts.
   *
   * Added where the ratios multiply, following the pitch: two warps asking for looseness make a branch
   * looser, and the total is capped where notes can still not cross.
   */
  slop?: number
  /** Whether that looseness is applied at all. A bypass, for the same reason `useSwing` is one. */
  useSlop?: boolean
  /**
   * What to multiply every note's velocity by below here. 1 leaves it alone.
   *
   * One control doing two things, which follows from velocity being a modulation source: it makes a
   * branch quieter, and wherever a per-note envelope takes its depth from velocity it closes that filter
   * as well.
   */
  velocity?: number
  /**
   * What to multiply the chance of every step below by. 1 leaves it alone.
   *
   * It applies whether or not the oscillator uses per-step chance, which is deliberate: "this branch
   * happens half the time" is worth wanting without having set a chance on sixteen steps first. Above one
   * it makes a sparse sequence denser, up to always.
   */
  chance?: number
}

export interface DelayParams {
  /** How long the trigger is held before being passed on, in milliseconds. */
  delayMs: number
}

/**
 * How an Ignite is fired (PLAN §17).
 *
 * `auto` is what it has always done: fire when the transport starts, and loop. `bound` waits for an
 * input instead, and is not seeded by Play at all — that is the whole point of it.
 */
export type IgniteTrigger = 'auto' | 'bound'

/**
 * What a bound Ignite does with a press.
 *
 * `hold` runs while the key is down. `toggle` starts on the first press and stops on the next. The
 * two map onto MIDI without translation: note-on and note-off *are* press and release, so hold needs
 * both and toggle listens to note-on alone.
 */
export type IgniteBehaviour = 'hold' | 'toggle'

/**
 * Where a press comes from.
 *
 * A discriminated union rather than a key code, because an Ignite must not know it was a keyboard: a
 * MIDI note is a second `source` and nothing above this changes (§17.3).
 */
/**
 * What an Ignite answers to.
 *
 * `source` names where a press came from and `code` is that source's own way of saying which one — a
 * physical key code, or a MIDI note number. Kept as two fields rather than one string because the
 * source decides how the code is read and how it is shown: `KeyA` reads as A, `60` as C4.
 *
 * Deliberately not an enum of every source that could ever exist. Adding one is a caller, not a change
 * here (§17.3), and the trigger layer only ever compares `${source}:${code}` against what it is given.
 */
export type IgniteBinding = { source: 'key' | 'midi'; code: string }

export interface StartParams {
  trigger?: IgniteTrigger
  binding?: IgniteBinding | null
  behaviour?: IgniteBehaviour
}

/** What an Ignite does when nothing says otherwise: exactly what it did before any of this existed. */
export const DEFAULT_IGNITE: Required<Omit<StartParams, 'binding'>> & { binding: null } = {
  trigger: 'auto',
  binding: null,
  behaviour: 'hold',
}

/** The identity a binding answers to, used to match a press against the Ignites waiting for one. */
export function bindingKey(binding: IgniteBinding | null | undefined): string | null {
  return binding ? `${binding.source}:${binding.code}` : null
}

/** Envelope times, in milliseconds. The same span the oscillator's own envelope uses. */
export const MIN_MOD_ATTACK = 1
export const MAX_MOD_ATTACK = 2000
export const MIN_MOD_DECAY = 5
export const MAX_MOD_DECAY = 8000

export interface ModParams {
  /**
   * Whether an LFO's rate is counted in beats rather than in hertz.
   *
   * Off, so every patch made before this keeps the rate it was given. The echo has synced to the tempo
   * since it existed; this is the same idea reaching the one control most likely to want it.
   */
  sync?: boolean
  /** Beats per cycle when it is. See `MOD_BEATS`. */
  beats?: number

  /**
   * What it modulates on whatever it is wired to.
   *
   * `level` and `mix` belong to the engine; anything else is a parameter key of the effect the cable
   * landed on, so a MOD on a reverb can point at its decay and one on a chorus at its sweep.
   */
  target?: string
  /**
   * What kind of modulator it is, and the difference is not the shape but **the clock**.
   *
   * An `lfo` runs on its own rate for ever, indifferent to the music. An `env` runs once, when
   * something in the cascade triggers it — so the modulation becomes part of the structure of the
   * piece rather than a wobble laid over it (PLAN §18.7).
   */
  kind?: 'lfo' | 'env'
  /**
   * What starts an envelope: a trigger arriving in the cascade, or every note.
   *
   * `trigger` is one sweep per activation of the branch the MOD hangs from — a long gesture over a
   * whole pattern. `note` is one sweep per note, each on that note's own filter, which is the classic
   * synth pluck.
   *
   * `note` only means something pointed at an **oscillator**: notes are what an oscillator has. On an
   * effect there is one parameter and many notes, and no unambiguous reading of which note owns it.
   */
  fires?: 'trigger' | 'note'
  wave?: 'sine' | 'triangle' | 'square' | 'sawtooth' | 'random'
  /**
   * Whether a per-note envelope's peak is scaled by the note's velocity.
   *
   * Only per-note envelopes can honour it, being the only modulator with a note to read. It is what turns
   * a step's velocity from a second name for level into a source: the same cable on a cutoff opens further
   * on a hard step than on a soft one.
   */
  byVelocity?: boolean
  /** Hertz. An LFO's rate; an envelope has none, since the cascade decides when it runs. */
  rate?: number
  /** 0 to 1, as a share of the target's own value. For an envelope this is its peak. */
  depth?: number
  /** Milliseconds to the peak, for an envelope. */
  attack?: number
  /** Milliseconds back to nothing. */
  decay?: number
}

export type NodeParams =
  OscParams | FxParams | DelayParams | StartParams | ModParams | WarpParams | SieveParams

export const MIN_DELAY_MS = 10
export const MAX_DELAY_MS = 4000

export interface PatchNode {
  id: NodeId
  type: string
  position: { x: number; y: number }
  params: NodeParams
}

export interface PatchEdge {
  id: string
  kind: EdgeKind
  source: NodeId
  target: NodeId
}

export interface Patch {
  version: 1
  bpm: number
  loop: boolean
  nodes: PatchNode[]
  edges: PatchEdge[]
}

/**
 * The ceiling is a musical convention, not an engine limit. Past roughly 1000 the steps get
 * shorter than an envelope and notes stop being notes, so that is where it sits.
 */
export const MIN_BPM = 20
export const MAX_BPM = 1000

export const MIN_NOTE = 24 // C1
export const MAX_NOTE = 84 // C6
