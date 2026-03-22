# Leagues QA Checklist

## Member Visibility (RLS fix — migration 020)
- [x] Create a league, share code with a friend
- [x] Friend joins → both users can see each other in the member list
- [x] Refresh the page → members persist (no stale cache)

## Public vs Private Leagues (migration 021)
- [x] Create a **private** league → invite code card shows, not visible on browse page
- [x] Create a **public** league → appears on `/leagues/browse`, no invite code shown
- [x] Public league: another user can join via "Join" button (no code needed)
- [x] Private league: another user needs invite code to join
- [x] 🔒/🌐 icon shows on league cards in `/leagues` list

## League Settings Page
- [x] Owner sees "Edit settings" link → full edit form (name, description, visibility, tournament types)
- [x] Non-owner sees "Settings" link → read-only view (greyed out inputs, no save/remove/delete)
- [x] Owner can edit name, description, visibility, tournament types → saves correctly
- [x] Owner can remove members from settings page
- [x] Owner cannot remove themselves
- [x] Leave league button works from settings page
- [x] Delete league in danger zone works (owner only)
- [x] Non-owners do NOT see danger zone or remove buttons

## Member Count on League Cards
- [x] `/leagues` list shows "X members" next to points on each card
- [x] Count updates after someone joins or leaves

## Tournament Filtering (migration 021)
- [x] Create league with specific tournament types selected → "Counting: ..." label shows
- [x] Create league with no types selected → "All tournament types count" (no label)
- [x] Change tournament filter via settings → saves correctly
- [x] Points are correct after recalculation (migration 023 fixed drift)

## Leave League (migration 022)
- [x] As regular member: "Leave league" → removed, redirected to `/leagues`
- [x] As owner with other members: "Leave league" → ownership transfers to longest member
- [x] As sole member: "Leave league" → league auto-deleted
- [x] Confirmation dialog shows correct context (owner transfer / league deletion)

## Browse Page Filters
- [ ] Search by league name → instant filter
- [ ] Search by description text → matches
- [ ] Click tournament type chip → filters to matching leagues
- [ ] Clear search/filter → all leagues show again
- [ ] "View" button on leagues you're already in, "Join" button on others

## Invite Link
- [ ] Private league: "Copy invite link" button visible to all members (single location, top-right)
- [ ] Click "Copy invite link" → clipboard has `/leagues/join?code=XXXXXXXX`
- [ ] Open that URL → join page has code pre-filled
- [ ] Public leagues: no invite code card shown

## Join Notifications (migration 022)
- [x] Someone joins your league via code → you get a notification
- [x] Someone joins your public league → you get a notification
- [x] Notification includes joiner's username and league name

## Expandable Leaderboard Breakdown
- [ ] Click a member with points → expands per-tournament breakdown
- [ ] Breakdown shows flag + tournament name + ATP/WTA badge + points
- [ ] Click a tournament name in breakdown → goes to league tournament results page
- [ ] Works on global leaderboard too → links to `/leaderboard/tournaments/[id]`

## Tournament Results Pages
- [ ] `/leagues/[id]/tournaments/[tid]` — shows tournament header + ranked league members
- [ ] `/leaderboard/tournaments/[tid]` — shows tournament header + ranked global players (top 50)
- [ ] ACCURACY column shows correct/total picks
- [ ] RATE column shows percentage
- [ ] POINTS column shows +points in green
- [ ] LIVE badge shows for in-progress tournaments
- [ ] "See results" button on tournament detail page (in-progress + completed only)

## Tournaments Section on League Page
- [ ] Tournament cards appear below leaderboard (only tournaments where members participated)
- [ ] Cards are NOT clickable (no hover effect) — only "See results" button navigates
- [ ] Respects league tournament type filter
- [ ] Only shows this season (52-week window)
- [ ] In-progress tournaments show "In progress" status badge

## League Points Accuracy (migration 023)
- [ ] All leagues show correct points matching global leaderboard
- [ ] Points recalculate correctly after cron run
- [ ] Leagues with tournament type filters show filtered points only

## Activity Feed
- [ ] Shows max 15 items on league detail page
- [ ] "See all" link appears when more than 15 items exist
- [ ] `/leagues/[id]/activity` shows full history

## Bugs Fixed During QA
- [x] `league_member_joined` notification rendering (was showing raw type string)
- [x] Added `league_member_left` and `league_deleted` notification types + rendering
- [x] Activity feed now respects league tournament type filter
- [x] Activity feed shows flag emoji on tournament locations
- [x] League points calculate on join/create via targeted `recalculate_member_points()`
- [x] Create league button uses `useFormStatus` for reliable loading state
