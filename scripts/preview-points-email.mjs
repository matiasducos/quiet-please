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
 * play, a tie nobody has picked, a multi-tournament run, and a player name
 * carrying an ampersand.
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
const { pointsAwardedHtml, pointsAwardedSubject } = require(join(out, 'lib/email.js'))
// Pure, and never reached by the render below — it is what decides which side
// of a tie the recipient is on, so it is checked directly.
const { personaliseUpcoming } = require(join(out, 'lib/email-upcoming.js'))

// Round labels are ROUND_LABEL's, not prose: the real email says "R16" and
// "Quarterfinal", and a fixture that said "Round of 16" would have this preview
// quietly disagreeing with the thing it exists to show.
const rounds = (...rows) => rows.map(([round, label, matches, wins, points]) => ({ round, label, matches, wins, points }))

const CASES = [
  {
    name: 'One tournament, three curated ties',
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
          rounds: rounds(['R16', 'R16', 8, 6, 380]),
          upcoming: {
            roundLabel: 'Quarterfinal',
            matches: [
              // Picked the underdog: the crowd line and the recipient's own
              // pick name different players, which is the whole point of
              // showing both.
              { a: 'J. Sinner', b: 'C. Alcaraz', favourite: '62% of brackets have Sinner', picked: 'b' },
              { a: 'A. Zverev', b: 'B. Shelton', favourite: '4% of brackets have Zverev', picked: 'a' },
              // No pick, and the branch that must never render as a 50/50.
              { a: 'H. Rune', b: 'F. Cerundolo', favourite: null, picked: null },
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
          rounds: rounds(['F', 'Final', 1, 1, 2000]),
          upcoming: null,
        },
      ],
    },
  },
  {
    name: 'Two tournaments — one forward-looking, one finished',
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
            roundLabel: 'Semifinal',
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
check('an unpicked tie says so, in clay', /color:#b3392c;">You picked/.test(rendered[0].html) === false && rendered[0].html.includes('You haven&rsquo;t picked a winner'))
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

// ── personaliseUpcoming ──────────────────────────────────────────────────────
// Every exclusion here is silent when it goes wrong: the wrong player's name
// simply appears, and it looks exactly as plausible as the right one.
const plan = {
  roundLabel: 'QF',
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
