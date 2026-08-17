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

**The cascade you see is the event graph.** Audio does not cascade — every sounding node plays in
parallel into the master bus. Only event cables are drawn today; explicit audio cables are next.

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
- **Patch codes.** The entire patch packs into one short URL-safe string you can copy and paste.
  Eight nodes come to about 150 characters, against roughly 2700 as JSON.

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
