-- Migration: 110_bracket_view_default_full
-- New accounts open a bracket on the whole draw instead of the round list.
--
-- 108 shipped the full-draw view as an opt-in experiment, so the column
-- defaulted to 'rounds'. The draw is now the default layout. Only the default
-- changes: existing rows keep the value they hold, so nobody who picked the
-- list is moved off it. (Rows that took 'rounds' from the old default are
-- indistinguishable from an explicit choice, so they are left alone too.)

alter table public.users
  alter column bracket_view set default 'full';
