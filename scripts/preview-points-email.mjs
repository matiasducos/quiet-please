/**
 * Points-email preview — renders the real template with no database, no Resend
 * key and no network.
 *
 * The "+pts" email is the one piece of this product that cannot be checked by
 * looking at the site: it is assembled as an HTML string in `email.ts` and the
 * only way it has ever been seen is by scoring a real tournament and mailing
 * real people. That is a bad loop to iterate a layout in. This calls the actual
 * exported `pointsAwardedHtml` — not a copy of it — over fixtures chosen to hit
 * the branches that are easy to get wrong: a tournament with nothing left to
 * play, a tie nobody has picked, a multi-tournament run, a player name
 * carrying an ampersand, a run that scored nothing at all, and a round with
 * more decided ties than the list can hold.
 *
 *   node scripts/preview-points-email.mjs
 *   → writes points-email-preview.html and prints the path
 */

import { execFileSync } from 'child_process'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { resolve, join } from 'path'
import { createRequire } from 'module'
import Module from 'module'

const root = resolve(import.meta.dirname, '..')
// Inside the project rather than in /tmp, so the compiled output can still
// resolve `resend` by walking up to the real node_modules.
const out = join(root, 'node_modules', '.cache', 'points-email-preview')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const tsconfig = join(out, 'tsconfig.json')
writeFileSync(
  tsconfig,
  JSON.stringify({
    compilerOptions: {
      outDir: out,
      rootDir: join(root, 'src'),
      module: 'commonjs',
      target: 'es2022',
      moduleResolution: 'node',
      skipLibCheck: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      jsx: 'react-jsx',
      baseUrl: root,
      paths: { '@/*': ['src/*'] },
    },
    include: [join(root, 'src/lib/email.ts'), join(root, 'src/lib/email-upcoming.ts')],
  }),
)
execFileSync('npx', ['tsc', '-p', tsconfig], { cwd: root, stdio: 'inherit' })

// tsc emits the `@/...` specifiers verbatim — it rewrites types, not requires —
// so the alias is resolved here instead.
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) request = join(out, request.slice(2))
  return originalResolve.call(this, request, ...rest)
}

const require = createRequire(import.meta.url)
const { pointsAwardedHtml, pointsAwardedSubject, EMAIL_RESULTS_CAPACITY } = require(join(out, 'lib/email.js'))
// Pure, and never reached by the render below — it is what decides which side
// of a tie the recipient is on, so it is checked directly.
const { personaliseUpcoming } = require(join(out, 'lib/email-upcoming.js'))

// Round labels are ROUND_LABEL's, not prose: the real email says "R16" and
// "Quarterfinal", and a fixture that said "Round of 16" would have this preview
// quietly disagreeing with the thing it exists to show.
const rounds = (...rows) =>
  rows.map(([round, label, matches, wins, points, results, resultsHidden]) => ({
    round, label, matches, wins, points,
    ...(results ? { results, resultsHidden: resultsHidden ?? 0 } : {}),
  }))
// [winner, loser, picked, points, pickedName] — `picked` is 'winner' | 'loser'
// | null, and null is a pick on a player who never reached the tie, not the
// absence of one. pickedName is who that was, or null when the draw no longer
// contains them.
const ties = (...rows) =>
  rows.map(([winner, loser, picked, points, pickedName]) => ({ winner, loser, picked, points, pickedName: pickedName ?? null }))

