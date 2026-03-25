import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service — Quiet Please',
}

export default function TermsOfService() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--chalk)' }}>
      <div className="max-w-2xl mx-auto px-4 py-12 md:py-20">
        <Link href="/" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>Quiet Please</Link>

        <h1 className="mt-8 mb-2" style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.02em' }}>Terms of Service</h1>
        <p className="mb-8" style={{ color: 'var(--muted)', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>Last updated: March 25, 2026</p>

        <div className="prose" style={{ fontFamily: 'var(--font-body)', fontSize: '0.95rem', lineHeight: 1.7, color: 'var(--ink)' }}>
          <Section title="1. Acceptance of terms">
            <p>
              By accessing or using Quiet Please at <strong>quiet-please.app</strong> (the &quot;Service&quot;),
              you agree to be bound by these Terms of Service (&quot;Terms&quot;). If you do not agree,
              do not use the Service.
            </p>
          </Section>

          <Section title="2. Description of service">
            <p>
              Quiet Please is a free tennis bracket prediction game. Users predict tournament outcomes,
              earn ranking points, create and join leagues, and compete with friends. The Service is
              provided for entertainment purposes only.
            </p>
            <p>
              <strong>Quiet Please is not a gambling, betting, or wagering service.</strong> No real money,
              prizes, or items of monetary value are involved. Points and rankings are virtual and have
              no cash value.
            </p>
          </Section>

          <Section title="3. Eligibility">
            <p>
              You must be at least <strong>16 years old</strong> to create an account and use the Service.
              By creating an account, you represent that you meet this age requirement.
            </p>
            <p>
              Anonymous challenges (accessible without an account) are also intended for users aged 16 and
              above. By participating, you represent that you meet this age requirement.
            </p>
          </Section>

          <Section title="4. Accounts">
            <p>
              You are responsible for maintaining the security of your account credentials. You must not
              share your password or allow others to access your account.
            </p>
            <p>
              You must provide accurate information when creating your account. We reserve the right to
              suspend or terminate accounts that use false information.
            </p>
            <p>
              You may sign in using your email and password, or through Google or Facebook OAuth. When
              using third-party sign-in, you authorize us to access the basic profile information
              (name and email) provided by that service.
            </p>
          </Section>

          <Section title="5. Acceptable use">
            <p>You agree not to:</p>
            <ul>
              <li>Use offensive, hateful, or misleading usernames or display names</li>
              <li>Impersonate other users or public figures</li>
              <li>Attempt to manipulate rankings, points, or predictions through automated means</li>
              <li>Exploit bugs, vulnerabilities, or rate limits</li>
              <li>Use the Service for any illegal purpose</li>
              <li>Interfere with or disrupt the Service or its infrastructure</li>
              <li>Scrape, crawl, or harvest data from the Service without permission</li>
            </ul>
            <p>
              We reserve the right to suspend or terminate accounts that violate these rules, at our sole
              discretion and without prior notice.
            </p>
          </Section>

          <Section title="6. Content and intellectual property">
            <p>
              <strong>Your content:</strong> You retain ownership of the content you create (predictions,
              display names, league names). By using the Service, you grant us a non-exclusive, worldwide
              license to use, display, and store your content as necessary to operate the Service.
            </p>
            <p>
              <strong>Our content:</strong> The Service, including its design, code, and original content,
              is owned by Quiet Please and protected by applicable intellectual property laws.
            </p>
            <p>
              <strong>Third-party data:</strong> Tournament names, player names, and match results are
              sourced from third-party data providers and belong to their respective owners. Quiet Please
              is not affiliated with, endorsed by, or connected to the ATP Tour, WTA Tour, or any
              tournament organizer.
            </p>
          </Section>

          <Section title="7. Disclaimer of warranties">
            <p>
              The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of
              any kind, whether express or implied, including but not limited to implied warranties of
              merchantability, fitness for a particular purpose, and non-infringement.
            </p>
            <p>
              We do not guarantee that:
            </p>
            <ul>
              <li>The Service will be uninterrupted or error-free</li>
              <li>Tournament data, scores, or results will be accurate or timely</li>
              <li>Points or rankings will be calculated without errors</li>
            </ul>
          </Section>

          <Section title="8. Limitation of liability">
            <p>
              To the maximum extent permitted by law, Quiet Please shall not be liable for any indirect,
              incidental, special, consequential, or punitive damages, or any loss of data, use, or
              profits, arising out of or relating to your use of the Service.
            </p>
          </Section>

          <Section title="9. Email communications">
            <p>
              By creating an account, you may receive email notifications about tournament draws and
              points earned. You can opt out of these emails at any time through your account settings
              or by clicking the unsubscribe link in any email.
            </p>
            <p>
              We may still send essential account-related emails (e.g., password resets) regardless of
              your notification preferences.
            </p>
          </Section>

          <Section title="10. Privacy">
            <p>
              Your use of the Service is also governed by our{' '}
              <Link href="/privacy" style={{ color: 'var(--court)' }}>Privacy Policy</Link>,
              which describes how we collect, use, and protect your data.
            </p>
          </Section>

          <Section title="11. Termination">
            <p>
              You may stop using the Service at any time. You may request account deletion by contacting
              us at{' '}
              <a href="mailto:support@quiet-please.app" style={{ color: 'var(--court)' }}>support@quiet-please.app</a>.
            </p>
            <p>
              We may suspend or terminate your access to the Service at any time, for any reason, with
              or without notice.
            </p>
          </Section>

          <Section title="12. Changes to terms">
            <p>
              We may update these Terms from time to time. If we make material changes, we will notify
              you by email or through the Service. Your continued use of the Service after changes take
              effect constitutes acceptance of the updated Terms.
            </p>
          </Section>

          <Section title="13. Governing law">
            <p>
              These Terms are governed by the laws of the Republic of Latvia, without regard to conflict
              of law principles. Any disputes arising from these Terms shall be subject to the exclusive
              jurisdiction of the courts of Latvia.
            </p>
            <p>
              If you are a consumer residing in the EU, you also benefit from any mandatory provisions
              of the law of your country of residence and may bring proceedings in the courts of your
              country of residence.
            </p>
          </Section>

          <Section title="14. Contact">
            <p>
              If you have any questions about these Terms, contact us at:<br />
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
