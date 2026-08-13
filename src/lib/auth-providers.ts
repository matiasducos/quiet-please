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
