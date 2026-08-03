import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // The social-card renderer reads .ttf files off disk at request time (see
  // src/lib/social/fonts.ts). Nothing imports them, so build-time tracing has no
  // way to know they are needed and would leave them out of the serverless
  // bundle — the route then 500s in production while working fine locally.
  outputFileTracingIncludes: {
    '/admin/tournaments/[id]/social/image': ['./src/lib/social/fonts/*.ttf'],
  },

  // PostHog is proxied through our own origin rather than called directly, for
  // the same two reasons Sentry uses tunnelRoute below:
  //   1. CSP stays tight. connect-src can remain 'self' — no third-party
  //      analytics host needs whitelisting, and nothing breaks silently later
  //      if PostHog changes ingestion domains.
  //   2. Ad-blockers routinely block *.posthog.com by hostname. Since the point
  //      of this instrumentation is measuring acquisition, undercounting exactly
  //      the ad-block-using segment would bias every conversion number.
  // Order matters: the /static rewrite must come before the catch-all.
  async rewrites() {
    return [
      { source: '/ingest/static/:path*', destination: 'https://eu-assets.i.posthog.com/static/:path*' },
      { source: '/ingest/:path*',        destination: 'https://eu.i.posthog.com/:path*' },
    ]
  },
  // PostHog's ingestion endpoints are trailing-slash sensitive; Next's default
  // redirect would break the proxied POSTs.
  skipTrailingSlashRedirect: true,

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // CSP enforced — fonts are now self-hosted via next/font (no external CDN needed).
          // unsafe-inline/unsafe-eval required by Next.js for hydration scripts.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self'",
              "img-src 'self' data: blob: https:",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://va.vercel-scripts.com https://*.ingest.de.sentry.io",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; ')
          },
        ],
      },
    ]
  },
};

export default withSentryConfig(nextConfig, {
  // Sentry org & project (from sentry.io project settings)
  org: 'quiet-please',
  project: 'javascript-nextjs',

  // Suppress noisy source map upload logs outside CI.
  silent: !process.env.CI,

  // Route Sentry requests through /monitoring to avoid ad-blockers.
  tunnelRoute: '/monitoring',
});
