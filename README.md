# Castill_ÓN

A node-based modular synthesiser that runs in the browser, in the spirit of Pure Data and
Max/MSP but with one difference: execution is a **cascade**.

An `IGNITE` node fires, the oscillator wired below it runs its sequence, and when that finishes it
triggers whatever is wired below _it_. The patch lights up and branches downward, and you watch the
flow travel while you hear it.

## Three overlaid graphs

The idea the whole thing is built on. As in Pure Data there are events and there is signal — and
signal here comes in two kinds, because a modulator carries a control voltage rather than something
you would want to hear:

|                 | The **event** graph       | The **audio** graph                     | The **modulation** graph      |
| --------------- | ------------------------- | --------------------------------------- | ----------------------------- |
| What it carries | Triggers with a timestamp | Continuous audio                        | A value swept over time       |
| When it acts    | At discrete instants      | All the time, at 48 kHz                 | All the time                  |
| What walks it   | The scheduler, in JS      | The Web Audio engine, on its own thread | The engine, or a 20 Hz driver |
| Ports           | Top and bottom            | The sides                               | The sides                     |
| Cables          | Thin, and they flow       | Thicker, and they glow                  | Dotted, and they breathe      |

**The cascade you see is the event graph.** Audio does not cascade: every sounding node plays in
parallel into the master bus, and effects are sends off that. The two run at right angles to each
other on purpose — triggers down, signal across — so which graph a cable belongs to is legible
without having to remember a colour.

**One side port takes either kind of signal cable**, and what a cable _is_ comes from what is at its
ends rather than from which port you started at. A cable drawn backwards is turned round rather than
refused, since between an oscillator and an effect there is only one direction that means anything.

## What is in it

- **Oscillators** with 2, 4, 8 or 16 steps. Ten waveforms: sine, triangle, sawtooth, ramp, square,
  variable-width pulse, and white, pink, brown and blue noise. Pulse and ramp are built from their
  Fourier series, since Web Audio ships neither.
- **Per-voice filter** — low pass, high pass or band pass, cutoff edited on a log slider.
- **Delay node** that holds a trigger and passes it on later, so branches drift out of step.
- **A budget counted in work, not voices.** One point is one plain oscillator voice, the ceiling is a
  hundred, so the meter reads as a percentage. A wavetable voice costs more than a native one, a
  per-voice filter adds a little, and effects are paid for the whole time they exist — a reverb is a
  `ConvolverNode`, the dearest thing here, priced by the length of its tail. The meter shows the split,
  because the standing cost of a rack is what explains why a heavy patch stops layering early. Past
  75 % a retriggered node restarts instead of layering, so the texture degrades before it glitches;
  effects are never disabled behind your back, since you put them there.
- **Whole-cascade loop.** When every branch has drained, the cascade fires again. Each pass lasts
  as long as its longest branch, so the cycle breathes rather than holding a fixed pulse.
- **An FX node** with eleven effects: reverb, distortion, bitcrush, echo, filter, chorus, phaser,
  tremolo, ring modulation, stereo pan and an octave divider. The bitcrusher does both halves: bit depth through a
  waveshaper, and sample rate through an `AudioWorklet`, since holding a sample between outputs is
  memory and a curve has none. No filtering on the way down — the aliasing is the sound. The **octave
  divider** is the other one that needs memory: a flip-flop clocked by the signal's own zero crossings
  gives a square at half its frequency, and multiplying the input by that puts the fundamental an
  octave down. Octave _up_ is rectification, a curve with no memory, so it has been a distortion shape
  all along. They attach to an oscillator's side ports as sends —
  several on one oscillator, or one shared by several — and each carries a wet/dry mix, so a send is
  a blend rather than a replacement.
- **A MOD node** that sweeps a parameter of whatever it is wired to. Which parameters it offers
  depends on the destination: a reverb's decay, a chorus's sweep, an oscillator's filter cutoff. Most
  are reached by connecting the modulator straight into an `AudioParam`, which Web Audio does on its
  own thread for nothing; the few that rebuild something — an impulse response, a shaper curve —
  are driven by recomputation instead, quantised so a sweep does not regenerate a buffer per frame.
  Depth is a share of the target's own range, so one control means the same thing on a mix as on a
  cutoff in hertz. Its cable breathes, and only once what it is pointed at is making a sound.
- **A MOD can be an envelope instead of an LFO**, and the difference is not the shape but the clock: an
  LFO keeps its own rate whatever the music does, an envelope runs once each time the cascade triggers
  it. So a MOD carries event ports as well, and where you wire the trigger is what decides the
  behaviour — under an Ignite it runs once per pass, under a node deep in the tree it runs when that
  branch lights up, behind a Delay it runs late. It passes the trigger on, so one in the middle of a
  chain never breaks the chain. An envelope fires either on a trigger or on **every note** — one sweep
  per note, each on that note's own filter, which is the classic filter pluck. Per note needs a target
  that is built per note, and an oscillator's filter is the only one there is.
- **Ignite modes.** An Ignite either fires by itself with the transport, or waits for a key. Bound to
  a key it can hold — sounding while the key is down — or toggle, starting on one press and stopping
  on the next. Built so the Ignite does not know it was a keyboard: a source emits press and release
  against an identity, which is the shape MIDI already has.
- **MIDI input**, which is that promise collected: notes from a controller play the bound Ignites, and
  nothing in the trigger layer needed changing. Assign a binding by playing it — a key or a note,
  whichever arrives first, so there is no source to choose. A five-pin socket beside the load meter says
  whether there is a keyboard there, and names it when there is.
