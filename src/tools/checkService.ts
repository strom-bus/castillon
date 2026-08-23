/**
 * Asks the live sharing service whether it can still read a patch this build produces.
 *
 * The one failure neither the tests nor the type checker can see. The app and the Worker share a single
 * `patchCode.ts`, so they cannot disagree in the repository — but they are **deployed separately**: the
 * app is static files pushed by CI, the Worker is `npx wrangler deploy` run by hand. The moment the
 * patch format changes and only one of them ships, the service starts rejecting every code the app
 * makes, with the honest but useless message "not a patch code".
 *
 * That is not hypothetical. Sharing was broken online from the commit that gave a step a chance, a
 * count of hits and a slide until this check existed: the gallery was empty because nothing could be
 * published, and the app reported a service it could not reach. Nothing in the repository was wrong.
 *
 * Publishing is content-addressed and idempotent, so running this repeatedly registers one stable code
 * and never accumulates anything. It does not touch the gallery, which is a different route.
 */

import { decodePatch, encodePatch } from '../state/patchCode'
import { INITIAL_PATCH_CODE } from '../state/patchStore'

const SERVICE = String(process.env.VITE_SHARE_URL ?? '').replace(/\/+$/, '')

if (SERVICE === '') {
  // Not a failure: a checkout without the service configured is the ordinary local case, and the app
  // hides sharing entirely there.
  console.log('VITE_SHARE_URL is unset, so there is no service to check.')
  process.exit(0)
}

const patch = decodePatch(INITIAL_PATCH_CODE)
if (!patch) {
  console.error('INITIAL_PATCH_CODE does not decode in this build, which is a larger problem.')
  process.exit(1)
}

// Re-encoded from the decoded patch rather than sent as it is stored, so what crosses the wire is what
// *this* build writes rather than what was committed — which is the whole thing being tested.
const code = encodePatch(patch)

/**
 * How long to allow for a deploy to reach every edge before calling a disagreement a failure.
 *
 * A worker is deployed to many places and not to all of them at once. The first CI run after the deploy
 * job existed failed on exactly that: the same patch published as one short code and then, seconds later,
 * came back "not a patch code" — one request served by the new version and the next by an edge still
 * running the old one. The worker was fine and read the same code correctly a minute later.
 *
 * So one disagreement is not an answer, and neither is retrying for ever. A bounded window, with the
 * report saying how long it took: persistent breakage still fails, and a deploy that took its time is
 * visible rather than papered over. That last part is why this retries rather than simply sleeping first —
 * a sleep hides the difference between "slow" and "fine".
 */
const PROPAGATION_TRIES = 6
const PROPAGATION_WAIT = 10

const wait = (seconds: number) => new Promise((done) => setTimeout(done, seconds * 1000))

async function main() {
  const health = await fetch(SERVICE)
  if (!health.ok) {
    console.error(`${SERVICE} answered ${health.status} to a health check.`)
    process.exit(1)
  }

  /** One whole attempt: publish, resolve, publish again. Returns why it failed, or null. */
  async function attempt(): Promise<{ why: string } | null> {
    const published = await fetch(SERVICE, { method: 'POST', body: code })
    const short = (await published.text()).trim()
    if (!published.ok) return { why: `refused a patch this build produced: "${short}"` }

    const resolved = await fetch(`${SERVICE}/${short}`)
    const back = (await resolved.text()).trim()
    if (back !== code) return { why: `took ${short} and gave back something different` }

    // The other half of the promise a short code makes: the same patch always gets the same code.
    const again = await fetch(SERVICE, { method: 'POST', body: code })
    const twice = (await again.text()).trim()
    if (twice !== short) return { why: `published as ${short} and then as ${twice}` }

    lastShort = short
    return null
  }

  let lastShort = ''
  let failure: { why: string } | null = null
  let waited = 0

  for (let tries = 0; tries < PROPAGATION_TRIES; tries++) {
    failure = await attempt()
    if (!failure) break
    if (tries < PROPAGATION_TRIES - 1) {
      console.log(
        `  not agreeing yet (${failure.why}) — waiting for the deploy to reach every edge`,
      )
      await wait(PROPAGATION_WAIT)
      waited += PROPAGATION_WAIT
    }
  }

  if (failure) {
    console.error(`After ${waited}s the service still ${failure.why}.`)
    console.error('')
    console.error(
      'Almost certainly the Worker is older than the app: they share one patchCode.ts and',
    )
    console.error(
      'are deployed separately, so a format change that ships on only one side leaves the',
    )
    console.error('service unable to read anything. Run `npm run deploy:worker`.')
    process.exit(1)
  }

  console.log(`${SERVICE} reads what this build writes.`)
  console.log(`  long code   ${code.length} chars`)
  console.log(`  short code  ${lastShort}, stable across two publishes`)
  console.log(`  round trip  identical`)
  if (waited > 0) console.log(`  agreed after ${waited}s, which is a deploy still propagating`)
}

await main()
