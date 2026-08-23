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
  ['Round of 32',  '90',  '45',   '20',  '6'],
  ['Round of 16',  '180', '90',   '30',  '13'],
  ['Quarterfinal', '360', '180',  '60',  '29'],
  ['Semifinal',    '720', '360',  '90',  '45'],
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
          { type: 'p', text: 'It ends your bracket. Every pick becomes final, the whole bracket becomes visible, and everything you have picked starts earning the multiplier.' },
          { type: 'p', text: 'It cannot be undone. There is no unlock — not by you, not by us.' },
          { type: 'p', text: 'It also gives up every round you have not filled in yet. Later rounds keep opening as results come in, so a bracket locked at the quarterfinals can never score the quarters, semis or final. The button tells you exactly which rounds you would be giving up before you confirm. If a tournament is still running, lock the round instead.' },
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
