/**
 * The FAQ, as data.
 *
 * Content lives here rather than in JSX for one reason: the page renders each
 * answer twice — once as HTML for people, once as plain text inside FAQPage
 * structured data for crawlers. Written as markup, those two would be
 * maintained separately and would drift, and a structured-data answer that
 * disagrees with the visible one is the specific thing Google penalises.
 *
 * Blocks are deliberately few and dull. Anything that cannot be said with a
 * paragraph, a list or a table probably belongs on the page it describes, not
 * in a reference.
 *
 * ## Adding a question
 *
 * Append to the right section's `questions`. Give it a stable `id` — ids are
 * public URLs (`/faq#streak-multiplier`) and other pages link to them, so
 * renaming one silently breaks those links. Everything else (nav, anchors,
 * structured data, the on-page contents list) is derived.
 *
 * ## Keeping it true
 *
 * Every number here is a claim about live scoring code, and prose does not fail
 * a typecheck. The points table below is `POINTS_TABLE` + `WINNER_POINTS` from
 * `src/lib/tennis/points.ts`; `scripts/verify-faq-numbers.mjs` re-reads that
 * module and fails if the two disagree. Run it after touching either.
 */

export type FaqBlock =
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'table'; head: string[]; rows: string[][]; caption?: string }

export interface FaqQuestion {
  /** Stable anchor — part of the public URL. Never rename in place. */
  id: string
  question: string
  answer: FaqBlock[]
}

export interface FaqSection {
  id: string
  title: string
  /** One line under the section heading. Optional. */
  intro?: string
  questions: FaqQuestion[]
}

/**
 * Points per correct pick, by tournament tier.
 *
 * The final pays the champion's points, not the row `POINTS_TABLE` holds for
 * 'F' — `award-points` passes `isWinner: true` for every 'F' result, so
 * `getPointsForRound` returns `WINNER_POINTS`. This table states what is
 * actually paid.
 */
const POINTS_ROWS: string[][] = [
  ['Round of 128', '10',  '10',   '—',   '—'],
  ['Round of 64',  '45',  '25',   '—',   '—'],
  ['Round of 32',  '90',  '45',   '25',  '13'],
  ['Round of 16',  '180', '90',   '50',  '25'],
  ['Quarterfinal', '360', '180',  '100', '50'],
  ['Semifinal',    '720', '360',  '200', '100'],
  ['Final',        '2,000', '1,000', '500', '250'],
]

