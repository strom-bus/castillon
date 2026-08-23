# Castill_ÓN

A node-based modular synthesiser that runs in the browser, in the spirit of Pure Data and
Max/MSP but with one difference: execution is a **cascade**.

An `IGNITE` node fires, the oscillator wired below it runs its sequence, and when that finishes it
triggers whatever is wired below _it_. The patch lights up and branches downward, and you watch the
flow travel while you hear it.

## Four overlaid graphs

The idea the whole thing is built on. As in Pure Data there are events and there is signal — and
signal here comes in two kinds, because a modulator carries a control voltage rather than something
you would want to hear. The fourth carries neither: it is a standing instruction, read when a node
is scheduled rather than travelling at all.

|                 | The **event** graph       | The **audio** graph                     | The **modulation** graph      | The **warp** graph            |
| --------------- | ------------------------- | --------------------------------------- | ----------------------------- | ----------------------------- |
| What it carries | Triggers with a timestamp | Continuous audio                        | A value swept over time       | A standing override           |
| When it acts    | At discrete instants      | All the time, at 48 kHz                 | All the time                  | When a node is scheduled      |
| What walks it   | The scheduler, in JS      | The Web Audio engine, on its own thread | The engine, or a 20 Hz driver | The scheduler, reading upward |
| Ports           | Top and bottom            | The sides                               | The sides                     | The sides                     |
| Cables          | Thin, and they flow       | Thicker, and they glow                  | Dotted, and they breathe      | Dashed, and completely still  |

The warp cable is drawn still on purpose. Everything a WARP changes takes effect on the next pass —
an oscillator commits its whole sequence when it is triggered — so a cable that pulsed would be
promising something live, and the one thing worth knowing about a WARP is that it is not.

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
- **Per-voice filter** — low pass, high pass or band pass, cutoff edited on a log slider, with **key
  follow** so the top of a wide sequence does not go dull while its bottom stays open. Key tracking
  is anchored at the bottom of the range rather than in the middle, so it only ever opens the filter:
  an anchor in the middle darkens the low half, which reads as a bug in a control nobody would think
  to suspect.
- **A step is more than a pitch.** Each one carries its own level, so a flat row of notes becomes a
  line with accents in it — and where an envelope takes its depth from velocity, a quiet step is
  darker as well as softer. Behind two switches on the oscillator, each step can also carry a
  **probability**, so a repeating figure stops settling, and a **roll** of up to four hits that share
  the step rather than running over the next one. A roll has a signed **ramp**: up fades it away, down
  swells it, zero is the ordinary roll — so the off position lives inside the number instead of being
  a second control whose only job is to say "not the usual thing". Level rather than pitch, of the two
  a roll could ramp in, because a real roll decays and that decay is what makes four hits read as one
  gesture instead of four notes stuck together. Turning a switch off keeps what the steps hold, so it
  can go back on and find the sequence as it was left.
- **Scale quantisation, per oscillator rather than per patch.** A scale is a property of the voice and
  not of the piece: a bass in pentatonic against a lead in minor is ordinary music, and one setting
  for everything forbids it. It bites while a bar is being dragged and nowhere else — changing the
  scale never retunes a sequence already written, because what is on the screen has to be what plays.
  Fitting an existing sequence to a scale is a button you press, not something that happens.
- **Glide, split across two scopes.** Which notes slide belongs to the note and how long a slide lasts
  belongs to the oscillator. One value for a whole sequence could only say that every note glides or
  none does, and the line worth having is the one where some do.
