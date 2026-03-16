-- Migration: 004_practice_predictions
-- Adds is_practice flag to predictions.
-- Practice predictions are for completed tournaments: immediately scored, never
-- added to users.total_points or league_members.total_points.

alter table public.predictions
  add column if not exists is_practice boolean not null default false;
