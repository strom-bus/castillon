# Castill_ON

A node-based modular synthesiser that runs in the browser, in the spirit of Pure Data and
Max/MSP but with one difference: execution is a **cascade**.

An `IGNITE` node fires, the oscillator wired below it runs its sequence, and when that finishes it
triggers whatever is wired below _it_. The patch lights up and branches downward, and you watch the
flow travel while you hear it.

## Two overlaid graphs

The idea the whole thing is built on. There are two kinds of connection, as in Pure Data:

|                 | The **event** graph       | The **signal** graph                    |
| --------------- | ------------------------- | --------------------------------------- |
| What it carries | Triggers with a timestamp | Continuous audio                        |
| When it acts    | At discrete instants      | All the time, at 48 kHz                 |
| What walks it   | The scheduler, in JS      | The Web Audio engine, on its own thread |
| Ports           | Top and bottom            | Left and right                          |
| Cables          | Thin, and they flow       | Thicker, and they glow                  |

**The cascade you see is the event graph.** Audio does not cascade: every sounding node plays in
parallel into the master bus, and effects are sends off that. The two run at right angles to each
other on purpose — triggers down, signal across — so which graph a cable belongs to is legible
without having to remember a colour.

## What is in it

- **Oscillators** with 2, 4, 8 or 16 steps. Ten waveforms: sine, triangle, sawtooth, ramp, square,
  variable-width pulse, and white, pink, brown and blue noise. Pulse and ramp are built from their
  Fourier series, since Web Audio ships neither.
- **Per-voice filter** — low pass, high pass or band pass, cutoff edited on a log slider.
- **Delay node** that holds a trigger and passes it on later, so branches drift out of step.
- **Layering with a voice budget.** A node retriggered while still sounding layers over itself,
  until voices run short — past 75 % of budget it restarts instead, so the texture degrades before
  it glitches. The transport shows the count.
- **Whole-cascade loop.** When every branch has drained, the cascade fires again. Each pass lasts
  as long as its longest branch, so the cycle breathes rather than holding a fixed pulse.
- **An FX node**, _in progress._ Effects attach to an oscillator's side ports as sends: several on
  one oscillator, or one shared by several. The routing is built and tested; so far the only effect
  behind the dropdown is a gain stage, with reverb, drive, echo, filter and chorus to come.
- **Patch codes.** The entire patch packs into one URL-safe string you can copy and paste. Every
  parameter left at rest costs a single bit, so a code carries roughly what you actually changed.
- **Short codes.** Six characters that stand for a patch — `K7M2QX`. Thirty bits cannot hold a
  patch, so a short code refers to one rather than containing it: it is the hash of the long code,
  which means the same patch always gets the same short code and changing the patch changes it. The
  field takes either kind.
  Eight nodes come to about 150 characters, against roughly 2700 as JSON.

## Sharing

The long code is self-contained and needs nothing: it decodes locally and works offline. Short codes
need somewhere to keep the patch they point at, which is a Cloudflare Worker and a KV namespace:

```bash
npx wrangler login
npx wrangler kv namespace create PATCHES   # paste the id into wrangler.toml
npx wrangler deploy                        # prints the service URL
```

Then build the app with `VITE_SHARE_URL` set to that URL — the deploy workflow does. Until it is
set, the Share button is hidden and everything else behaves exactly as it does without it: the
service is a convenience layer, not a dependency. It stores the same string the app already lets you
copy, so if it ever goes away, nothing exists only inside it.

## Running it

```bash
npm install
npm run dev
```

Then click Play — the first click is also what unblocks audio, since browsers will not start an
`AudioContext` without a user gesture.

```bash
npm test         # unit tests
npm run lint     # oxlint
npm run build    # production build
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
  audio/     engine, scheduler, waveforms, noise, filter, clock
  nodes/     node definitions and their scheduling logic
  state/     patch store, patch code, persistence
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
