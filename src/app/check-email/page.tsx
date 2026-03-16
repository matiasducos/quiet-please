import Link from 'next/link'

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>
}) {
  const { email } = await searchParams

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--chalk)' }}>
      <div className="max-w-sm w-full mx-auto px-8 text-center">
        <Link href="/" style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', display: 'block', marginBottom: '3rem' }}>
          Quiet Please
        </Link>

        <div
          className="bg-white rounded-sm border p-8"
          style={{ borderColor: 'var(--chalk-dim)' }}
        >
          <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>📬</div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.75rem',
              letterSpacing: '-0.02em',
              marginBottom: '0.75rem',
            }}
          >
            Check your email
          </h1>
          <p style={{ fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
            We sent a confirmation link to{' '}
            {email ? (
              <strong style={{ color: 'var(--ink)' }}>{email}</strong>
            ) : (
              'your email address'
            )}
            . Click the link to activate your account.
          </p>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.6 }}>
            Didn't receive it? Check your spam folder, or{' '}
            <Link href="/signup" style={{ color: 'var(--court)' }}>
              try again
            </Link>
            .
          </p>
        </div>

        <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: 'var(--muted)' }}>
          Already confirmed?{' '}
          <Link href="/login" style={{ color: 'var(--court)' }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
