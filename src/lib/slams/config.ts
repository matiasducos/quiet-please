/**
 * Per-slam landing page configuration.
 *
 * This is the whole customization surface: copy, palette, facts and FAQ all
 * live here, so each Grand Slam page reads as its own thing rather than one
 * template with the name swapped. Adding a fifth page is one entry here plus a
 * ~10-line route file.
 *
 * Content is deliberately in code rather than the database. It changes roughly
 * four times a year, benefits from type-safety and PR review, and needs no
 * migration — see the plan discussion for the trade-off.
 */

export type SlamSlug = 'wimbledon' | 'us-open' | 'australian-open' | 'french-open'

export type SlamConfig = {
  slug: SlamSlug
  /** Route path, without a trailing slash. Chosen for English search volume. */
  route: string
  /** Short name used throughout the UI, e.g. "Wimbledon". */
  name: string
  /**
   * Name as it reads mid-sentence after a preposition, e.g. "About {x}".
   * Three of the four majors take a definite article and Wimbledon does not,
   * so this can't be derived from `name` without producing "About the
   * Wimbledon".
   */
  nameWithArticle: string
  /** Formal name, shown once in the intro where it adds authority. */
  officialName: string
  /**
   * Lowercase fragments matched against `tournaments.name` with ILIKE.
   * Multiple entries because the same event lands in the DB under different
   * names depending on source: the API sync copies the provider's
   * `tournament_name` verbatim, while admin-created rows use whatever was
   * typed. Roland Garros is the live example — stored as "Roland Garros",
   * but "French Open" is just as likely from the sync.
   */
  matchNames: string[]
  surface: 'grass' | 'clay' | 'hard'
  /**
   * Venue details. Hardcoded rather than read from the tournament row because
   * the sync cron never writes `location`/`flag_emoji` (only admin-created rows
   * have them), and the project convention is that every tournament reference
   * shows its flag. These facts don't change.
   */
  city: string
  country: string
  flagEmoji: string
  /** Human phrase for when the event runs, used in off-season copy. */
  seasonWindow: string
  /** Calendar month the event usually starts, 1-indexed. Drives next-edition estimates. */
  startMonth: number

  // ── SEO ────────────────────────────────────────────────────────────────
  title: string
  description: string
  keywords: string[]
  h1: string

  // ── Per-slam palette ───────────────────────────────────────────────────
  accent: {
    /** Primary accent — buttons, links, kickers. Must pass AA on white. */
    base: string
    /** Tinted background for panels and badges. */
    soft: string
    /** Darkest shade, for text on `soft`. */
    ink: string
  }

  // ── Content ────────────────────────────────────────────────────────────
  heroKicker: string
  heroSubhead: string
  intro: string
  facts: { label: string; value: string }[]
  faq: { q: string; a: string }[]
}