const CASES = [
  {
    name: 'One tournament, a complete quarterfinal',
    email: {
      to: 'preview@example.com',
      totalPoints: 380,
      correctPicks: 6,
      unsubscribeToken: 'preview-token',
      tournaments: [
        {
          tournamentId: 't1',
          tournamentName: 'Cincinnati Open',
          flagEmoji: '🇺🇸',
          points: 380,
          rank: { position: 12, total: 91, movement: 4 },
          rounds: rounds(['R16', 'R16', 8, 6, 380, ties(
            // A streak-multiplied tie sorts above a flat one, which is the
            // whole reason the list is ordered by what it paid.
            ['J. Sinner', 'A. Rublev', 'winner', 180],
            ['C. Alcaraz', 'A. Zverev', 'winner', 90],
            ['B. Shelton', 'H. Rune', 'loser', 0],
            // The ordinary case, and the reason it sorts last: the bracket
            // named a player for this tie who lost two rounds earlier.
            ['F. Cerundolo', 'T. Fritz', null, 0, 'D. Medvedev'],
          ), 4]),
          upcoming: {
            roundLabel: 'Quarterfinal',
            // A quarterfinal is four ties in every draw size, and the capacity
            // is four so that it always arrives whole.
            hidden: 0,
            matches: [
              // Picked the underdog: the crowd line and the recipient's own
              // pick name different players, which is the whole point of
              // showing both.
              { a: 'J. Sinner', b: 'C. Alcaraz', favourite: '62% of brackets have Sinner', picked: 'b' },
              { a: 'A. Zverev', b: 'B. Shelton', favourite: '4% of brackets have Zverev', picked: 'a' },
              // No pick, and the branch that must never render as a 50/50.
              { a: 'H. Rune', b: 'F. Cerundolo', favourite: null, picked: null },
              { a: 'T. Fritz', b: 'D. Medvedev', favourite: '38% of brackets have Fritz', picked: 'a' },
            ],
          },
        },
      ],
    },
  },
  {
    name: 'Nothing left to play — the block is absent, not empty',
    email: {
      to: 'preview@example.com',
      totalPoints: 2000,
      correctPicks: 1,
      unsubscribeToken: 'preview-token',
      tournaments: [
        {
          tournamentId: 't2',
          tournamentName: 'US Open',
          flagEmoji: '🇺🇸',
          points: 2000,
          rank: { position: 1, total: 91, movement: 7 },
          rounds: rounds(['F', 'Final', 1, 1, 2000, ties(['J. Sinner', 'C. Alcaraz', 'winner', 2000]), 0]),
          upcoming: null,
        },
      ],
    },
  },
  {
    name: 'Two tournaments — an early round that overflows, and one finished',
    email: {
      to: 'preview@example.com',
      totalPoints: 545,
      correctPicks: 9,
      unsubscribeToken: 'preview-token',
      tournaments: [
        {
          tournamentId: 't3',
          tournamentName: 'Mubadala Citi DC Open',
          flagEmoji: '🇺🇸',
          points: 145,
          rank: { position: 40, total: 91, movement: -3 },
          rounds: rounds(['R32', 'R32', 6, 3, 45], ['R16', 'R16', 4, 2, 100]),
          upcoming: {
            roundLabel: 'R32',
            // The branch that used to be silent: an early round is far bigger
            // than the block, and the heading names the round.
            hidden: 12,
            // Ampersand on purpose: names come from a hand-entered draw, and
            // this is the character that would break the markup unescaped.
            matches: [
              { a: 'M. Navarro & Co', b: 'T. Paul', favourite: '6% of brackets have Paul', picked: 'a' },
              // No pick, but the field has one: the nudge and the crowd line
              // have to sit on the same row without either being dropped.
              { a: 'L. Musetti', b: 'K. Khachanov', favourite: '71% of brackets have Musetti', picked: null },
            ],
          },
        },
        {
          tournamentId: 't4',
          tournamentName: 'National Bank Open',
          flagEmoji: '🇨🇦',
          points: 400,
          rank: null,
          rounds: rounds(['QF', 'Quarterfinal', 4, 2, 400]),
          upcoming: null,
        },
      ],
    },
  },
  {
    // The mail that never used to be sent at all. Everything here is a zero,
    // and every zero has to read as a result rather than as a broken template:
    // no "+0 pts", no green, and a reason for the mail to exist in the round
    // line and the block underneath it.
    name: 'A losing week — nothing scored, and the email still goes',
    email: {
      to: 'preview@example.com',
      totalPoints: 0,
      correctPicks: 0,
      unsubscribeToken: 'preview-token',
      username: 'preview',
      tournaments: [
        {
          tournamentId: 't5',
          tournamentName: 'Winston-Salem Open',
          flagEmoji: '🇺🇸',
          points: 0,
          // A standing that only went one way. Scoring nothing while the field
          // scores is exactly when the rank line has something to say.
          rank: { position: 63, total: 91, movement: -11 },
          rounds: rounds(['R32', 'R32', 5, 0, 0, ties(
            ['L. Musetti', 'M. Navarro & Co', 'loser', 0],
            ['A. de Minaur', 'K. Khachanov', 'loser', 0],
            // The rarer null: a resolved qualifier rewrote the slot, so the
            // pick names a player the draw no longer contains at all and there
            // is nobody to name.
            ['F. Tiafoe', 'A. Michelsen', null, 0],
          ), 2]),
          upcoming: {
            roundLabel: 'R16',
            hidden: 4,
            matches: [
              { a: 'L. Musetti', b: 'A. de Minaur', favourite: '58% of brackets have Musetti', picked: 'b' },
              { a: 'K. Khachanov', b: 'F. Tiafoe', favourite: null, picked: null },
            ],
          },
        },
      ],
    },
  },
]

