# Prepkit: AI interview prep kits

Paste a job description, give the company's URL and the number of days until the interview, and Prepkit builds a prep kit: the role's requirements (each traced to a quote in the posting), a company brief, a hiring-process summary, interview questions across four categories, flashcards, a day-by-day schedule and a practice mode. Everything generated can be edited, reordered, pinned and regenerated without losing your edits.

- Web: https://prepkit-web-sigma.vercel.app
- API: https://prepkit-api-b0iy.onrender.com (health check: `https://prepkit-api-b0iy.onrender.com/api/health`)

## Stack

| Part | Choice | Why |
| --- | --- | --- |
| Language | TypeScript everywhere (npm workspaces monorepo) | One kit type and one set of validators, shared by the API, the web app and the batch command. |
| Web | Next.js (App Router) + Tailwind CSS | Stack from the brief. Next also proxies `/api`, so the browser only ever talks to one origin. |
| Server state | TanStack Query | Polling for long jobs, cache updates after edits, and rebasing the builder's pending edits onto a fresh kit. |
| Drag and drop | @dnd-kit | Accessible reordering: keyboard sensors and screen-reader announcements built in. |
| API | Express 5 | Small and well known. Async errors reach the error handler without wrappers. |
| Database | MongoDB with the official driver + zod | The kit is one document. zod already validates it, so a Mongoose schema would just be a second copy of the same shape. Compare-and-swap on a `version` field is one `updateOne` filter. |
| LLM calls | Plain `fetch` to OpenAI-compatible endpoints | Groq and Gemini both expose `/chat/completions`. My own client handles pacing, failover and retries, which SDKs would only get in the way of. |
| Crawling | cheerio + robots-parser | HTML to text, and RFC 9309 robots rules. |
| Search | Tavily | A search API that returns page content, with a free tier. |
| Tests | Vitest | Fast, and TS-native. |

## Setup

### Local

1. Node 22 LTS (`.nvmrc`: `nvm use` or `fnm use`).
2. `npm install`
3. `cp .env.example .env`, then fill it in:

| Variable | What it's for |
| --- | --- |
| `GROQ_API_KEY` | Primary LLM provider. Needed for real runs. |
| `GROQ_MODEL` | Primary model, `openai/gpt-oss-120b`. |
| `GROQ_TPM`, `GROQ_RPM` | Primary model's tokens/requests per minute, used by the client-side pacer. |
| `GROQ_REASONING_EFFORT` | `reasoning_effort` sent to Groq (`off` leaves it out). |
| `GROQ_SECONDARY_MODEL` | Second Groq model, same key but its own rate-limit bucket (`openai/gpt-oss-20b`; `off` disables it). |
| `GROQ_SECONDARY_TPM`, `GROQ_SECONDARY_RPM` | Its budgets. |
| `GEMINI_API_KEY` | Optional fallback provider. Enabled when set. |
| `GEMINI_MODEL`, `GEMINI_TPM`, `GEMINI_RPM`, `GEMINI_REASONING_EFFORT` | Gemini model and budgets. |
| `LLM_TIMEOUT_MS` | Per-request LLM timeout. |
| `TAVILY_API_KEY` | Optional. Enables web search for public interview discussion. Skipped with a warning when unset. |
| `ALLOW_PRIVATE_URLS` | Allow crawling loopback/private addresses. Defaults to `true` outside production (the batch fixtures are served from localhost) and `false` when `NODE_ENV=production`. |
| `MONGODB_URI` | MongoDB connection string. API only: `npm run evaluate` doesn't need it. |
| `MONGODB_DB` | Database name, `prepkit`. Set explicitly rather than read from the URI. |
| `DNS_SERVERS` | Optional, e.g. `1.1.1.1,8.8.8.8`. On some Windows machines Node's resolver refuses SRV lookups (`querySrv ECONNREFUSED` for `mongodb+srv://`). This points Node at public resolvers. |
| `PORT` | API port (4000). |
| `WEB_ORIGIN` | CORS origin. Leave empty: the web app proxies `/api`, so requests are same-origin. |
| `API_URL` | Web app only: where Next proxies `/api/*`. Defaults to `http://localhost:4000`. |

