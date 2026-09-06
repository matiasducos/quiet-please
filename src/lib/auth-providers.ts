/**
 * Facebook sign-in is hidden until a real sign-in completes end to end.
 *
 * Everything around it is wired and verified: the Supabase provider is enabled,
 * and the authorize request carries the right `client_id`, a `redirect_uri`
 * Facebook accepts, `scope=email` and the PKCE/state pair. Migration 083 guards
 * the one case Facebook can produce that Google never did — an account with no
 * email address. What has not happened yet is a human completing the round trip.
 *
 * Flip this to true once it does. Both buttons stay in the tree behind it rather
 * than being commented out — the previous attempt commented them, which left
 * `handleFacebookLogin` defined and unreferenced, and left todo.md recording the
 * feature as shipped when nothing rendered. A flag cannot drift that way: the
 * handlers stay referenced, so the compiler keeps checking them.
 */
export const SHOW_FACEBOOK_LOGIN: boolean = false

/**
 * The chicken-and-egg this flag created: the button has to be exercised against
 * production to find out why it fails, and it cannot be exercised while it is
 * hidden from everyone. Flipping the constant to test would put a button known
 * to be broken in front of real visitors for the length of the experiment.
 *
 * `?fb=1` opens it for whoever holds the link and nobody else. It is not a
 * secret and does not need to be — the worst a stranger can do with it is reach
 * the same broken sign-in we are trying to diagnose, on an app that is still in
 * Meta development mode and admits only accounts with a role on it.
 *
 * Delete this function once SHOW_FACEBOOK_LOGIN is true; at that point the
 * button is public and the override means nothing.
 */
export function showFacebookLogin(params: { get(name: string): string | null }): boolean {
  return SHOW_FACEBOOK_LOGIN || params.get('fb') === '1'
}