- **Delay node** that holds a trigger and passes it on later, so branches drift out of step.
- **A budget counted in work, not voices.** One point is one plain oscillator voice, and the ceiling is
  measured rather than chosen: Chrome reports how much of each 128-sample block the audio thread has
  used, so ramping load until that reaches a hundred per cent _is_ the ceiling rather than a proxy for
  it. It was a hundred points for as long as nobody had measured it, and turned out to be about fifty
  times that. A wavetable voice costs more than a native one, a
  per-voice filter adds a little, and effects are paid for the whole time they exist — a reverb is a
  `ConvolverNode`, the dearest thing here, priced by the length of its tail. The meter shows the split,
  because the standing cost of a rack is what explains why a heavy patch stops layering early. Past
  75 % a retriggered node restarts instead of layering, so the texture degrades before it glitches, and
  that quarter of headroom is the margin for a machine slower than the one this was calibrated on.
  Effects are never disabled behind your back, since you put them there.

  Every cost is measured twice, and the second time changed three of them. An offline render is a
  batch — the cache behaves and per-block overheads amortise — while live, every 128 samples is a fresh
  visit. The correction turns out to scale with how much _memory traffic_ a node drags with it: a
  buffer read was exactly right, a biquad a shade light, a convolver light by half. The two methods now
  agree to within 1.3 % across five completely different kinds of work.

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
- **A WARP node**, which bends a whole branch from the side. It is the answer to a question the
  cascade could not otherwise be asked: transposing ten oscillators down a branch meant ten edits,
  and a node _in_ the chain could not do it either — wired alongside the cable it was meant to
  replace, the node below fires twice, once through it and once around it, and the untransposed pass
  masks the moved one. So it attaches beside an oscillator instead: nothing is rewired and nothing
  fires twice, and it bends that oscillator and everything the cascade reaches from it. A whole
  cascade is one warp on the oscillator at the top of it, since reach travels downward.

  An oscillator and nothing else, which took a second pass to get right. The rules first allowed an
  Ignite and a Delay as well, and neither has anything a warp can bend — a wait is a number in
  milliseconds that no ratio scales, and a trigger has no pitch or tempo of its own. A warp attached
  to either was never bending that node, it was using it as a place to stand while it reached the
  oscillators below: reach dressed up as attachment. The first fix was to give those two nodes side
  ports, which is a hole covered rather than closed; the second was to narrow the rule so no port
  has to be invented for a cable that means nothing.

  Four dimensions, each named for what it bends rather than for the arithmetic that bends it.
  **Pitch** moves in degrees of each oscillator's own scale and in semitones where that oscillator is
  free, so a bass in pentatonic and a lead in minor both move a third and both stay in key. **Speed**
  divides the step, which is the one thing a DELAY cannot do — a delay sets two branches a fixed
  distance apart and holds them there, and a ratio makes them drift and keep drifting. **Velocity**
  scales what every note below is worth, and **Chance** thins the branch out whether or not the
  oscillators below use per-step chance.

  Pitch adds where the three ratios multiply, which is what lets any number of them stack without
  deciding which one wins: two thirds up come to a sixth, two halves come to a quarter. What travels
  is **which** warps apply rather than their total, because a branch that loops back on itself would
  otherwise re-add each warp on every lap — a two-node cycle under a warp of one step read as
  thirty-two before that was fixed.

  Each node now **declares its ports** in its definition, and the connection rules read that
  declaration rather than assuming. Those were two lists that had to agree and could not be derived
  from one another — the rules decided what a cable may join, each component decided what a cable can
  land on — and when they disagreed the failure was silent in the worst way: a cable the rules permit
  but the canvas cannot draw is refused by hand for no stated reason, and _invisible_ when it arrives
  from a preset, the dice or a patch code, since the edge is in the data whether or not there is a
  handle to hang it on. The patch plays as though the cable is there, and it is. That is how a warp
  wired to an Ignite lived in three shipped patches for four commits, and it surfaced only because
  one rolled by the dice came out looking unwired.

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
  popular sort does not freeze on whatever was published first. Two tabs: the patches people have
  shared, and **six presets** that come with the machine.

  Each preset is built around one idea that is hard to arrive at by rolling, and small enough to read
  at a glance — the plain cascade, why there is no clock, one phrase driving another note by note,
  branches beside branches, a figure that never repeats itself, and a branch bent from the side. They
  are built from the same defaults every node gets rather than written out field by field, so a preset
  cannot fall behind a parameter added after it was written. A test requires that between them they
  demonstrate every part of the machine, for the same reason the dice does: a preset is the one place
  a feature can be _seen_ being used, and step velocity sat in the format, the engine and the dice for
  months with no preset touching it.

