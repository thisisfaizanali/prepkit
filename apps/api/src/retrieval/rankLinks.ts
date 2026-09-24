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
  /** Hiring path segments differ from anchor text: blogs put "interview" in URLs for CEO interviews. */
  hiringPath: {
    strong: ["hiring", "hiring process", "how we hire", "interview process", "interviewing"],
    weak: ["people", "interview", "interviews"],
    weakWeight: 3,
  },
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
    /** /blog/, /news/, /press/: hiring-themed posts shouldn't outrank real site pages. */
    postPath: -6,
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
const POST_SEGMENTS = ["blog", "news", "press"];
const DATED =/\/\d{4}\/\d{2}(\/|$)/;
export const LOCALE_PREFIX = /^\/(fr|de|es|it|pt|pt-br|ja|ko|zh|zh-cn|zh-tw|nl|ru|pl|sv|tr|da|fi|no|nb|cs|uk)(\/|$)/i;

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const has = (hay: string, phrase: string) => ` ${hay} `.includes(` ${normalize(phrase)} `);

export type LinkContext = { startLocalised?: boolean };

export type LinkScore = {
  score: number;
  kind: LinkKind;
  /** Best non-hiring category, used when a page's content doesn't confirm it's about hiring. */
  fallbackKind: LinkKind;
};

export function scoreLink(link: { url: string; text: string }, context: LinkContext = {}): LinkScore {
  const url = new URL(link.url);
  const text = normalize(link.text);
  const segments = url.pathname.split("/").filter(Boolean).map((s) => normalize(decodeURIComponent(s)));
  const path = segments.join(" ");
  const S = LINK_SIGNALS;

  // Score each category separately; the link is worth its best category (no summing across categories).
  const categoryScore = (category: Category) => {
    const weight = S.weights[category];
    const anchor = S.keywords[category].some((p) => has(text, p)) ? weight * S.anchorMultiplier : 0;
    if (category !== "hiring") return anchor + (S.keywords[category].some((p) => has(path, p)) ? weight : 0);
    const { strong, weak, weakWeight } = S.hiringPath;
    return anchor + (strong.some((p) => has(path, p)) ? weight : weak.some((p) => has(path, p)) ? weakWeight : 0);
  };
  let kind: LinkKind = "other";
  let fallbackKind: LinkKind = "other";
  let best = 0;
  let bestNonHiring = 0;
  for (const category of Object.keys(S.keywords) as Category[]) {
    const value = categoryScore(category);
    if (value > best) [best, kind] = [value, category];
    if (category !== "hiring" && value > bestNonHiring) [bestNonHiring, fallbackKind] = [value, category];
  }
  let score = best;

  for (const word of S.penaltyWords) {
    if (has(text, word) || has(path, word)) score += S.penalties.word;
  }
  if (FILE_EXT.test(url.pathname)) score += S.penalties.fileExtension;
  if (url.search) score += S.penalties.queryString;
  if (DATED.test(url.pathname)) score += S.penalties.datedPost;
  if (!context.startLocalised && LOCALE_PREFIX.test(url.pathname)) score += S.penalties.localePrefix;
  if (segments.length > S.maxPathSegments) score += S.penalties.deepPath;
  if (segments.some((seg) => POST_SEGMENTS.includes(seg))) score += S.penalties.postPath;

  return { score, kind, fallbackKind };
}

/** Number of distinct hiring-process phrases in the page body. */
export function scorePageContent(text: string): number {
  const hay = normalize(text);
  return CONTENT_SIGNALS.filter((p) => has(hay, p)).length;
}