const sections = CASES.map(
  c => `
    <section>
      <h2>${c.name}</h2>
      <p class="subject">Subject: ${pointsAwardedSubject(c.email)}</p>
      <div class="frame">${pointsAwardedHtml(c.email)}</div>
    </section>`,
).join('')

const file = join(root, 'points-email-preview.html')
writeFileSync(
  file,
  `<!doctype html>
<meta charset="utf-8">
<title>Points email preview</title>
<style>
  body { margin: 0; padding: 24px; background: #e9e6df; font-family: ui-sans-serif, system-ui, sans-serif; }
  section { margin: 0 auto 40px; max-width: 560px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #4a4a4a; margin: 0 0 4px; }
  .subject { font: 12px ui-monospace, monospace; color: #6b6b6b; margin: 0 0 10px; }
  /* 500px is the template's own max-width; the frame is what a phone gives it. */
  .frame { width: 500px; max-width: 100%; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
</style>
${sections}
`,
)

// ── Assertions ───────────────────────────────────────────────────────────────
// A preview nobody opens rots. These are the three facts about the block that
// would be wrong silently — a missing block renders as nothing, and an
// unescaped name renders as *almost* the right thing.
const BLOCK = 'Up next &#8212;'
const rendered = CASES.map(c => ({ name: c.name, html: pointsAwardedHtml(c.email) }))
const failures = []
let checksRun = 0
const check = (label, ok) => {
  checksRun++
  if (!ok) failures.push(label)
}