export const FAQ_SECTIONS: FaqSection[] = [
  {
    id: 'points',
    title: 'Points',
    intro: 'How a correct pick turns into a score.',
    questions: [
      {
        id: 'how-points-work',
        question: 'How do I earn points?',
        answer: [
          { type: 'p', text: 'Every match you call correctly pays points. Nothing else does — there are no points for entering, for filling in a full bracket, or for how close you came.' },
          { type: 'p', text: 'How much a match pays depends on how deep it is in the draw and how big the tournament is. A first-round match at a Masters 1000 is worth 10 points; the final of a Grand Slam is worth 2,000.' },
          { type: 'p', text: 'Points land after the result is entered, and you get an email summarising what you earned unless you have turned those off.' },
        ],
      },
      {
        id: 'points-table',
        question: 'How many points is each round worth?',
        answer: [
          { type: 'p', text: 'Per correct pick, before any multiplier:' },
          {
            type: 'table',
            head: ['Round', 'Grand Slam', 'Masters 1000 / WTA 1000', '500', '250'],
            rows: POINTS_ROWS,
            caption: 'A dash means that tier has no such round.',
          },
          { type: 'p', text: 'Calling the champion is worth far more than anything else on the board. Getting the final right at a Grand Slam pays more than the entire first four rounds combined.' },
        ],
      },
      {
        id: 'points-expiry',
        question: 'Do my points last forever?',
        answer: [
          { type: 'p', text: 'No. Points expire 364 days after the tournament they came from started, so your ranking is always a picture of the last 52 weeks — the same rolling window the real ATP and WTA rankings use.' },
          { type: 'p', text: 'This means a strong season has to be defended. Points you earned at last year’s US Open drop off your total around this year’s.' },
        ],
      },
      {
        id: 'wrong-picks',
        question: 'Do I lose points for getting a match wrong?',
        answer: [
          { type: 'p', text: 'Never. A wrong pick scores zero and costs you nothing. The only thing it costs is your streak — see the multiplier below.' },
        ],
      },
    ],
  },

  {
    id: 'multiplier',
    title: 'The streak multiplier',
    intro: 'The difference between a good bracket and a great one.',
    questions: [
      {
        id: 'streak-multiplier',
        question: 'What is the streak multiplier?',
        answer: [
          { type: 'p', text: 'Back the same player round after round and each correct call on them is worth more than the last. The multiplier is one, plus the number of consecutive earlier rounds in which you correctly picked that same player.' },
          { type: 'p', text: 'Say you pick one player to win the whole thing at a 250 event and they do:' },
          {
            type: 'table',
            head: ['Round', 'Base', 'Multiplier', 'You earn'],
            rows: [
              ['Round of 32', '6', '×1', '6'],
              ['Round of 16', '13', '×2', '26'],
              ['Quarterfinal', '29', '×3', '87'],
              ['Semifinal', '45', '×4', '180'],
              ['Final', '250', '×5', '1,250'],
            ],
          },
          { type: 'p', text: 'That run is worth 1,549 points instead of 343. Reading one player correctly through a whole tournament is the single biggest thing you can do for your score.' },
          { type: 'p', text: 'Byes are invisible to the streak. A player who gets a free pass into round two does not break your run, and does not extend it either.' },
        ],
      },
      {
        id: 'streak-breaks',
        question: 'What breaks a streak?',
        answer: [
          { type: 'p', text: 'Four things end a run:' },
          {
            type: 'ul',
            items: [
              'Your player loses.',
              'You picked someone else in an earlier round — the run has to be the same player, unbroken.',
              'The pick was not locked. Only committed picks build a streak.',
              'You made the pick after that match had already been locked by the organiser. Late picks score nothing and break the chain.',
            ],
          },
          { type: 'p', text: 'A broken streak is not a penalty. The next correct pick simply starts again at ×1.' },
        ],
      },
      {
        id: 'multiplier-requires-lock',
        question: 'Why did I only get single points for a correct pick?',
        answer: [
          { type: 'p', text: 'Almost always because the pick was not locked when the match was played. Base points are unconditional — every correct call pays. The multiplier is the part you have to commit for.' },
          { type: 'p', text: 'A pick counts as committed if you locked it individually, locked its round, or locked your whole bracket, and you did so before the match was decided. Saving a draft is not committing: you could still have changed it.' },
        ],
      },
    ],
  },

  {
    id: 'locking',
    title: 'Locking your picks',
    intro: 'Three ways to commit, and what each one costs you.',
    questions: [
      {
        id: 'why-lock',
        question: 'Why would I lock my picks?',
        answer: [
          { type: 'p', text: 'Two reasons.' },
          {
            type: 'ul',
            items: [
              'Locked picks earn the streak multiplier. Unlocked ones still score, at single value.',
              'A locked bracket becomes visible — it appears on your profile, on your public picks page, in your friends’ activity feed and in your leagues. An unlocked one is private to you.',
            ],
          },
          { type: 'p', text: 'In a friends challenge there is a third: neither of you can see the other’s picks or score until you have both locked.' },
        ],
      },
      {
        id: 'lock-a-round',
        question: 'What does locking a round do?',
        answer: [
          { type: 'p', text: 'It commits every pick in that one round and leaves the rest of your bracket completely editable. Those picks start earning the multiplier immediately; you carry on predicting the later rounds as the draw opens up.' },
          { type: 'p', text: 'This is the option to reach for while a tournament is running. It forfeits nothing: matches in that round you have not picked yet are left alone, so you can still fill them in later.' },
          { type: 'p', text: 'Use the button beside Save draft on the bracket — it names the round you are looking at, and how many picks it would commit.' },
        ],
      },
      {
        id: 'lock-all-picks',
        question: 'What does "Lock all picks" do, and can I undo it?',
        answer: [
          { type: 'p', text: 'It commits your whole bracket at once. Every pick becomes final, the bracket becomes visible, and everything you have picked starts earning the multiplier.' },
          { type: 'p', text: 'Yes, you can undo it. An Unlock bracket button sits at the top of your locked bracket for as long as the tournament is still open for predictions, and you can use it as often as you need.' },
          { type: 'p', text: 'Unlocking has one cost: the multiplier is earned by committing a pick before its match is played, so reopening the bracket gives that commitment back on every match still to come. Picks on matches that have already been played keep theirs — you made those in time, and they cannot be changed anyway.' },
          { type: 'p', text: 'While it stays locked, the bracket also gives up every round you have not filled in yet. Later rounds keep opening as results come in, so a bracket locked at the quarterfinals scores nothing in the quarters, semis or final until you unlock it and pick them. The button tells you exactly which rounds you would be giving up before you confirm. If a tournament is still running, locking the round is usually what you want instead.' },
        ],
      },
      {
        id: 'lock-one-pick',
        question: 'Can I lock a single match?',
        answer: [
          { type: 'p', text: 'Yes — every match has a Lock pick button. It commits that one call and nothing else, and that pick then counts toward the multiplier.' },
          { type: 'p', text: 'Useful when you are certain about one match and still thinking about the rest of the round.' },
        ],
      },
      {
        id: 'unlocked-still-scores',
        question: 'If I never lock anything, do I still score?',
        answer: [
          { type: 'p', text: 'Yes. Every correct pick pays its base points whether you locked it or not, and those points count toward your ranking and your leagues exactly the same way.' },
          { type: 'p', text: 'What you give up is the multiplier, and being visible to anyone else. On a deep run those two are most of the score.' },
        ],
      },
      {
        id: 'locked-match-changed',
        question: 'A match started before I picked it. What happens?',
        answer: [
          { type: 'p', text: 'You can still pick it, and the bracket will use the real winner to fill the next round so you are not stuck. But a pick made after the organiser locked that match scores nothing and breaks your streak there.' },
          { type: 'p', text: 'Matches already played are shown with their actual result and cannot be picked at all.' },
        ],
      },
    ],
  },

  {
    id: 'predicting',
    title: 'Making predictions',
    intro: 'Filling in a bracket, and what happens when you are late to one.',
    questions: [
      {
        id: 'when-can-i-predict',
        question: 'When can I fill in a bracket?',
        answer: [
          { type: 'p', text: 'From the moment the draw is published, and you can keep going while the tournament is being played. Matches that have already been played are shown with their real result and cannot be picked; everything still to come is open.' },
          { type: 'p', text: 'So arriving late is not fatal. Join at the quarterfinals and you simply pick from the quarterfinals on — you miss the points from the earlier rounds, not the tournament.' },
        ],
      },
      {
        id: 'change-my-picks',
        question: 'Can I change a pick after saving?',
        answer: [
          { type: 'p', text: 'Yes, for as long as the match has not been played and you have not locked it. Save draft keeps your bracket editable; locking is what makes a pick final.' },
          { type: 'p', text: 'Once a match has a result, its pick is frozen whatever you do — there is nothing left to decide.' },
        ],
      },
      {
        id: 'later-rounds',
        question: 'How do I pick a later round when I do not know who is in it?',
        answer: [
          { type: 'p', text: 'The bracket fills the next round in for you. A slot shows the real winner once that match has been played, and your own pick until then — so the quarterfinal you are looking at is built from the calls you already made.' },
          { type: 'p', text: 'That is also why a wrong pick early on does not stop you: the real result takes over, and you carry on picking from the players who are genuinely still in.' },
        ],
      },
      {
        id: 'byes',
        question: 'What about byes and qualifiers?',
        answer: [
          { type: 'p', text: 'A bye is not a match, so there is nothing to pick — the player advances for free and it neither builds nor breaks your streak.' },
          { type: 'p', text: 'A slot reading "Qualifier" is a place in the draw whose player has not been decided yet. Once qualifying finishes the real name appears.' },
        ],
      },
      {
        id: 'auto-predict',
        question: 'Can brackets be filled in for me?',
        answer: [
          // The availability gate leads, because it decides whether the rest of
          // the answer is any use — auto-predict is enabled per account
          // (`config.enabled`), and the page itself only says "contact the
          // admin" without naming anyone.
          { type: 'p', text: 'Yes, with auto-predictions — though it is not switched on by default. If you would like it enabled for your account, email support@quietplease.app and ask.' },
          { type: 'p', text: 'Once you have it, you set it up from your profile: choose up to five players per tour in priority order, optionally with different lists per surface. When a draw is published, a bracket is generated for you from that list.' },
          { type: 'p', text: 'Auto-generated brackets are locked the moment they are created and cannot be edited afterwards, so be sure of your player list before saving it. Being locked, they earn the streak multiplier like any other committed bracket.' },
        ],
      },
    ],
  },

  {
    id: 'ranking',
    title: 'Ranking and leagues',
    intro: 'Where your points end up.',
    questions: [
      {
        id: 'global-ranking',
        question: 'How is my global rank worked out?',
        answer: [
          { type: 'p', text: 'By ranking points, highest first. Your rank is simply the number of players with more points than you, plus one.' },
          { type: 'p', text: 'Because points expire after 364 days, the ranking is a rolling 52-week table rather than an all-time one — the same way the real tours do it. A quiet year costs you places even if you never lose a point.' },
        ],
      },
      {
        id: 'leagues',
        question: 'What is a league?',
        answer: [
          { type: 'p', text: 'A private table among people you invite. Everyone keeps playing the same tournaments as normal; the league just scores you against each other instead of against the whole site.' },
          { type: 'p', text: 'A league can be narrowed to certain kinds of tournament — Grand Slams only, for instance — in which case only points from those count toward its table.' },
        ],
      },
      {
        id: 'challenge-points-ranking',
        question: 'Do challenge points count toward my ranking?',
        answer: [
          { type: 'p', text: 'No. A challenge bracket is separate from your main one and scores only within that challenge. It does not touch your ranking points, your leagues, or your profile statistics.' },
          { type: 'p', text: 'Your normal bracket for the same tournament is unaffected — you can enter both.' },
        ],
      },
    ],
  },

  {
    id: 'challenges',
    title: 'Challenges',
    intro: 'Head-to-head against one person, over one tournament.',
    questions: [
      {
        id: 'what-is-a-challenge',
        question: 'How does a challenge work?',
        answer: [
          { type: 'p', text: 'You pick a friend and a tournament. They accept, you both fill in a bracket for it, and whoever scores more points over that tournament wins.' },
          { type: 'p', text: 'Scoring is the same as everywhere else — same points per round, same streak multiplier. Only the audience is different.' },
        ],
      },
      {
        id: 'challenge-hidden-picks',
        question: 'Can my opponent see my picks?',
        answer: [
          { type: 'p', text: 'Not until you have both locked. Until then neither of you can see the other’s picks, their score, or even how many picks they have made.' },
          { type: 'p', text: 'Locking is what reveals both brackets at once, so nobody can read their opponent before committing.' },
        ],
      },
      {
        id: 'challenge-winner',
        question: 'How is a challenge decided?',
        answer: [
          { type: 'p', text: 'On points earned over the tournament. If both of you finish level, the one who made more picks wins — backing yourself on more matches breaks the tie. Level on both is recorded as a draw.' },
          { type: 'p', text: 'Challenges are settled automatically once the tournament is complete. A challenge nobody accepted before the tournament started expires on its own.' },
        ],
      },
      {
        id: 'anonymous-challenge',
        question: 'Can I challenge someone without an account?',
        answer: [
          { type: 'p', text: 'Yes. Create a challenge, send the link, and whoever opens it can fill in a bracket with just a display name — no sign-up, no email.' },
          { type: 'p', text: 'Anonymous brackets score on the same rules but stand alone: they do not appear on the leaderboard, in leagues, or in anyone’s ranking. Creating an account later lets you claim a bracket you played anonymously.' },
        ],
      },
    ],
  },
]

/** Flat list, for anchors and structured data. */
export const ALL_FAQ_QUESTIONS: FaqQuestion[] = FAQ_SECTIONS.flatMap(s => s.questions)

/**
 * An answer as plain text, for the FAQPage structured data.
 *
 * Tables become one line per row rather than being dropped: a crawler reading
 * "Round of 128 — Grand Slam: 10 …" gets the same facts a reader gets from the
 * grid, which is what makes the two versions honest about each other.
 */
export function answerToPlainText(answer: FaqBlock[]): string {
  const parts: string[] = []
  for (const block of answer) {
    if (block.type === 'p') parts.push(block.text)
    else if (block.type === 'ul') parts.push(block.items.join(' '))
    else {
      const [rowHead, ...colHeads] = block.head
      parts.push(
        block.rows
          .map(row => `${row[0]} — ${colHeads.map((h, i) => `${h}: ${row[i + 1]}`).join(', ')}`)
          .join('. ') + (rowHead ? '' : ''),
      )
      if (block.caption) parts.push(block.caption)
    }
  }
  return parts.join(' ')
}
