import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy — Quiet Please',
}

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <div className="max-w-2xl mx-auto px-4 py-12 md:py-20">
        <Link href="/" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>Quiet Please</Link>

        <h1 className="mt-8 mb-2" style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em' }}>Privacy Policy</h1>
        <p className="mb-8" style={{ color: 'var(--muted)', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>Last updated: March 25, 2026</p>

        <div className="prose" style={{ fontFamily: 'var(--font-body)', fontSize: '0.95rem', lineHeight: 1.7, color: 'var(--ink)' }}>
          <Section title="1. Who we are">
            <p>
              Quiet Please (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) operates the website{' '}
              <strong>quiet-please.app</strong> (the &quot;Service&quot;). We are based in Latvia
              and subject to the EU General Data Protection Regulation (GDPR).
            </p>
            <p>
              For any privacy-related questions, contact us at{' '}
              <a href="mailto:support@quiet-please.app" style={{ color: 'var(--court)' }}>support@quiet-please.app</a>.
            </p>
          </Section>

          <Section title="2. Data we collect">
            <p>We collect the following categories of personal data:</p>
            <h4>Account data (when you sign up)</h4>
            <ul>
              <li>Email address</li>
              <li>Password (stored as a secure hash — we never see or store your plain-text password)</li>
              <li>Username (chosen by you)</li>
              <li>If you sign up via Google or Facebook: your name and email as provided by the OAuth provider</li>
            </ul>

            <h4>Profile data (optional)</h4>
            <ul>
              <li>Country and city (if you choose to add them)</li>
            </ul>

            <h4>Activity data</h4>
            <ul>
              <li>Bracket predictions you make</li>
              <li>Challenge picks and display names</li>
              <li>League memberships</li>
              <li>Friend connections</li>
              <li>Points and rankings (calculated from your predictions)</li>
            </ul>

            <h4>Technical data</h4>
            <ul>
              <li>IP address (used temporarily for rate limiting; not persisted to our database)</li>
              <li>Basic page-view analytics via Vercel Analytics (aggregated, no personal identifiers)</li>
            </ul>
          </Section>

          <Section title="3. How we use your data">
            <p>We use your data to:</p>
            <ul>
              <li>Provide and operate the Service (authentication, predictions, leaderboards, leagues, challenges)</li>
              <li>Send you email notifications about tournament draws and points earned (you can opt out at any time)</li>
              <li>Prevent abuse through rate limiting</li>
              <li>Calculate rankings and display leaderboards</li>
            </ul>
            <p>
              We do <strong>not</strong> sell your personal data. We do <strong>not</strong> use your data for advertising.
            </p>
          </Section>

          <Section title="4. Legal basis for processing (GDPR)">
            <p>Under the GDPR, we process your personal data on the following bases:</p>
            <ul>
              <li><strong>Contract performance:</strong> Processing necessary to provide you with the Service (account management, predictions, rankings)</li>
              <li><strong>Legitimate interest:</strong> Rate limiting and abuse prevention</li>
              <li><strong>Consent:</strong> Email notifications (you may withdraw consent at any time via your account settings or the unsubscribe link in any email)</li>
            </ul>
          </Section>

          <Section title="5. Third-party services">
            <p>We use the following third-party services that may process your data:</p>
            <ul>
              <li><strong>Supabase</strong> (database and authentication hosting) — processes your account data and activity data</li>
              <li><strong>Vercel</strong> (website hosting and analytics) — processes page-view analytics and request metadata</li>
              <li><strong>Resend</strong> (email delivery) — processes your email address when we send notifications</li>
              <li><strong>Google</strong> (OAuth authentication) — receives and sends your email and name if you choose to sign in with Google</li>
              <li><strong>Facebook / Meta</strong> (OAuth authentication) — receives and sends your email and name if you choose to sign in with Facebook</li>
            </ul>
            <p>Each of these services has their own privacy policies. We only share the minimum data necessary for them to provide their services.</p>
          </Section>

          <Section title="6. Cookies">
            <p>We use a small number of cookies:</p>
            <ul>
              <li><strong>Authentication cookies</strong> (essential) — managed by Supabase to keep you signed in</li>
              <li><strong>Session cookie</strong> (essential) — a cookie that tracks whether your username has been set, used to route you correctly after signup</li>
            </ul>
            <p>
              We use Vercel Analytics for basic page-view metrics. Vercel Analytics is privacy-focused
              and does not use cookies for tracking. No third-party advertising or tracking cookies are set.
            </p>
          </Section>

          <Section title="7. Anonymous challenges">
            <p>
              You can participate in anonymous challenges without creating an account. When you do,
              we store a display name you choose and your bracket picks. A random token is stored in
              your browser&apos;s local storage to identify you as the creator or opponent of a challenge.
            </p>
            <p>
              Your IP address is used temporarily for rate limiting but is not saved to our database.
            </p>
          </Section>

          <Section title="8. Data retention">
            <p>
              We retain your account data for as long as your account is active. If you delete your
              account, we will delete your personal data within 30 days, except where we are required
              by law to retain it.
            </p>
            <p>
              Anonymous challenge data is retained indefinitely as it is not linked to a personal account.
            </p>
          </Section>

          <Section title="9. Your rights">
            <p>Under the GDPR, you have the right to:</p>
            <ul>
              <li><strong>Access</strong> your personal data</li>
              <li><strong>Rectify</strong> inaccurate data</li>
              <li><strong>Erase</strong> your data (&quot;right to be forgotten&quot;)</li>
              <li><strong>Restrict</strong> processing of your data</li>
              <li><strong>Data portability</strong> — receive your data in a structured format</li>
              <li><strong>Object</strong> to processing based on legitimate interest</li>
              <li><strong>Withdraw consent</strong> at any time (e.g., email notifications)</li>
            </ul>
            <p>
              To exercise any of these rights, email us at{' '}
              <a href="mailto:support@quiet-please.app" style={{ color: 'var(--court)' }}>support@quiet-please.app</a>.
              We will respond within 30 days.
            </p>
            <p>
              You also have the right to lodge a complaint with your local data protection authority.
              In Latvia, this is the Data State Inspectorate (Datu valsts inspekcija).
            </p>
          </Section>

          <Section title="10. Children">
            <p>
              The Service is not directed at children under the age of 16. We do not knowingly collect
              personal data from children under 16. If you believe we have collected data from a child
              under 16, please contact us and we will delete it promptly.
            </p>
          </Section>

          <Section title="11. International transfers">
            <p>
              Our third-party service providers (Supabase, Vercel, Resend) may process data outside
              the European Economic Area (EEA). Where this occurs, we rely on the provider&apos;s
              standard contractual clauses or other appropriate safeguards as required by the GDPR.
            </p>
          </Section>

          <Section title="12. Changes to this policy">
            <p>
              We may update this Privacy Policy from time to time. If we make material changes, we
              will notify you by email or through the Service. Your continued use of the Service
              after changes take effect constitutes acceptance of the updated policy.
            </p>
          </Section>

          <Section title="13. Contact">
            <p>
              If you have any questions about this Privacy Policy, contact us at:<br />
              <a href="mailto:support@quiet-please.app" style={{ color: 'var(--court)' }}>support@quiet-please.app</a>
            </p>
          </Section>
        </div>

        <div className="mt-12 pt-8" style={{ borderTop: '1px solid var(--chalk-dim)' }}>
          <Link href="/" style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>← Back to home</Link>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h3 className="mb-3" style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', letterSpacing: '-0.01em' }}>{title}</h3>
      <div className="flex flex-col gap-2" style={{ color: '#333' }}>
        {children}
      </div>
    </div>
  )
}