- **Undo and redo**, by whole-patch snapshot, where one step is one completed gesture — from pressing
  the mouse to letting go, so a slider drag is one step rather than a hundred. It covers the
  destructive things too, which is why rolling the dice and resetting no longer ask first: a
  confirmation is a question people learn to dismiss without reading, and undo is an answer you can
  give after seeing the result.
- **Audio export** to a WAV, rendered offline through an `OfflineAudioContext` rather than recorded in
  real time, so it is faster than listening and unaffected by anything else the machine is doing.
  Length is chosen in **repetitions of the cascade** rather than in seconds, because a cascade's
  length is a property of the patch and not something you should have to measure.
- **A patch gallery**, a window over the canvas rather than a page — so choosing a patch loads it into
  the instrument already underneath. Cards draw their own cascade, and stars decay with age so the
  popular sort does not freeze on whatever was published first.
- **A dice button** that rolls a patch worth listening to, anywhere from one oscillator to sixty with
  a rack of effects. Truly random parameters give noise, so the taste is in the constraints: notes
  come from one scale, the tree is always fully connected so nothing sits silent, levels are divided
  by the root of the voice count so a wall of oscillators is no louder than a single one, and the
  tonal waveforms are far likelier than the noise ones.
- **Copy and paste**, with Cmd or Ctrl. Shift-drag selects several nodes, and a copy brings their
  parameters and the cables between them. The clipboard outlives loading another patch, so an
  oscillator worth keeping can be carried from one roll of the dice to the next.
- **A manual**, opened from the empty inspector: a window over the app, in English or Spanish, chosen
  from the browser's locale and remembered. Only the manual has a language — the interface stays in
  English, since its labels are three words each and translating `DIV` would make it longer without
  making it clearer. Both languages live adjacent in one file so a half-finished edit shows up in the
  diff rather than as a blank paragraph months later.
- **Patch codes.** The entire patch packs into one URL-safe string you can copy and paste. Every
  parameter left at rest costs a single bit, so a code carries roughly what you actually changed.
- **Short codes.** Six characters that stand for a patch — `K7M2QX` — and what the interface shows.
  Thirty bits cannot hold a patch, so a short code refers to one rather than containing it: it is the
  hash of the long code, which means the same patch always gets the same short code and changing the
  patch changes it. **Generate** publishes and puts the code in the field; the field is empty until
  it does, because a code shown before it exists is a code somebody writes down. Copy copies what is
  there and nothing else. The field takes either kind of code.
  Eight nodes come to about 150 characters, against roughly 2700 as JSON.

## Sharing

The long code is self-contained and needs nothing: it decodes locally and works offline. Short codes
need somewhere to keep the patch they point at, which is a Cloudflare Worker and a KV namespace:

```bash
npx wrangler login
npx wrangler kv namespace create PATCHES   # paste the id into wrangler.toml
npx wrangler d1 create castillon-gallery   # the gallery; paste the id in too
npx wrangler d1 execute castillon-gallery --remote --file src/share/schema.sql
npx wrangler deploy                        # prints the service URL
```

Then build the app with `VITE_SHARE_URL` set to that URL — the deploy workflow does. Until it is
set, the Share button is hidden, the gallery falls back to a private shelf in this browser, and
everything else behaves exactly as it does without it: the service is a convenience layer, not a
dependency. It stores the same string the app already lets you copy, so if it ever goes away, nothing
exists only inside it.

## The long code

The whole patch as one string. It is what actually contains a patch, decodes with no network, and is
what gets committed into this repo — the starting patch and the load test are both just codes.

It is deliberately not on show, since a short code is what anyone would want to pass on. **Five quick
clicks on Copy** turn on a developer mode, which puts the long code in the field _and copies it_ —
walking away with it is the point of the run, not merely seeing it. Five more put the mode away.
Pasting a long code always works whether the mode is on or not, and neither ever publishes anything.

## Running it

```bash
npm install
npm run dev
```

Then click Play — the first click is also what unblocks audio, since browsers will not start an
`AudioContext` without a user gesture.

```bash
npm test          # unit tests
npm run lint      # oxlint
npm run typecheck # tsc; neither the linter nor the build runs the compiler
npm run build     # production build
```

## How it keeps time

Notes are never fired from `setTimeout`; it is accurate to tens of milliseconds and drifts. The
scheduler wakes every 25 ms, looks 100 ms ahead, and schedules audio at absolute audio-clock
timestamps.

That head start does double duty. It is also how the loop stays seamless: the scheduler notices a
cascade has drained roughly 100 ms before its last note sounds, which is exactly enough time to
reschedule the start without an audible gap.

The animation is a **separate queue**, drained in `requestAnimationFrame` against the audio clock,
so a node's flash lands on the note you hear rather than on the moment it was scheduled.

## Layout

```
src/
  audio/     engine, scheduler, effects, modulation, offline render, waveforms, noise, filter, clock
  audio/worklets/  custom DSP that needs state between samples, bundled to run on the audio thread
  nodes/     node definitions and their scheduling logic
  state/     patch store, patch code, connection rules, persistence
  history/   undo and redo
  input/     key bindings, and the source-agnostic layer under them
  gallery/   the shared patch wall and its client
  share/     short codes and the Worker's routes
  ui/        canvas, nodes, inspector, transport
  viz/       activity queue and cascade depth colouring
```

`docs/stress-patch.txt` holds a 24-oscillator patch code for load testing.

## Licence

Licensed under the [GNU Affero General Public License v3.0](LICENSE).

Copyright © 2026 Wilhelm Schütze.

As with any AGPL project, if you run a modified version as a network service you need to make that
version's source available to the people using it. The deployed app links back here for that
reason.
