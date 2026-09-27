import { after } from 'next/server'

/**
 * Sentry on the server, loaded on the first error instead of at boot.
 *
 * Importing `@sentry/nextjs` costs ~120ms of CPU locally (~300ms on Vercel, at
 * the ×2.4 calibration in the ops notes) whatever it is configured to do — init
 * itself is 4–11ms; tracing on or off barely moves it. It used to be imported
 * in `instrumentation.ts`, so every cold start of every function paid it before
 * serving anything, including the routes that never error. Cold starts are ~30%
 * of the Active CPU budget, and each one is also a slow click for somebody.
 *
 * Now nothing loads Sentry until something needs reporting. What that gives up,
 * knowingly:
 *  - Performance tracing (it sampled 5% of requests). It cannot start on a
 *    request that has already begun, and nothing here read the traces.
 *  - Process-level handlers for errors thrown outside any request, which only
 *    install once Sentry has initialised. Request, action, route-handler and
 *    cron errors all still arrive through `onRequestError` or the calls below.
 *
 * Callers keep writing `Sentry.captureException(...)` — this module exports the
 * same two functions under the same names, so swapping the import is the whole
 * migration. Reports are fire-and-forget; `after()` keeps the function alive
 * until the event is flushed, since Vercel may freeze it once the response is
 * sent.
 */

type SentryModule = typeof import('@sentry/nextjs')

let loading: Promise<SentryModule> | null = null

/** Import and initialise once per process; every caller shares the promise. */
export function loadSentry(): Promise<SentryModule> {
  loading ??= (async () => {
    // The config files call Sentry.init — importing them is the initialisation.
    if (process.env.NEXT_RUNTIME === 'edge') await import('../../sentry.edge.config')
    else await import('../../sentry.server.config')
    return import('@sentry/nextjs')
  })()
  return loading
}

function report(send: (sentry: SentryModule) => void) {
  const sent = loadSentry()
    .then(async sentry => {
      send(sentry)
      await sentry.flush(2000)
    })
    // Never let error reporting become the error.
    .catch(err => console.error('[sentry] report failed:', err))

  try {
    after(sent)
  } catch {
    // Outside a request scope there is no response to finish first, so
    // nothing will freeze the process under the pending send.
  }
}

export function captureException(...args: Parameters<SentryModule['captureException']>): void {
  report(sentry => sentry.captureException(...args))
}

export function captureMessage(...args: Parameters<SentryModule['captureMessage']>): void {
  report(sentry => sentry.captureMessage(...args))
}
