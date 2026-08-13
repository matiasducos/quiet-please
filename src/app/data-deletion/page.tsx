import Link from 'next/link'
import type { Metadata } from 'next'

/**
 * Public, signed-out data deletion instructions.
 *
 * Meta requires every Facebook Login app to publish either a deletion callback
 * endpoint or a URL explaining how to delete your data, and it has to be
 * reachable without an account — a reviewer will open it cold. The existing
 * flow lives behind auth on /profile, which satisfies neither the reviewer nor
 * the person who signed up with Facebook and has since lost access to it.
 *
 * Deliberately a static page and not a form. Accepting a deletion request from
 * an unauthenticated form would mean anyone could delete anyone's account by
 * typing their address, so the identified route (sign in, confirm by typing
 * your own username) stays the mechanism and this page just documents it. The
 * email fallback exists for people locked out, where a human can verify.
 */
export const metadata: Metadata = {
  title: 'Deleting your data',
  description:
    'How to delete your Quiet Please account and all associated data, and what happens when you do.',
  alternates: { canonical: '/data-deletion' },
}

export default function DataDeletion() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <div className="max-w-2xl mx-auto px-4 py-12 md:py-20">
        <Link href="/" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>Quiet Please</Link>

        <h1 className="mt-8 mb-2" style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em' }}>Deleting your data</h1>
        <p className="mb-8" style={{ color: 'var(--muted)', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>
          Quiet Please · support@quietplease.app
        </p>

        <div className="prose" style={{ fontFamily: 'var(--font-body)', fontSize: '0.95rem', lineHeight: 1.7, color: 'var(--ink)' }}>
          <Section title="Delete your account from the app">
            <p>
              This is the fastest route and it is entirely self-serve — you do not need to
              contact us.
            </p>
            <ol className="list-decimal pl-5 flex flex-col gap-1">
              <li>Sign in and open your <Link href="/profile" style={{ color: 'var(--court)' }}>profile</Link>.</li>
              <li>Scroll to <strong>Delete account</strong>.</li>
              <li>Type your username to confirm, then confirm the deletion.</li>
            </ol>
            <p>
              If you signed up with Facebook, sign in with the <strong>Continue with Facebook</strong>{' '}
              button — the same account you used originally.
            </p>
          </Section>

          <Section title="If you cannot sign in">
            <p>
              Email <a href="mailto:support@quietplease.app" style={{ color: 'var(--court)' }}>support@quietplease.app</a>{' '}
              from the address on the account, with the subject <strong>Delete my account</strong>.
              We will verify the request and delete it for you.
            </p>
            <p>
              We ask you to write from the account&apos;s own address because we cannot delete an
              account on the say-so of someone we cannot identify — that would be its own
              security problem.
            </p>
          </Section>

          <Section title="What happens next">
            <p>
              Requesting deletion starts a <strong>7-day grace period</strong>, during which you can
              cancel from your profile by signing back in. It exists so that a deletion made in
              frustration, or by someone who briefly had your device, is recoverable.
            </p>
            <p>
              After 7 days the account is deleted permanently and <strong>cannot be recovered</strong>.
            </p>
          </Section>

          <Section title="What gets deleted">
            <p>Everything tied to your account is removed:</p>
            <ul className="list-disc pl-5 flex flex-col gap-1">
              <li>Your account, email address, username and profile</li>
              <li>Every bracket and prediction you have made</li>
              <li>Your points, ranking, achievements and scoring history</li>
              <li>Your league memberships, friendships and challenges</li>
              <li>Your notifications and email preferences</li>
            </ul>
            <p>
              If you own a league, it is transferred to its longest-standing member rather than
              deleted, so that the other members do not lose it along with your account.
            </p>
          </Section>

          <Section title="What we keep, and why">
            <p>
              Tournament results, draws and match data are not personal to you and stay as they
              are — they describe real tennis matches, not your use of the Service.
            </p>
            <p>
              Where we are legally required to retain a limited record of a deleted account, we
              keep only what the law requires and nothing more. See our{' '}
              <Link href="/privacy" style={{ color: 'var(--court)' }}>Privacy Policy</Link> for the
              full picture, including your rights under the GDPR.
            </p>
          </Section>

          <Section title="Removing Quiet Please from Facebook">
            <p>
              Deleting your Quiet Please account removes your data from us, but Facebook keeps its
              own record that you connected the two. To remove that as well, open Facebook{' '}
              <strong>Settings &amp; privacy → Settings → Apps and websites</strong> and remove{' '}
              <strong>Quiet Please</strong>.
            </p>
            <p>
              Doing only this — removing the app on Facebook — revokes our access but does not by
              itself delete your Quiet Please account. Use the steps above for that.
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
