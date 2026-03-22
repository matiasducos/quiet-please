# Leagues Feature TODO

## 1. Public vs Private Leagues ✅
- [x] Add `is_public` boolean column to `leagues` table (default `false`) — migration `021`
- [x] Update league creation form with Public/Private toggle
- [x] Public leagues: anyone can join without an invite code
- [x] Private leagues: join only via invite code (current behavior)
- [x] Add a "Browse Public Leagues" discovery page at `/leagues/browse`
- [x] Public leagues show title + description (theme is communicated there)
- [x] Update join flow: public leagues get a "Join" button, private leagues keep the code input
- [x] Update RLS: public leagues readable by all authenticated users, private leagues only by members

## 2. Admin Can Kick Members ✅
- [x] Add DELETE policy on `league_members` for league owners — migration `021`
- [x] Add "Remove" button next to each member on the league detail page (visible only to owner)
- [x] Confirmation dialog before kicking
- [x] Kicked users CAN rejoin later (via code or public access) — no ban mechanism
- [x] Server action: `kickMember(leagueId, userId)` — owner-only, revalidates paths
- [x] Handle edge case: owner cannot kick themselves

## 3. Member Count on League Cards ✅
- [x] Show member count on each league card in the `/leagues` list (e.g. "5 members")
- [x] Display next to the points, separate from the rank display
- [x] Count is accurate (fixed with RLS migration `020_fix_league_rls`)

## 4. Tournament Filtering per League ✅
- [x] Add `allowed_tournament_types` column to `leagues` table (text array, nullable = all types) — migration `021`
- [x] Tournament types: `grand_slam`, `masters_1000`, `500`, `250` (from `tournaments.category` check constraint)
- [x] Add multiselect UI on league creation form to pick which tournament types count
- [x] `TournamentSettings` component on league detail page for admin to change the filter after creation
- [x] Changes apply going forward only — no retroactive point recalculation
- [x] Cron job (`award-points`) checks league's `allowed_tournament_types` before adding points to `league_members.total_points`
- [x] Show the active tournament filter on the league detail page (so members know what counts)

---

## Completed (infrastructure)
- [x] Fix league member visibility bug (migration `020_fix_league_rls.sql` — replaced self-referencing RLS with `SECURITY DEFINER` function)
- [x] Add `revalidatePath` to join/create league server actions
- [x] Add error logging to league detail page queries

---

## Next steps / future ideas
- [ ] Leave league — allow members to remove themselves (needs DELETE policy for `auth.uid() = user_id`)
- [ ] League search/filter on browse page (search by name, filter by tournament type)
- [ ] League invite link (shareable URL that auto-fills the code)
- [ ] Notification when someone joins your league
- [ ] Season reset — option to reset league standings at the start of a new season
