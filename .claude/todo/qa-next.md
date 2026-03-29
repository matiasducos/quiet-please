# QA — Prediction Mode Toggle

## QA Checklist

1. Go to `/admin` → Settings tab
   - [ ] One option is always pre-selected on load (never blank)
   - [ ] Switching selection + hitting Save persists after full refresh
   - [ ] Description says "Does not affect challenges"
   - [ ] Impact note says "tournament predictions and auto-predict only"

2. Set toggle to **pre-tournament only** in admin, then:
   - [ ] `/challenges/create` — in-progress tournaments still appear
   - [ ] `/c/[code]` (anonymous challenge) for in-progress tournament — opponent can still submit picks
   - [ ] `/challenges/new` — in-progress tournaments still show as options
   - [ ] Challenge "Make your picks →" button on challenge detail page → goes to bracket (not redirected away)

3. With toggle set to **pre-tournament only**:
   - [ ] Visit an in-progress tournament's predict page (standalone, no challenge param) — redirected away (predictions blocked)
   - [ ] Tournament page shows "This tournament is already underway. Predictions are closed." for in_progress
