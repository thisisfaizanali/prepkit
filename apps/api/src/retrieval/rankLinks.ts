export type LinkKind = "hiring" | "careers" | "about" | "engineering" | "other";
type Category = Exclude<LinkKind, "other">;

/** All ranking knobs in one place. Phrases are matched as whole words after normalisation. */
export const LINK_SIGNALS = {
  weights: { hiring: 10, careers: 6, about: 4, engineering: 3 } satisfies Record<Category, number>,
  /** Anchor-text matches count this many times more than path matches. */
  anchorMultiplier: 2,
  keywords: {
    hiring: [
      "how we hire", "hiring process", "interview process", "interviewing", "interview", "interviews",
      "hiring", "recruiting", "candidate", "candidates", "what to expect",
    ],
    careers: [
      "careers", "career", "jobs", "job", "join us", "join the team", "work with us", "openings",
      "open roles", "open positions", "positions", "vacancies",
    ],
    about: ["about", "about us", "company", "who we are", "mission", "story", "values", "culture", "team", "handbook"],
    engineering: ["engineering", "tech blog", "how we work", "stack"],
  } satisfies Record<Category, string[]>,
  penaltyWords: [
    "login", "log in", "sign in", "signin", "signup", "sign up", "register", "privacy", "terms", "legal", "cookie",
    "cookies", "security txt", "status", "pricing", "docs", "api reference", "changelog", "rss",
  ],
  penalties: {
    word: -8,
    fileExtension: -20,
    queryString: -3,
    datedPost: -6,
    localePrefix: -6,
    deepPath: -4,
  },
  /** Links found on a hiring/careers page get this bonus (interview pages hang off careers). */
  foundOnHiringPageBonus: 5,
  maxPathSegments: 5,
};

export const CONTENT_SIGNALS = [
  "interview process", "hiring process", "take home", "technical interview", "system design interview",
  "onsite", "on site interview", "stages", "recruiter screen", "pair programming", "coding interview",
  "interview loop", "hiring manager interview",
];
/** Distinct content phrases needed to call a page a hiring-process page. */
export const HIRING_CONTENT_THRESHOLD = 3;

const FILE_EXT = /\.(pdf|jpe?g|png|gif|svg|webp|zip|gz|xml|json|mp4|mp3|docx?|pptx?|xlsx?)$/i;
const DATED = /\/\d{4}\/\d{2}(\/|$)/;
export const LOCALE_PREFIX = /^\/(fr|de|es|it|pt|pt-br|ja|ko|zh|zh-cn|zh-tw|nl|ru|pl|sv|tr|da|fi|no|nb|cs|uk)(\/|$)/i;

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const has = (hay: string, phrase: string) => ` ${hay} `.includes(` ${normalize(phrase)} `);

export type LinkContext = { startLocalised?: boolean };

export function scoreLink(link: { url: string; text: string }, context: LinkContext = {}): { score: number; kind: LinkKind } {
  const url = new URL(link.url);
  const text = normalize(link.text);
  const segments = url.pathname.split("/").filter(Boolean).map((s) => normalize(decodeURIComponent(s)));
  const path = segments.join(" ");
  const S = LINK_SIGNALS;

  let score = 0;
  let kind: LinkKind = "other";
  let best = 0;
  for (const category of Object.keys(S.keywords) as Category[]) {
    const phrases = S.keywords[category];
    const weight = S.weights[category];
    const contribution =
      (phrases.some((p) => has(text, p)) ? weight * S.anchorMultiplier : 0) + (phrases.some((p) => has(path, p)) ? weight : 0);
    score += contribution;
    if (contribution > best) [best, kind] = [contribution, category];
  }

  for (const word of S.penaltyWords) {
    if (has(text, word) || has(path, word)) score += S.penalties.word;
  }
  if (FILE_EXT.test(url.pathname)) score += S.penalties.fileExtension;
  if (url.search) score += S.penalties.queryString;
  if (DATED.test(url.pathname)) score += S.penalties.datedPost;
  if (!context.startLocalised && LOCALE_PREFIX.test(url.pathname)) score += S.penalties.localePrefix;
  if (segments.length > S.maxPathSegments) score += S.penalties.deepPath;

  return { score, kind };
}

/** Number of distinct hiring-process phrases in the page body. */
export function scorePageContent(text: string): number {
  const hay = normalize(text);
  return CONTENT_SIGNALS.filter((p) => has(hay, p)).length;
}
