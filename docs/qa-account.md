# QA verification account

## The problem it solves

The in-app browser Claude drives has no session. Every signed-in surface — the
admin panel, `/predict`, leaderboards, the "Your tournament" panel on a
tournament page — therefore ships typechecked and built but never actually seen
rendered. On 2026-07-29 four merged changes went out that way; on 2026-08-04 the
"Backed but never paid off" fix went out the same way.

`qa@bot.quietplease.app` is a session to borrow.

## Why that address

`isBotEmail()` (`src/lib/email.ts`) matches `@bot.quietplease.app` and is checked
in all three cron routes and in the shared notification-email helper. A user on
that domain **can never be sent mail**, so award-points, auto-predict and draw
announcements can all be fired at this account without anything reaching a real
inbox.

## No password exists

`scripts/qa-user.mjs create` calls `auth.admin.createUser` with no password
field, so the account can only be entered through a one-time link minted by the
service role. There is no credential to store, share, leak or rotate — which is
also why Claude can set the account up but cannot sign itself in unaided.

## Commands

```bash
node scripts/qa-user.mjs status
```

```bash
node scripts/qa-user.mjs create
```

```bash
node scripts/qa-user.mjs login-link
```

`login-link` takes an optional origin as a second argument (default
`http://localhost:3000`); whatever you pass must be in Supabase's allowed
redirect URLs.

**`create` is Matias's step.** Claude does not create accounts, so this one
command has to be run by hand. Everything after it Claude can do.

There is one database — `.env.local` holds production credentials, so `create`
writes a real row to the live project. That is unavoidable, and it is exactly
why the bot domain matters.

## Admin access

`requireAdmin()` is `isDev || ADMIN_IDS.has(user.id)`, so **in development any
signed-in user is an admin** and no configuration is needed to exercise the
admin panel locally. To reach the admin panel on a deployed environment, add the
id printed by `status` to `ADMIN_USER_IDS`.

## Seeding a bracket

The panel worth verifying needs a bracket with results behind it. Rather than
clicking through 127 matches:

1. Admin → **Auto-Predict** → enable for `qabot`
2. **Run Auto-Predict Now**

That fills and locks a bracket in one step. Points then land the next time
award-points runs.

**The bot is visible on the public leaderboard.** There is no bot filter on the
ranking queries (`src/app/leaderboard/page.tsx`,
`src/app/leaderboard/tournaments/[tournamentId]/page.tsx`,
`src/lib/social/data.ts`), and as of 2026-08-04 that is a deliberate trade —
accepted in exchange for not spending a PR on it. If `qabot` ever becomes
distracting in the standings, one `.not('email', 'like', '%@bot.quietplease.app')`
per ranking query is the whole fix.

## Using it

Ask for the account early in any session that touches signed-in UI, rather than
shipping blind and flagging it afterwards. Sessions persist in the browser, so
`login-link` is only needed when the session has actually lapsed.
