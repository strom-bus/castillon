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

async function main() {
  const health = await fetch(SERVICE)
  if (!health.ok) {
    console.error(`${SERVICE} answered ${health.status} to a health check.`)
    process.exit(1)
  }

  const published = await fetch(SERVICE, { method: 'POST', body: code })
  const short = (await published.text()).trim()

  if (!published.ok) {
    console.error(`The service refused a patch this build produced: "${short}".`)
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

  const resolved = await fetch(`${SERVICE}/${short}`)
  const back = (await resolved.text()).trim()

  if (back !== code) {
    console.error(
      `Published as ${short}, and it came back different. The store is not round-tripping.`,
    )
    process.exit(1)
  }

  // The other half of the promise the short code makes: the same patch always gets the same code.
  const again = await fetch(SERVICE, { method: 'POST', body: code })
  const twice = (await again.text()).trim()
  if (twice !== short) {
    console.error(
      `The same patch published as ${short} and then as ${twice}. Codes are not stable.`,
    )
    process.exit(1)
  }

  console.log(`${SERVICE} reads what this build writes.`)
  console.log(`  long code   ${code.length} chars`)
  console.log(`  short code  ${short}, stable across two publishes`)
  console.log(`  round trip  identical`)
}

await main()
