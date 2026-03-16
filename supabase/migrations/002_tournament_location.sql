-- Migration: 002_tournament_location
-- Description: Add display-only location fields to tournaments

alter table public.tournaments
  add column if not exists location   text,   -- e.g. "Hamburg, Germany"
  add column if not exists flag_emoji text;   -- e.g. "🇩🇪"