4. `npm run dev` starts the API (:4000) and the web app (:3000).
5. `npm run fixtures` serves the example company sites (Acme, Globex) on localhost for `examples/cases.json`.

### Batch entry point

```
npm install
npm run fixtures        # in a second terminal: the local sites the example cases point at
npm run evaluate -- --input examples/cases.json --output kits.json
```

`--concurrency N` (default 2) sets how many cases run at once. They all share one LLM client and its pacing. A failing case is recorded in the output and the run carries on. The command runs the same `runPipeline` the API uses. It needs `GROQ_API_KEY`, and doesn't need MongoDB.

### Deployed

**API on Render** (`render.yaml` Blueprint, or a manual Web Service with the same values):

- Runtime Node, `NODE_VERSION=22`. Build: `npm ci`. Start: `npm run start -w @prepkit/api`. Health check path: `/api/health`.
- Env: `NODE_ENV=production`, `ALLOW_PRIVATE_URLS=false`, `MONGODB_DB=prepkit`. Secrets (entered in the dashboard): `MONGODB_URI`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `TAVILY_API_KEY`.
- Render sets `PORT`, and the server listens on it. `tsx` is a runtime dependency of the API, because the server runs TypeScript directly.
- MongoDB Atlas: allow Render's outbound IPs (or `0.0.0.0/0` on a free cluster).

**Web on Vercel:**

- Import the repo. Root Directory `apps/web`, framework preset Next.js. Leave "Include files outside the root directory in the Build Step" on (the default), because the app imports `packages/shared`. Vercel detects the npm workspace and installs from the repo root.
- Env: `API_URL=<Render URL>` (no trailing slash). The rewrite is fixed at build time, so redeploy after changing it.
- The browser only talks to Vercel, and Vercel's rewrite proxies `/api/*` to Render. So the session cookie is first-party: `HttpOnly`, `SameSite=Lax`, `Secure` in production, with no `Domain` attribute. The API sets `trust proxy` to one hop, so `req.ip` and `req.secure` come from Render's `X-Forwarded-*` headers.

## LLM provider and models

- **Primary:** Groq `openai/gpt-oss-120b`.
- **Secondary:** Groq `openai/gpt-oss-20b`. Same key, but a separate rate-limit bucket, so it picks up calls while the primary is pacing.
- **Fallback:** Gemini `gemini-3.6-flash`, through Gemini's OpenAI-compatible endpoint.

The client (`apps/api/src/llm/client.ts`) is shared by every call in a process:

- **Pacing.** A sliding 60-second window per provider counts requests and tokens. Before each call it reserves `prompt estimate + max_tokens`, then corrects to the real usage once the response arrives. It waits for room rather than collecting 429s.
- **Spillover.** If the primary would have to wait more than 5 s, the call goes to the first provider that can serve it now.
- **Retries.** 429/5xx/network errors retry with backoff, honouring `retry-after` and Groq's reset headers. A provider fails over after 2 attempts while a healthy alternative exists. The last one available gets 5.
- **Cooldown.** A provider that exhausts its retries, or returns two 503s in a row, is skipped for 60 s.
- **JSON.** Every structured call is validated against a zod schema. If the output doesn't parse or validate, the errors go back to the model for one repair pass. If that also fails, the step fails and degrades with a warning.

## Architecture

```
packages/shared      kit types + zod validation, schedule builder, coverage check,
                     builder ops (applyOps), regeneration merge, practice ordering
        ▲                          ▲
        │                          │
apps/api                           apps/web (Next.js)
  retrieval/    urlGuard, fetchPage, robots, rankLinks, crawl, clean, search
  llm/          client (pacing, failover), json (validate + repair), untrusted
  pipeline/     runPipeline + steps/*      ◄── also used by scripts/evaluate.ts
  persistence/  mongo repos, updateKit (compare-and-swap)
  jobs/         runner (queue), regenerate, recover
  http/         express app: auth, kits, builder, practice
        ▲
        │  /api/* (Next rewrite, same origin)
browser ─┘
```