export const SLAMS: Record<SlamSlug, SlamConfig> = {
  wimbledon: {
    slug: 'wimbledon',
    route: '/wimbledon-bracket-challenge',
    name: 'Wimbledon',
    nameWithArticle: 'Wimbledon',
    officialName: 'The Championships, Wimbledon',
    matchNames: ['wimbledon'],
    surface: 'grass',
    city: 'London',
    country: 'United Kingdom',
    flagEmoji: '🇬🇧',
    seasonWindow: 'late June to mid July',
    startMonth: 6,
    title: 'Wimbledon Bracket Challenge — Free Predictions',
    description:
      'Fill out your Wimbledon bracket before the draw closes. Predict all 128 players across the men\'s and women\'s draws, earn points for every correct pick, and compete with friends. Free to play.',
    keywords: [
      'wimbledon bracket challenge',
      'wimbledon bracket predictions',
      'wimbledon draw predictions',
      'wimbledon bracket',
      'wimbledon pick em',
    ],
    h1: 'Wimbledon bracket challenge — predict the whole draw, free',
    accent: { base: '#1f6b43', soft: '#e9f4ed', ink: '#0f3d26' },
    heroKicker: 'The grass-court major',
    heroSubhead:
      'Pick every match from the first round to the final on Centre Court. Lock in your bracket before play starts, then watch your points climb round by round.',
    intro:
      'Wimbledon is the oldest tennis tournament in the world and the only major still played on grass — which makes it the hardest of the four to predict. Low bounces, big serves and short points mean seeds fall early and unfamiliar names run deep. That is exactly what makes a Wimbledon bracket worth filling in.',
    facts: [
      { label: 'Surface', value: 'Grass' },
      { label: 'Draw size', value: '128 players' },
      { label: 'First held', value: '1877' },
      { label: 'Venue', value: 'All England Club' },
    ],
    faq: [
      {
        q: 'When does the Wimbledon bracket open?',
        a: 'Your bracket opens the moment the official Wimbledon draw is published, usually the Friday before play begins. You can edit your picks right up until each match starts, so a busy first week does not lock you out.',
      },
      {
        q: 'Is the Wimbledon bracket challenge free?',
        a: 'Yes, completely. There is no entry fee, no real money and no prizes — just points, rankings and bragging rights. You can also challenge a friend to a head-to-head bracket without creating an account at all.',
      },
      {
        q: 'Can I predict both the men\'s and women\'s draws?',
        a: 'Yes. The ATP and WTA events at Wimbledon are separate brackets, and you can fill in either or both. Points from both count toward your global ranking.',
      },
      {
        q: 'How are Wimbledon points scored?',
        a: 'Correct picks earn points using a formula modelled on professional tour scoring, so a correctly picked champion is worth far more than a first-round win. Backing the same player through consecutive rounds compounds your score with a streak multiplier.',
      },
    ],
  },

  'french-open': {
    slug: 'french-open',
    route: '/french-open-bracket-challenge',
    name: 'French Open',
    nameWithArticle: 'the French Open',
    officialName: 'Roland-Garros',
    matchNames: ['roland garros', 'roland-garros', 'french open'],
    surface: 'clay',
    city: 'Paris',
    country: 'France',
    flagEmoji: '🇫🇷',
    seasonWindow: 'late May to early June',
    startMonth: 5,
    title: 'French Open Bracket Challenge — Roland-Garros Predictions',
    description:
      'Fill out your French Open bracket before the draw closes. Predict every match at Roland-Garros across the men\'s and women\'s draws, earn points for correct picks, and compete with friends. Free to play.',
    keywords: [
      'french open bracket challenge',
      'roland garros bracket predictions',
      'french open draw predictions',
      'roland garros bracket',
      'french open pick em',
    ],
    h1: 'French Open bracket challenge — predict Roland-Garros, free',
    accent: { base: '#c2531f', soft: '#fdece0', ink: '#7a3210' },
    heroKicker: 'The clay-court major',
    heroSubhead:
      'Two weeks of the most physical tennis of the year. Fill out your Roland-Garros bracket before the draw closes and back your picks through five sets.',
    intro:
      'Roland-Garros is the only Grand Slam played on clay, and it rewards a completely different game: heavy topspin, long rallies and relentless movement. Clay-court specialists who barely register elsewhere can reach the second week here, which makes the French Open draw one of the most rewarding to read correctly.',
    facts: [
      { label: 'Surface', value: 'Clay' },
      { label: 'Draw size', value: '128 players' },
      { label: 'First held', value: '1891' },
      { label: 'Venue', value: 'Stade Roland-Garros' },
    ],
    faq: [
      {
        q: 'When does the French Open bracket open?',
        a: 'Your bracket opens as soon as the official Roland-Garros draw is published, typically a few days before the first round. Picks stay editable until each individual match begins.',
      },
      {
        q: 'Is the French Open bracket challenge free?',
        a: 'Yes. No entry fee, no real money, no prizes — it is a free prediction game played for points and rankings. You can challenge a friend to a head-to-head bracket without even signing up.',
      },
      {
        q: 'Why is the French Open harder to predict?',
        a: 'Clay slows the ball down and extends rallies, which favours defensive baseliners and punishes big servers who dominate on faster surfaces. Form from the hard-court season is a poor guide, so upsets are common.',
      },
      {
        q: 'Do both the ATP and WTA draws count?',
        a: 'Yes. They are separate brackets and you can fill in either or both. Points from each feed into the same rolling 52-week global ranking.',
      },
    ],
  },

  'us-open': {
    slug: 'us-open',
    route: '/us-open-tennis-bracket',
    name: 'US Open',
    nameWithArticle: 'the US Open',
    officialName: 'the US Open',
    matchNames: ['us open'],
    surface: 'hard',
    city: 'New York',
    country: 'United States',
    flagEmoji: '🇺🇸',
    seasonWindow: 'late August to early September',
    startMonth: 8,
    title: 'US Open Tennis Bracket — Free Predictions & Challenge',
    description:
      'Fill out your US Open tennis bracket before the draw closes. Predict every match across the men\'s and women\'s draws, earn points for correct picks, and compete with friends. Free to play.',
    keywords: [
      'us open tennis bracket',
      'us open bracket challenge',
      'us open tennis predictions',
      'us open draw predictions',
      'us open pick em tennis',
    ],
    h1: 'US Open tennis bracket — predict the full draw, free',
    accent: { base: '#1b5fa8', soft: '#e6f0fa', ink: '#0e3765' },
    heroKicker: 'The final major of the season',
    heroSubhead:
      'Night sessions under the lights in Flushing Meadows. Fill out your US Open bracket before the draw closes and ride your picks to Arthur Ashe.',
    intro:
      'The US Open closes the Grand Slam season on hard courts, the fastest surface of the four majors. It is the most physically brutal fortnight of the year — late-night finishes, New York humidity and a draw that has produced more first-time finalists than any other slam in recent memory.',
    facts: [
      { label: 'Surface', value: 'Hard' },
      { label: 'Draw size', value: '128 players' },
      { label: 'First held', value: '1881' },
      { label: 'Venue', value: 'Flushing Meadows' },
    ],
    faq: [
      {
        q: 'When does the US Open bracket open?',
        a: 'Your bracket opens the moment the official US Open draw is published, usually the Thursday before the tournament starts. You can adjust picks until each match begins.',
      },
      {
        q: 'Is this the tennis US Open or the golf one?',
        a: 'Tennis. This is the US Open tennis championship held at Flushing Meadows in New York each August and September, covering both the ATP and WTA draws.',
      },
      {
        q: 'Is the US Open bracket challenge free?',
        a: 'Yes, entirely free. No entry fee, no real money and no prizes — you play for points, achievements and your position on the global leaderboard.',
      },
      {
        q: 'Can I play against friends?',
        a: 'Yes. Create a private league for a group, or send a head-to-head challenge link to one person. Anyone can fill in a challenge bracket without creating an account.',
      },
    ],
  },

  'australian-open': {
    slug: 'australian-open',
    route: '/australian-open-bracket-challenge',
    name: 'Australian Open',
    nameWithArticle: 'the Australian Open',
    officialName: 'the Australian Open',
    matchNames: ['australian open'],
    surface: 'hard',
    city: 'Melbourne',
    country: 'Australia',
    flagEmoji: '🇦🇺',
    seasonWindow: 'mid to late January',
    startMonth: 1,
    title: 'Australian Open Bracket Challenge — Free Predictions',
    description:
      'Fill out your Australian Open bracket before the draw closes. Predict every match across the men\'s and women\'s draws, earn points for correct picks, and compete with friends. Free to play.',
    keywords: [
      'australian open bracket challenge',
      'australian open bracket predictions',
      'australian open draw predictions',
      'australian open bracket',
      'australian open pick em',
    ],
    h1: 'Australian Open bracket challenge — predict the draw, free',
    accent: { base: '#0e7490', soft: '#e0f4f8', ink: '#08414f' },
    heroKicker: 'The season opener',
    heroSubhead:
      'The first major of the year, and the first real read on form. Fill out your Australian Open bracket before the draw closes in Melbourne.',
    intro:
      'The Australian Open opens the Grand Slam season, which makes it the hardest slam to handicap: there is barely any current-season form to go on, players arrive off a short pre-season, and the Melbourne heat has decided more matches than any seeding ever has. A bold bracket here sets up your whole year.',
    facts: [
      { label: 'Surface', value: 'Hard' },
      { label: 'Draw size', value: '128 players' },
      { label: 'First held', value: '1905' },
      { label: 'Venue', value: 'Melbourne Park' },
    ],
    faq: [
      {
        q: 'When does the Australian Open bracket open?',
        a: 'Your bracket opens as soon as the official Australian Open draw is published, usually a couple of days before the first round in mid-January. Picks remain editable until each match starts.',
      },
      {
        q: 'Is the Australian Open bracket challenge free?',
        a: 'Yes. There is no entry fee, no real money and no prizes — just points, achievements and a place on the global leaderboard. Head-to-head challenges work without an account.',
      },
      {
        q: 'Why is the first slam of the year hard to predict?',
        a: 'There is almost no current-season form to work from. Players arrive from a short off-season with untested fitness, and the Melbourne heat is a genuine variable, so seeds go out earlier here than at any other major.',
      },
      {
        q: 'Does it cover both the men\'s and women\'s draws?',
        a: 'Yes. The ATP and WTA events are separate brackets and you can enter either or both, with points from each counting toward the same rolling 52-week ranking.',
      },
    ],
  },
}

export const ALL_SLAMS: SlamConfig[] = [
  SLAMS['australian-open'],
  SLAMS['french-open'],
  SLAMS.wimbledon,
  SLAMS['us-open'],
]

export function getSlam(slug: SlamSlug): SlamConfig {
  return SLAMS[slug]
}