check(
  'a tournament with `upcoming` renders exactly one block',
  rendered[0].html.split(BLOCK).length - 1 === 1,
)
check(
  'a tournament with `upcoming: null` renders no block at all — not an empty one',
  !rendered[1].html.includes(BLOCK),
)
check(
  'in a two-tournament email only the forward-looking one carries a block',
  rendered[2].html.split(BLOCK).length - 1 === 1,
)
// The honest-silence rule, asserted as what it actually is: a tie with no
// sample must not carry a percentage. It used to be checked by looking for a
// sentence, which stopped being the right test when the nudge replaced it.
check(
  'a tie nobody has picked quotes no share at all',
  /H\. Rune[\s\S]{0,400}?<\/tr>/.test(rendered[0].html) &&
    !/H\. Rune[\s\S]{0,400}?\d+% of brackets/.test(rendered[0].html),
)
// Scoped to the up-next block since the decided-ties list arrived: clay + "You
// picked" is correct THERE (a pick that lost) and wrong here (a pick still to
// be played is never in the losing colour).
const upNextOf = html => html.slice(html.indexOf(BLOCK))
check(
  'an unpicked tie says so, in clay',
  !/color:#b3392c;">You picked/.test(upNextOf(rendered[0].html)) &&
    rendered[0].html.includes('You haven&rsquo;t picked a winner'),
)
check('the nudge and the crowd line coexist', /You haven&rsquo;t picked a winner<\/span> &middot; 71% of brackets have Musetti/.test(rendered[2].html))
check('a picked tie carries no nudge', !/C\. Alcaraz[\s\S]{0,200}?haven&rsquo;t picked/.test(rendered[0].html))
check('player names are escaped', rendered[2].html.includes('M. Navarro &amp; Co'))
check("the recipient's own player is named in words, not only bolded", rendered[0].html.includes('You picked C. Alcaraz'))
check('the pick and the crowd line coexist when they name different players', /You picked C. Alcaraz<\/span> &middot; 62% of brackets have Sinner/.test(rendered[0].html))
// One shape, everywhere. A head count on its own was the old small-sample
// fallback, and it fired on most later-round ties — see favouriteLabel.
check(
  'every crowd line quotes a percentage',
  rendered.flatMap(r => r.html.match(/&middot; ([^<]*brackets[^<]*)/g) ?? []).every(l => /\d+%/.test(l)),
)
// The matchup line stays plain on both sides — the pick is stated underneath,
// and marking it twice was redundant.
check('neither player is emphasised in the matchup line', !/<strong>(C\. Alcaraz|J\. Sinner)<\/strong>/.test(rendered[0].html))

check('a complete round discloses nothing', !rendered[0].html.includes('more match'))
check('an early round says how many ties it left out', rendered[2].html.includes('+ 12 more matches in this round'))
check('the overflow line is singular at one', /\+ 1 more match in this round/.test(pointsAwardedHtml({
  ...CASES[0].email,
  tournaments: [{ ...CASES[0].email.tournaments[0], upcoming: { ...CASES[0].email.tournaments[0].upcoming, hidden: 1 } }],
})))

