-- Migration: 108_users_bracket_view
-- Which layout a user reads a bracket in: the round-by-round list, or the whole
-- draw as one tree.
--
-- The full-draw view is an experiment offered next to the list, not a
-- replacement, so the list stays the default for everyone and only an explicit
-- switch moves a user off it. Stored on the account rather than in the browser
-- because a browser store would be a new non-essential client-side store to gate
-- on consent and document in /privacy — and because a choice made on a phone
-- should still hold on a laptop.
--
-- No new policy: "Users can update their own profile" (001) already lets a user
-- write their own row, and the check constraint keeps the value to the two
-- layouts the app knows how to draw.

alter table public.users
  add column if not exists bracket_view text not null default 'rounds'
  constraint users_bracket_view_check check (bracket_view in ('rounds', 'full'));