The pipeline is pure. Everything external (LLM, fetch, search, clock, progress) comes in through `PipelineDeps`, so the API job runner, the batch command and the tests all run the same code with different deps.

## Retrieval and sources

Sources used: **the company's own website** (crawled) and **Tavily web search** (public interview discussion, plus hiring pages the crawl missed).

- **URL guard (SSRF).** http/https only, no credentials in the URL. Every hop, redirects included, is resolved and checked. In production, loopback, private, link-local, CGNAT and IPv4-mapped IPv6 addresses are rejected.
- **robots.txt (RFC 9309).** Fetched once per origin. A 4xx means "allow all". A 5xx or unreachable robots.txt means "disallow all". `Crawl-delay` is honoured (capped).
- **Link ranking** is deterministic keyword scoring in code: anchor text weighs more than the path, blog/news/dated posts are penalised, and links found on a careers page get a bonus.
- **Sitemaps.** Every URL from robots `Sitemap:` lines (or `/sitemap.xml`) is scored first, and only the best 50 enter the queue. A relevant page deep in a big sitemap still gets a chance.
- **Hiring pages must be confirmed by content.** A page counts as a hiring-process page only if its text contains at least 3 distinct hiring-process phrases. Otherwise it falls back to its next-best category.
- **Scope.** Same host under the start directory. From a site root, subdomains of the base domain too (about.gitlab.com → handbook.gitlab.com). IP/localhost starts: same host only.
- **Limits.** Only HTML/text (and XML for sitemaps). Bodies are capped at 2 MB (5 MB for sitemaps) and read as a stream, never trusting `content-length`. Cleaned text is capped at 20k characters. There are caps on pages, sitemap files and URLs.
- **Politeness.** A per-host limit on concurrent requests and a minimum gap between them. The user agent identifies the bot.
- **Search attribution.** A result is attributed to the company if it's on the company's domain or mentions its hostname ("domain"). A whole-word match on the company name alone counts as "name" (so "Acme" doesn't match "Acmeville"). Generic names ("company", "confidential") are never searched.
- **Wrong-company guards.** If the JD names one company and the site says it's another, the site content isn't used. A name guessed only from the hostname isn't searched. For a localhost/private URL, name-only results are kept visible but left out of the hiring summary.

## Sequencing

```
validate input
  → [extract requirements ∥ crawl company site]
  → web search (+ search-assisted hiring discovery if the crawl found no hiring page)
  → [hiring-process summary ∥ company brief]
  → plan question mix → generate questions per category (concurrently)
  → coverage loop → flashcards → schedule → assemble → validate kit
```

| Step | Responsibility | LLM or code |
| --- | --- | --- |
| Extraction | Title, seniority, responsibilities, requirements with a verbatim evidence quote each | LLM, then an evidence check in code: a requirement whose quote isn't in the JD (after normalisation) is dropped. Priority is overridden from the JD's own wording and headings ("Nice to have" → nice). Duplicates are removed and ids assigned by position. |
| Crawl / search | Site pages, hiring pages, discussion | Code |
| Hiring summary | Stages and signals (take-home, live coding, system design…) | LLM. Its sources are set in code. |
| Company brief | Summary from site text, or the JD's own "About us" | LLM. With no usable text, an honest brief is built in code. |
| Question plan | Which categories, how many, for which requirements (musts count double; hiring signals add system-design/coding) | Code |
| Questions | One call per category batch: technical, system design, behavioural, company fit | LLM. Category, ids and difficulty are clamped in code. |
| Coverage | Every requirement covered by some question | Code (see below) |
| Flashcards | Cards per ≤12 requirements. Every must gets at least one card. | LLM, with a code-built fallback card |
| Schedule | Day allocation | Code |

Only invalid input, an extraction failure, an invalid final kit and the timeout are fatal. Every other step degrades to a warning shown on the kit.

## Coverage loop

Pass 1 checks the drafted questions against the requirements. Passes 2 and 3 send only the uncovered requirements back to the model with a one-question-per-requirement prompt, grouped by technical and behavioural. `MAX_PASSES = 3` because a requirement the model hasn't covered after two targeted retries is unlikely to be covered by a third. More passes would burn tokens and rate-limit budget. Any **must-have** still uncovered after that gets a template question built in code (a deterministic fallback, flagged), so must-have coverage is guaranteed. Uncovered nice-to-haves are reported in `coverage`. The per-pass trace shows up in the progress view.

## Builder state: generated, edited, pinned

- Every question, flashcard and the brief carry `meta: { origin: "generated" | "user", edited, pinned }`. A missing `meta` means generated, unedited and unpinned.
- **Protection rule.** Anything user-created, edited or pinned is protected: regeneration never removes or overwrites it.
- **Edits are operations** (`question.update`, `question.move`, `flashcard.delete`, `question.restore`, `brief.pin`, …), applied by one pure `applyOps` in `packages/shared`. The server and the client run the same function.
- **Server.** `updateKit` does read → applyOps → validate → `updateOne({ _id, version })`. If it loses the race, it reloads and re-applies, up to 5 tries. Ops are built to be re-applied: `update`/`move` carry a snapshot of the item, so an edit to an item a regeneration just removed puts it back instead of being lost. `add` of an existing id and `delete` of a missing id are no-ops.
- **Client.** The local kit is always `server kit + in-flight ops + pending ops`, computed with the same `applyOps`. When a newer server kit arrives (a regeneration finished), pending edits are rebased on top of it. Consecutive updates to the same item are merged. Edits are batched and sent after 500 ms of quiet, so edits feel instant without a request per keystroke.
- **Undo** of a delete is a `restore` op that puts the item back exactly as it was, meta and position included.
- **Ids are never reused.** `id_seq` only goes up, even after deletes.
- **Regeneration** (questions per category, brief, coverage gaps) runs in the background from the stored context: no re-crawl, no re-extraction. Its result is merged into the **latest** kit with compare-and-swap, so edits made while it ran survive. One regeneration runs per kit at a time, claimed atomically.

## Schedule allocation

`buildSchedule` in `packages/shared/src/planning/schedule.ts` is pure code:

1. Rank the questions: those linked to a must-have first, then harder first, then original order.
2. Cost: learning time by difficulty (15/25/40 min). A review costs 10 min.
3. **At least as many questions as days:** split the ranked list into exactly N contiguous chunks, balanced by minutes. Each day takes items until it reaches its share of the remaining minutes, and at least its fair share by count. Leftovers land on earlier days, so the hard, must-have material is front-loaded rather than left for the night before.
4. **Fewer questions than days** (e.g. 60 days): one question per learning day, then the remaining days are review days that cycle through the ranked list again.
5. Each day gets a focus ("Technical + System design: Kafka, SQL…"), question ids and integer minutes. The day count always equals the days requested (1–90).

Editing the questions marks the schedule stale. It's then rebuilt on request, optionally for a different number of days.

## Practice ordering

Cards are rated "Not yet", "Shaky" or "Got it". A session is ordered: never reviewed, then Not yet, Shaky, Got it. Within a group, must-have cards come first, then the least recently reviewed. A schedule day links to practice filtered to that day's cards.

I chose this over spaced repetition (SM-2) on purpose. SM-2's intervals grow (1, 6, 15… days) to optimise long-term retention. With an interview a few days away, most of those reviews would land after it. A confidence-first order gives the weakest material the most exposure within the time that actually exists.

## Creative feature: the evidence highlighter

Every extracted requirement is stored with the verbatim quote from the posting that supports it. The Role tab shows the original JD with each quote highlighted. Hovering or focusing a requirement highlights its passage, and hovering a highlight points back to the requirement. Clicking scrolls to the other side.

**The problem it solves:** AI prep tools pad. A candidate can't tell which requirements the posting actually states and which the model invented, and they end up preparing for things the interviewer will never ask about. The extractor already drops any requirement whose evidence isn't in the JD. The highlighter makes that guarantee visible and checkable in a second, and it shows which parts of the posting produced no requirement at all. The frontend matches quotes with the same normalisation the backend uses to accept them, so what's highlighted is exactly what was verified.

## Edge cases and failure handling

- **Invalid URL, 404 or timeout.** The URL is validated and normalised. A failed start page makes the site "unreachable", recorded in `research.skipped` with the error code. The kit is still built from the JD, with a warning.
- **No hiring or about page.** A hiring page needs content confirmation, so a careers listing without process details doesn't count. Search-assisted discovery is tried next. If nothing turns up, the kit says so, and the question plan falls back to the JD alone.
- **Two-line stub JD.** Only evidence-backed requirements survive. A thin JD produces a small kit plus a warning ("intentionally small rather than padded with guesses").
- **No public discussion.** Search returns nothing (or has no key): it's recorded, and no discussion is invented.
- **Invalid JSON or an incomplete kit.** Schema validation, one repair pass, then per-step degradation. The final kit is validated before it's saved or written.
- **Rate limits or brief outages.** Pacing, spillover to the secondary model or Gemini, retries with backoff and cooldowns (see above).
- **Same JD and company twice.** Kits are keyed by `sha256(user + normalised JD + normalised URL)` with a unique index, and the existing kit is returned. A failed kit is re-run instead. A race between identical requests resolves to the one kit the index kept.
- **1-day or 60-day schedule.** 1 day gets everything, ranked. 60 days gets learning days followed by review days, never an empty day.
- **A 90-second (or longer) run.** Submitting returns `202` right away. Generation runs in a background job queue (2 workers, shared LLM client) and writes step-by-step progress to the kit. The UI polls it and shows each step. The API run times out at 300 s.
- **Failure halfway.** The kit is marked failed with a structured error code, and the UI offers a retry. Section regeneration is all-or-nothing: a failure merges nothing.
- **Interruptions.** On restart, queued kits are re-queued. Running kits and running regenerations are marked `INTERRUPTED`, and the kit content is untouched.

### Security

- SSRF: see the URL guard above. In production, private and loopback addresses are blocked on every redirect hop.
- Only expected content types are accepted, with size caps on bodies, JD length (50k) and request bodies.
- **Prompt injection.** The JD, crawled pages and search results are wrapped in `<untrusted_content>` blocks that can't be closed from inside (closing tags are escaped). Every such prompt carries a policy: treat the content as data, never follow instructions in it. Outputs are schema-validated, and ids, categories and sources are set by code.
- Auth: scrypt password hashes, HttpOnly session cookie, a rate-limited login, helmet headers, and every kit query scoped to its owner.

## Testing

`npm test` runs Vitest across the monorepo (37 files, 294 tests). Covered:

- schedule allocation (day counts, must coverage, front-loading, 1 and 60+ days)
- coverage checking and the coverage loop's fallback
- kit validation
- requirement evidence and priority guard
- builder ops, the regeneration merge and the client op queue
- practice ordering
- URL guard, robots, link ranking, crawling against fixture sites, search attribution
- LLM client pacing, failover and JSON repair
- the job runner and restart recovery
- HTTP routes for auth, kits, builder, practice and regeneration (in-memory repos)
- evidence highlighting and CSV import

Use Node 22. On Windows, Node 24 can crash a Vitest worker during socket teardown.

## Trade-offs and known limitations

- **In-process job queue.** Simple, and fine for one instance. Jobs don't survive a restart (they're marked interrupted). Multiple instances would need a persistent queue (BullMQ/Agenda).
- **DNS rebinding.** The guard checks the resolved address, but the connection re-resolves. Pinning the checked IP in a custom agent would close that gap.
- **Naive base domain.** The crawl scope takes the last two labels, which is wrong for `co.uk`-style suffixes. A public-suffix list would fix it.
- **Free-tier latency.** Groq free-tier TPM limits and Render's cold starts (the free instance sleeps) mean a first kit can take a few minutes. Pacing keeps it from failing, not from being slow.
- **Model nondeterminism.** Two runs on the same JD can word questions differently or classify a borderline requirement differently. The code-side guards (evidence check, priority override, coverage fallback, schedule) keep the guarantees fixed even when the wording varies.
- **Rate limiting behind the proxy.** Requests arrive via Vercel, so the login limiter sees Vercel's address rather than the user's.