// ── The decided-ties list ────────────────────────────────────────────────────
// The block that says what actually happened. Every failure here is a
// misattribution — the wrong player named as the winner, or as the recipient's
// pick — which looks exactly as plausible as the truth.
const won = rendered[0].html
check('a decided tie names winner and loser in that order', /J\. Sinner <span[^>]*>def\.<\/span> A\. Rublev/.test(won))
check('a correct pick names the player, in the scoring green', /color:#1a6b3c;">You picked J\. Sinner<\/span>/.test(won))
check('and states what that tie paid', /You picked J\. Sinner<\/span> &middot; <span[^>]*>\+180 pts/.test(won))
check('a losing pick names the player the recipient had, not the winner', /color:#b3392c;">You picked H\. Rune<\/span>/.test(won))
check('a losing tie quotes no figure at all', !/You picked H\. Rune<\/span> &middot;/.test(won))
check('a pick on a player who never got there names them and says so', won.includes('You picked D. Medvedev, who never reached this match'))
check('a pick the draw no longer contains names nobody', rendered[3].html.includes('Your pick is no longer in the draw'))
check('what paid sorts above what did not', won.indexOf('You picked J. Sinner') < won.indexOf('You picked H. Rune'))
check(
  'a tie they had a runner in sorts above one their player never reached',
  won.indexOf('You picked H. Rune') < won.indexOf('who never reached this match'),
)
check('the ties the cap left out are disclosed', won.includes('+ 4 more decided in this round'))
check(
  'that disclosure is worded apart from the up-next one, which sits in the same block',
  won.includes('+ 4 more decided in this round') && !/\+ 4 more matches in this round/.test(won),
)
check('a round with nothing left over discloses nothing', !rendered[1].html.includes('more decided in this round'))
check('a round carrying no list still renders its summary line', 
  !rendered[2].html.includes('def.') && rendered[2].html.includes('6 matches played (3 winners)'))
check('names in the list are escaped', rendered[3].html.includes('You picked M. Navarro &amp; Co'))
// The cap is applied by the cron, not the template, so a fixture that exceeded
// it would be previewing an email that cannot be sent.
check(
  'no fixture lists more ties than the cron would send',
  CASES.every(c => c.email.tournaments.every(t => t.rounds.every(r => (r.results ?? []).length <= EMAIL_RESULTS_CAPACITY))),
)

// ── The zero-point email ─────────────────────────────────────────────────────
// Every one of these fails silently: the mail still sends, it just reads as a
// bug ("+0 points earned") to someone who did nothing wrong but lose.
const zero = rendered[3].html
check('a zero run leads with a result, not a plus sign', zero.includes('No points this time.') && !zero.includes('+0 points'))
check('its tournament line is a plain 0, unsigned', />\s*0 pts\s*</.test(zero) && !zero.includes('+0 pts'))
check('and it is not painted in the scoring green', !/color:#1a6b3c;white-space:nowrap;">\s*0 pts/.test(zero))
// The count of decided matches replaces the correct-pick count rather than
// joining it: "0 correct picks" under a headline that already says no points
// is the same zero said twice, and the round line below says it a third time.
check('it says how many matches were decided, which is why it arrived', zero.includes('5 matches played'))
check('and does not also count the correct picks it plainly has none of', !zero.includes('0 correct picks'))
check('the forward-looking block survives — it is the actionable half', zero.includes(BLOCK))
check('the rank line still runs, downward', zero.includes('down 11'))
check(
  'the subject names the result rather than a zero total',
  pointsAwardedSubject(CASES[3].email) === 'No points this time — Winston-Salem Open',
)
check(
  'a scored email is untouched by any of that',
  pointsAwardedSubject(CASES[0].email) === '+380 pts — Cincinnati Open' &&
    rendered[0].html.includes('+380 points earned.') &&
    !rendered[0].html.includes('matches played ·'),
)
// Per-type opt-out, like the other two mails that reach the whole field. A
// "stop telling me I lost" that only exists as "stop all email" is the one
// that gets answered with the spam button instead.
check('the footer offers points emails specifically', zero.includes('Unsubscribe from points awarded emails'))
check('and deep-links the preferences panel when the username is known', zero.includes('/profile/preview#email-preferences'))

// ── personaliseUpcoming ──────────────────────────────────────────────────────
// Every exclusion here is silent when it goes wrong: the wrong player's name
// simply appears, and it looks exactly as plausible as the right one.
const plan = {
  roundLabel: 'QF',
  hidden: 0,
  matches: [{ id: 'm1', a: 'J. Sinner', b: 'C. Alcaraz', aId: 'p-sinner', bId: 'p-alcaraz', favourite: null }],
}
const sideOf = bracket => personaliseUpcoming(plan, bracket).matches[0].picked

check('a pick on the first player reads as side a', sideOf({ picks: { m1: 'p-sinner' } }) === 'a')
check('a pick on the second player reads as side b', sideOf({ picks: { m1: 'p-alcaraz' } }) === 'b')
check('no bracket at all is not a pick', sideOf(null) === null)
check('a bracket with no pick on this tie is not a pick', sideOf({ picks: { m2: 'p-sinner' } }) === null)
check(
  'a pick naming someone the draw has overtaken is stale, not a vote for either side',
  sideOf({ picks: { m1: 'qualifier-3' } }) === null,
)
check(
  'a pick placed after the match was locked cannot score, so it is not shown',
  sideOf({ picks: { m1: 'p-sinner' }, lockedPicks: ['m1'] }) === null,
)
check(
  'a lock on a DIFFERENT match does not suppress this one',
  sideOf({ picks: { m1: 'p-sinner' }, lockedPicks: ['m2'] }) === 'a',
)

for (const f of failures) console.error(`FAIL  ${f}`)
console.log(`\n${failures.length ? `${failures.length} FAILED` : `${checksRun} checks passed`}`)
console.log(`Wrote ${file}`)
if (failures.length) process.exit(1)
