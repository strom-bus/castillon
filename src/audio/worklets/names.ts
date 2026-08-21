/**
 * Names the worklet processors register under.
 *
 * Its own module because both sides need it and they cannot import each other: a processor runs in
 * `AudioWorkletGlobalScope`, which has no DOM and no app, so the bundler inlines whatever it imports
 * into a standalone file. A shared constant is inlined into both and cannot drift.
 */
export const DECIMATOR = 'castillon-decimator'
export const OCTAVE = 'castillon-octave'
