/**
 * Proving which side of an anonymous challenge you are, without publishing the
 * proof.
 *
 * An anonymous player is identified by a random token handed to them when they
 * submitted their picks, kept in localStorage. The page has to decide client-
 * side whether the visitor is the creator, the opponent or a bystander — the
 * server cannot read localStorage — so something to compare against has to be
 * in the payload of a URL that is, by design, public and shareable.
 *
 * Sending the tokens themselves made every holder of the link able to act as
 * either player. Sending a SHA-256 digest answers the same question and is
 * worth nothing to anyone who does not already hold the token: it cannot be
 * turned back into it, and only the raw token is accepted by the server
 * actions that actually change anything.
 *
 * The server half is `hashToken` in `src/app/c/actions.ts`, which must produce
 * the identical string. It lives there rather than here so that this module
 * stays free of `node:crypto` and can be imported by a client component.
 */

/** Lowercase hex SHA-256, via WebCrypto. Requires a secure context. */
export async function hashTokenInBrowser(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
