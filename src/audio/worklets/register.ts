/**
 * Loading the worklet processors onto a context.
 *
 * `addModule` is a promise, and a processor cannot be constructed before it resolves — which would be
 * awkward if effects were built at any old moment. They are not: `reconcile` refuses to run until the
 * engine has started, and both places that build a context are already `async`. So this is awaited
 * once per context and everything downstream can be ordinary synchronous code.
 *
 * The source arrives as **text**, bundled by the plugin in `vite.config.ts`, and is registered from a
 * `Blob`. Vite's own `?worker&url` was the obvious route and it is wrong in a way that would have gone
 * unnoticed: it bundles in a build and not in dev, where the module keeps its imports — so the
 * processor would have failed to register in the one place anyone would try it, and this would have
 * fallen back in silence.
 *
 * Bundling rather than shipping a hand-written script is what lets the arithmetic live in `dsp.ts` as
 * an ordinary tested function instead of a copy inside a string.
 */

import decimatorSource from 'virtual:worklet/decimator'
import octaveSource from 'virtual:worklet/octave'

/** Contexts already loaded, so a second effect on the same context does not fetch again. */
const loaded = new WeakSet<BaseAudioContext>()

/**
 * Registers every processor on a context, and reports whether it worked.
 *
 * False is not an error worth surfacing: a browser without `AudioWorklet` still gets every effect,
 * minus the parts that need one. That is the same shape of degradation as an offline context that
 * cannot suspend.
 */
export async function registerWorklets(ctx: BaseAudioContext): Promise<boolean> {
  if (loaded.has(ctx)) return true
  if (typeof ctx.audioWorklet?.addModule !== 'function') return false

  // One module per processor: a single combined file would mean one parse error taking down every
  // effect that needs a worklet rather than just its own.
  const urls = [decimatorSource, octaveSource].map((source) =>
    URL.createObjectURL(new Blob([source], { type: 'application/javascript' })),
  )
  try {
    for (const url of urls) await ctx.audioWorklet.addModule(url)
    loaded.add(ctx)
    return true
  } catch {
    // A blocked fetch, a parse error, a browser that has the object and not the behaviour.
    return false
  } finally {
    // Registered or refused, the blobs have been read by now.
    for (const url of urls) URL.revokeObjectURL(url)
  }
}