- **A dice button** that rolls a patch worth listening to, anywhere from one oscillator to sixty with
  a rack of effects. Truly random parameters give noise, so the taste is in the constraints: notes
  come from one scale — and the oscillator is now told which, so the first bar somebody drags on a
  rolled patch stays in the key it was rolled in — the tree is always fully connected so nothing sits
  silent, levels are divided by the root of the voice count so a wall of oscillators is no louder than
  a single one, and the tonal waveforms are far likelier than the noise ones.

  It rolls everything the instrument can do, which is a rule and not a nicety: the dice is how most
  people meet the machine, so a feature it cannot produce is a feature most people never see. That has
  gone wrong twice — modulators for months, then the whole step scope, which sat in the format and the
  engine while the dice kept writing plain notes at full level. A test now rolls two hundred patches
  and fails if any part of the machine never appears in them. The other half of that test matters as
  much: at least a third of oscillators must come out plain, because a generator where everything
  thins out and rolls and slides has no ordinary voice left to hear the special ones against.

  Warps are deliberately rare — one at most, since two stack and two rolled at random stack in a way
  nobody chose — and each gets one dimension rather than four, because all four at once is a patch
  nobody can hear their way back out of.

- **Copy and paste**, with Cmd or Ctrl. Shift-drag selects several nodes, and a copy brings their
  parameters and the cables between them. The clipboard outlives loading another patch, so an
  oscillator worth keeping can be carried from one roll of the dice to the next.
- **A manual**, opened from the empty inspector: a window over the app, in English or Spanish, opening
  in English whatever the browser is set to and remembering the choice. Guessing from the locale was
  the first version and it is the wrong default — the interface around the manual is in English, so
  opening in another language leaves somebody reading two at once. Only the manual has a language: the
  interface stays in English, since its labels are three words each and translating `DIV` would make
  it longer without making it clearer. Both languages live adjacent in one file so a half-finished
  edit shows up in the diff rather than as a blank paragraph months later.

  Thirteen chapters and a hundred and fourteen entries, written for whoever is using the instrument
  rather than for whoever built it: no entry explains how something is implemented, and every one says
  what a control does to the sound and when you would reach for it. One chapter per module, each in
  the order its own panel is in and under the panel's own group headings, so reading the manual and
  looking at the panel are the same act. A test reads the inspector's own source and the effects table
  for every label they render and fails if the manual has not said each one — adding a slider without
  writing it up is now a broken build, where before it passed while the manual quietly described a
  panel that no longer existed.

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
npm run stress    # regenerates docs/stress-patch.txt from its generator
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
  audio/     engine, scheduler, effects, modulation, offline render, waveforms, noise, filter, clock, scales
  audio/worklets/  custom DSP that needs state between samples, bundled to run on the audio thread
  nodes/     node definitions and their scheduling logic
  state/     patch store, patch code, connection rules, transposition, persistence
  presets/   the patches that come with the machine
  help/      the manual, both languages adjacent in one file
  history/   undo and redo
  input/     key bindings, and the source-agnostic layer under them
  gallery/   the shared patch wall and its client
  share/     short codes and the Worker's routes
  tools/     the load sweep, the ceiling probe, and the stress-patch generator
  ui/        canvas, nodes, inspector, transport
  viz/       activity queue and cascade depth colouring
```

`docs/stress-patch.txt` holds a 48-oscillator patch code for load testing, generated by
`npm run stress` from `src/tools/stressPatch.ts`. It used to be built in the app and pasted in, which
had to be redone on every change to the patch-code format and was an operation nobody could check —
a wrong paste produces a code that decodes to a slightly different patch, and nothing about the file
would look wrong. The test now compares the file against the generator, so the two cannot drift.

## Licence

Licensed under the [GNU Affero General Public License v3.0](LICENSE).

Copyright © 2026 Wilhelm Schütze.

As with any AGPL project, if you run a modified version as a network service you need to make that
version's source available to the people using it. The deployed app links back here for that
reason.
