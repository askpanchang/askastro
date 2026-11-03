# Build Prompt — Kundali Q&A Web App (Cloudflare Workers + React)

> **How to use:** Commit this file to the repo as `docs/BUILD_PROMPT.md`, then start the Claude Code cloud session with:
> *"Read docs/BUILD_PROMPT.md and follow it. Start with Phase 0."*
> Or paste everything below the line straight into the session.

---

## 1. Role and goal

You are a senior full-stack engineer building a production-ready astrology web app on Cloudflare. The app lets an operator:

1. **Create and manage birth profiles** (name, gender, date/time/place of birth, resolved coordinates and timezone).
2. **Generate a kundali** for a selected profile by calling the AskPanchang Kundali API, and view the chart and its details.
3. **Hold Q&A sessions** about a profile's kundali. Questions go to an LLM on Cloudflare Workers AI together with the chart data. Every session and message is stored so it can be reopened and read later.

Working name: **Kundali Studio** (rename freely; keep it in one constant).

## 2. Working agreement

- **Plan first.** Before writing code, read this whole file, then post a short implementation plan and a list of anything ambiguous. Proceed using the defaults in §16 unless I answer otherwise.
- **Build in the phases in §14.** Each phase ends with: passing typecheck, lint and tests; a working `npm run dev`; and a commit with a clear message. Push to a feature branch and open a PR per phase (or per two phases if small).
- **Create a `CLAUDE.md`** in Phase 0 that records the stack, commands, folder layout, conventions and the decisions you make. Keep it updated.
- **Verify, don't assume.** Cloudflare APIs, Workers AI model IDs and input schemas change. Check current Cloudflare docs before relying on a model ID or config key. If you can't reach a site from the sandbox, say so and tell me what you need.
- **No secrets in the repo.** Use `.dev.vars` locally (git-ignored) and `wrangler secret put` for production.
- **Keep it simple.** One Worker serving both the React SPA and the API. No extra infrastructure unless a requirement needs it.

## 3. Product scope

### In scope (v1)

| Area | Features |
|---|---|
| **Profiles** | Create, edit, delete (soft delete), list, search by name. Fields: full name, gender (m/f/o), date of birth, time of birth, "time unknown" flag, place of birth (text), latitude, longitude, IANA timezone, optional notes. Place search with autocomplete that fills lat/lon/timezone; manual override for lat/lon/tz. |
| **Kundali** | Generate for a profile with options: ayanamsa (default `lahiri`), chart style (`north` / `south`), language (`en` default). Store the full raw API response. Show chart, planetary positions, houses, and whatever else the API returns (dashas, yogas, doshas, nakshatra details, etc.). Regenerate creates a new version; latest is the default. |
| **Q&A** | Start a session for a profile's kundali. Chat-style UI, streamed answers. Suggested starter questions (career, marriage, health tendencies, finance, current dasha, education). Sessions list per profile with title (auto-generated from the first question), date and message count. Reopen any past session read-only or continue it. Rename / delete sessions. Copy an answer. |
| **General** | Responsive (works well on mobile), light and dark mode, loading/empty/error states everywhere, toast notifications. |

### Out of scope (v1)
Payments, public sign-up, matchmaking (kundali milan), PDF export, multi-tenant admin. Design the schema so these can be added later (e.g. every row has an `owner_id`).

## 4. Architecture

```
Browser (React SPA)
   │  fetch /api/*
   ▼
Cloudflare Worker  (single Worker, Hono router)
   ├── static assets  → React build (SPA fallback)
   ├── /api/profiles  → D1
   ├── /api/geocode   → Open-Meteo Geocoding API (proxied)
   ├── /api/kundali   → AskPanchang Kundali API → D1 (raw JSON stored)
   └── /api/sessions  → Workers AI (env.AI) ⇄ D1 (messages)
```

### Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Cloudflare Workers + **Static Assets** | One Worker serves SPA + API. Use Workers, not Pages. |
| Build | **Vite** + **`@cloudflare/vite-plugin`** | Dev server runs in the Workers runtime; bindings work locally. Scaffold with `npm create cloudflare@latest -- <name> --framework=react` or adapt a Vite React-TS project. |
| API router | **Hono** | Typed routes, middleware for errors/validation. |
| Validation | **Zod** | Shared schemas between client and server (`/shared`). |
| Database | **Cloudflare D1** | SQL migrations in `/migrations`, applied with `wrangler d1 migrations apply`. Use **Drizzle ORM** (D1 driver) or plain prepared statements; pick one and record it in CLAUDE.md. |
| AI | **Workers AI** binding (`env.AI`) | Optional **AI Gateway** in front for logs, caching and rate limits (config flag). |
| Frontend | **React 18+ + TypeScript**, **React Router**, **TanStack Query** | Query for server state; no Redux. |
| Styling | **Tailwind CSS** + small in-house component set (or shadcn/ui) | See §10 for visual direction. |
| Markdown | `react-markdown` + `remark-gfm` | For AI answers. Sanitize; no raw HTML. |
| Tests | **Vitest** + **`@cloudflare/vitest-pool-workers`** for Worker code; Vitest + Testing Library for UI | |
| Lint/format | ESLint + Prettier, `tsc --noEmit` | Strict TS. |
| Config | **`wrangler.jsonc`** | |

## 5. Repository layout

```
/
├── CLAUDE.md
├── README.md                 # setup, dev, deploy, env vars
├── wrangler.jsonc
├── vite.config.ts
├── package.json
├── migrations/               # D1 SQL migrations (0001_init.sql, …)
├── shared/                   # zod schemas + TS types used by both sides
│   ├── profile.ts
│   ├── kundali.ts
│   └── session.ts
├── worker/
│   ├── index.ts              # Hono app, mounts routes, falls through to ASSETS
│   ├── routes/
│   │   ├── profiles.ts
│   │   ├── geocode.ts
│   │   ├── kundali.ts
│   │   └── sessions.ts
│   ├── services/
│   │   ├── askpanchang.ts    # API client, timeouts, retries, response typing
│   │   ├── chartDigest.ts    # raw kundali JSON → compact LLM context
│   │   ├── llm.ts            # Workers AI adapter (model, streaming, schema)
│   │   └── prompts.ts        # system prompt + templates
│   ├── db/                   # queries / drizzle schema
│   └── lib/                  # errors, ids, rate limiting, logging
├── src/                      # React app
│   ├── main.tsx, App.tsx, routes.tsx
│   ├── pages/                # ProfilesList, ProfileForm, ProfileDetail, KundaliView, SessionView
│   ├── components/           # ChartNorth, ChartSouth, PlanetTable, DashaTimeline, ChatThread, …
│   ├── api/                  # typed fetch client + TanStack Query hooks
│   └── styles/
└── test/
    ├── fixtures/askpanchang-sample.json
    └── …
```

## 6. Data model (D1)

Use text UUIDs (or ULIDs) as primary keys and ISO-8601 UTC timestamps. Write this as `migrations/0001_init.sql`.

```sql
CREATE TABLE profiles (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL DEFAULT 'default',
  name          TEXT NOT NULL,
  gender        TEXT NOT NULL CHECK (gender IN ('m','f','o')),
  dob           TEXT NOT NULL,            -- YYYY-MM-DD
  tob           TEXT,                     -- HH:MM (24h), NULL if unknown
  tob_unknown   INTEGER NOT NULL DEFAULT 0,
  place         TEXT NOT NULL,            -- display string, e.g. "Hyderabad, Telangana, India"
  lat           REAL NOT NULL,
  lon           REAL NOT NULL,
  tz            TEXT NOT NULL,            -- IANA, e.g. Asia/Kolkata
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_profiles_owner_name ON profiles(owner_id, name);

CREATE TABLE kundalis (
  id            TEXT PRIMARY KEY,
  profile_id    TEXT NOT NULL REFERENCES profiles(id),
  ayanamsa      TEXT NOT NULL,
  chart_style   TEXT NOT NULL,
  lang          TEXT NOT NULL,
  request_json  TEXT NOT NULL,            -- exact payload sent
  response_json TEXT NOT NULL,            -- full raw API response
  digest        TEXT NOT NULL,            -- compact text used as LLM context (§9)
  input_hash    TEXT NOT NULL,            -- hash of birth data + options, to detect stale charts
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_kundalis_profile ON kundalis(profile_id, created_at DESC);

CREATE TABLE qa_sessions (
  id            TEXT PRIMARY KEY,
  profile_id    TEXT NOT NULL REFERENCES profiles(id),
  kundali_id    TEXT NOT NULL REFERENCES kundalis(id),
  title         TEXT NOT NULL,
  model         TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_sessions_profile ON qa_sessions(profile_id, updated_at DESC);

CREATE TABLE qa_messages (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES qa_sessions(id),
  role          TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete','streaming','error')),
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_messages_session ON qa_messages(session_id, created_at);
```

Rules:
- If a profile's birth data changes, its existing kundalis become **stale** (compare `input_hash`). Show a "Birth details changed — regenerate" banner. Old sessions stay linked to the kundali they were asked against.
- Sessions are pinned to one `kundali_id` so the stored answers always match the chart they were based on.

## 7. External integrations

### 7.1 AskPanchang Kundali API

- **Endpoint:** `POST https://askpanchang-api-edge.askpanchang.workers.dev/api/v1/kundali/generate`
- **Base URL in config** as `ASKPANCHANG_API_BASE` (so staging/prod can differ). Support an optional `ASKPANCHANG_API_KEY` secret sent as a header if set (header name configurable; leave unset by default).
- **Sample payload:**

```json
{
  "bd": {
    "nm": "Arjun Sharma",
    "g": "m",
    "dob": "1990-08-15",
    "tob": "14:30",
    "tz": "Asia/Kolkata",
    "lat": 17.385,
    "lon": 78.4867
  },
  "opt": { "ayan": "lahiri", "chart": "north", "lang": "en" }
}
```

- **Discovery step (Phase 2, do this first):** Call the endpoint with the sample payload and save the real response to `test/fixtures/askpanchang-sample.json`. Derive Zod schemas and TS types from it. Parse **leniently** (`.passthrough()`), because fields may be added. Document the response shape in CLAUDE.md. If the sandbox can't reach the API, stop and ask me to paste a sample response.
- Call the API **only from the Worker**, never the browser.
- 15 s timeout, one retry on 5xx/network error, map errors to clean messages (`KUNDALI_UPSTREAM_ERROR`, `KUNDALI_INVALID_INPUT`).
- Find out from the response whether the API returns a ready chart (SVG or house→planet map). Prefer rendering from structured data (§10.3); use a returned SVG only as a fallback.
- **Unknown birth time:** send `tob` as `12:00` and mark the kundali as "time-uncertain". Show a warning in the UI and tell the LLM (§9) that ascendant, houses and house-based readings are unreliable.

### 7.2 Place → coordinates and timezone

- Use the **Open-Meteo Geocoding API** (free, no key; returns lat, lon, country, admin areas and IANA timezone), proxied through `GET /api/geocode?q=`.
- Debounce input (300 ms), minimum 2 chars, cache responses with the Workers Cache API for 24 h.
- Show results as "City, State, Country". Selecting one fills lat/lon/tz. Allow manual edit of lat/lon/tz for villages the geocoder doesn't know.
- Keep the geocoder behind an interface so it can be swapped (e.g. for an AskPanchang place endpoint later).

### 7.3 Workers AI

- Binding `AI`. Model ID in config as `AI_MODEL`.
- **Pick the model by checking the current Workers AI catalog.** Requirements: strong instruction-following, a large context window (≥ 64k tokens), streaming support, and good Hindi/Telugu output if possible. Candidates to evaluate: `@cf/openai/gpt-oss-120b`, a current Qwen or DeepSeek large-context model, `@cf/meta/llama-3.3-70b-instruct` as fallback. Record the choice and reason in CLAUDE.md.
- Wrap all model calls in `worker/services/llm.ts` so the input format (`messages` vs. `input`), streaming parsing and the model ID live in one place. Some models use different input schemas; read the model's page before coding against it.
- Optional `AI_GATEWAY_ID`: when set, route calls through AI Gateway (logging, caching, rate limiting).

## 8. API routes

All JSON. Errors use `{ "error": { "code": string, "message": string, "details"?: unknown } }` with proper HTTP status. Validate every body and query with Zod.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness + D1 ping |
| GET | `/api/profiles?q=&cursor=` | List/search (paginated, newest first) |
| POST | `/api/profiles` | Create |
| GET | `/api/profiles/:id` | Detail incl. latest kundali summary + stale flag |
| PATCH | `/api/profiles/:id` | Update |
| DELETE | `/api/profiles/:id` | Soft delete |
| GET | `/api/geocode?q=` | Place search |
| POST | `/api/profiles/:id/kundali` | Generate (body: `{ ayanamsa?, chartStyle?, lang? }`) |
| GET | `/api/profiles/:id/kundali` | List versions |
| GET | `/api/kundali/:id` | Full kundali (parsed response + digest) |
| GET | `/api/profiles/:id/sessions` | List sessions |
| POST | `/api/profiles/:id/sessions` | Create session (uses latest kundali; 409 if none) |
| GET | `/api/sessions/:id` | Session + all messages |
| PATCH | `/api/sessions/:id` | Rename |
| DELETE | `/api/sessions/:id` | Soft delete |
| POST | `/api/sessions/:id/messages` | Ask a question → **streamed** answer (SSE) |

### Streaming contract for `POST /api/sessions/:id/messages`
1. Validate question (1–2000 chars). Insert user message. Insert assistant message with `status='streaming'`.
2. Build context (§9) and call the model with streaming.
3. Return `text/event-stream`. Events: `token` (`{ text }`), `done` (`{ messageId, tokensIn, tokensOut }`), `error` (`{ code, message }`).
4. Accumulate tokens server-side; on finish, update the assistant row to `complete` with full content. Use `ctx.waitUntil` so the DB write completes even if the client disconnects. On failure set `status='error'` and keep partial text.
5. If this is the session's first question, generate a short title (≤ 6 words) with a cheap second call or a heuristic, in `waitUntil`.

## 9. AI Q&A design

### 9.1 Chart digest
Raw API JSON is verbose. In `chartDigest.ts`, convert it once at generation time into a compact, deterministic text block (stored in `kundalis.digest`) containing, where the API provides it:

- Birth summary (name, gender, DOB, TOB or "time unknown", place, timezone, ayanamsa)
- Lagna (ascendant) sign + degree, Moon sign, nakshatra + pada, Sun sign
- Planet table: planet, sign, degree, house, nakshatra, retrograde, combust, dignity (exalted/debilitated/own/friend/enemy)
- House table: house, sign, lord, occupants
- Divisional charts present (at least D9 Navamsa; others if returned)
- Vimshottari dasha: current mahadasha/antardasha/pratyantardasha with dates, plus next few periods
- Yogas and doshas reported by the API (Manglik, Kaal Sarp, Sade Sati status, etc.)
- **Today's date** (inserted at question time, not stored) so the model can reason about current and upcoming periods

Unit-test the digest against the fixture (snapshot test). Keep it under ~3–4k tokens.

### 9.2 Prompt assembly (per question)
```
[system]    persona + rules (below) + output format
[system]    CHART DATA:\n<digest>\nToday: <YYYY-MM-DD>\nTime-uncertain: <yes/no>
[history]   last N turns of this session (trim oldest first to fit a token budget, e.g. 12k)
[user]      new question
```

### 9.3 System prompt (put in `prompts.ts`, versioned with a `PROMPT_VERSION` constant stored on each assistant message)
Write it to cover:
- Acts as an experienced Vedic (Jyotish) astrologer, using Parashari principles, sidereal zodiac with the chart's ayanamsa.
- **Grounds every statement in the supplied chart data.** Name the specific placements, lords, aspects, yogas or dasha periods behind each point. Never invent placements not in the data. If the data needed isn't present, say so.
- Structure: short direct answer first, then "Why (chart factors)", then "Timing" when relevant (dasha/transit windows), then optional practical remedies (mantra, charity, gemstone only with caution).
- Balanced and constructive tone; describe tendencies and timing windows, not certainties. No fear-mongering.
- **Safety rules:** no predictions of death, lifespan, or specific medical diagnoses; for health, legal or financial questions, give astrological perspective and recommend consulting a qualified professional. Don't advise stopping medical treatment. Don't push expensive remedies.
- If birth time is uncertain, say that house- and ascendant-based conclusions are unreliable and lean on Moon-based and planetary analysis.
- Answer in the session's language (`en` default; support `hi`, `te` via the profile/kundali `lang` setting or a per-session selector). Use Sanskrit terms with brief English glosses.
- Stay on topic: politely decline questions unrelated to the chart or astrology.
- Markdown output, concise (aim for 150–400 words unless the user asks for depth).

### 9.4 Starter questions
Show 6 chips on a new session, e.g.: "Give me an overview of this chart", "What does my current dasha indicate?", "Career and profession outlook", "Marriage and relationships", "Financial tendencies and wealth yogas", "Which planets are strongest and weakest?".

## 10. Frontend

### 10.1 Pages and routes
| Route | Page |
|---|---|
| `/` | Profiles list: search, cards/table with name, DOB, place, kundali status, last session date; "New profile" button |
| `/profiles/new`, `/profiles/:id/edit` | Profile form with place autocomplete, date/time pickers, "time unknown" toggle, advanced lat/lon/tz fields |
| `/profiles/:id` | Profile overview with tabs: **Kundali**, **Q&A sessions**, **Details** |
| `/profiles/:id/kundali/:kid?` | Kundali view: chart (North/South toggle), planet table, house table, dasha timeline, yogas/doshas, version picker, regenerate button |
| `/sessions/:id` | Chat thread: messages, streaming answer, input box, starter chips, stop button, copy button, session rename |

### 10.2 UX requirements
- Form validation inline (Zod schemas from `/shared`). Dates can't be in the future; time 24-hour with AM/PM display option.
- Generating a kundali shows a progress state; errors offer retry.
- Chat: auto-scroll unless the user scrolled up; Enter to send, Shift+Enter for newline; disable input while streaming; "Stop" aborts the fetch; show the chart summary (Lagna, Moon, current dasha) in a collapsible side panel (bottom sheet on mobile).
- Past sessions open instantly from D1 (no re-generation).
- Accessible: keyboard navigation, labelled inputs, visible focus, WCAG AA contrast.

### 10.3 Chart rendering
Build `ChartNorth` (diamond layout) and `ChartSouth` (fixed-sign grid) as React SVG components that take a normalized `{ house: number, sign: number, planets: { abbr, degree, retro }[] }[]` structure derived from the API response. Show planet abbreviations (Su, Mo, Ma, Me, Ju, Ve, Sa, Ra, Ke) with degrees and an "R" for retrograde; mark the Lagna. Scale to container width. Add D1 and D9 toggles if data exists.

### 10.4 Visual direction
Use the AskPanchang design language so the app feels part of that family: saffron / amber / teal / indigo palette, **Playfair Display** for headings, **DM Sans** for body, **Noto Serif Devanagari** for Devanagari text, **Phosphor** icons. Define colors as CSS variables / Tailwind theme tokens with light and dark variants.

## 11. Security, privacy and limits

- **Access control (v1):** protect the whole app with **Cloudflare Access** (Zero Trust, email allowlist). In the Worker, read the `Cf-Access-Authenticated-User-Email` header (verify the Access JWT when `ACCESS_AUD` is configured) and use it as `owner_id`; fall back to `'default'` in local dev. Every query filters by `owner_id`.
- Birth data is personal data: no logging of full payloads or chat content in production logs; log IDs and error codes only.
- Validate and size-limit all inputs. Escape/sanitize rendered markdown.
- **Rate limits:** per owner, e.g. 30 questions/hour and 20 kundali generations/hour (Workers Rate Limiting binding or a simple D1/KV counter). Return 429 with a friendly message.
- CORS: same-origin only (SPA and API share the Worker).
- Security headers on HTML responses (CSP, X-Content-Type-Options, Referrer-Policy).

## 12. Configuration

`wrangler.jsonc` (adjust names; verify keys against current docs):

```jsonc
{
  "name": "kundali-studio",
  "main": "worker/index.ts",
  "compatibility_date": "<today>",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "kundali-studio", "database_id": "<set after create>", "migrations_dir": "migrations" }
  ],
  "ai": { "binding": "AI" },
  "vars": {
    "ASKPANCHANG_API_BASE": "https://askpanchang-api-edge.askpanchang.workers.dev",
    "AI_MODEL": "<chosen model id>",
    "APP_NAME": "Kundali Studio"
  },
  "observability": { "enabled": true }
}
```

| Name | Kind | Required | Purpose |
|---|---|---|---|
| `DB` | D1 binding | yes | Data |
| `AI` | Workers AI binding | yes | LLM |
| `ASKPANCHANG_API_BASE` | var | yes | Kundali API base URL |
| `ASKPANCHANG_API_KEY` | secret | no | Sent as header if set |
| `AI_MODEL` | var | yes | Workers AI model ID |
| `AI_GATEWAY_ID` | var | no | Route via AI Gateway |
| `ACCESS_AUD` | var | no | Verify Cloudflare Access JWT |

Generate binding types with `wrangler types` and commit the result.

## 13. Testing

- **Worker (vitest-pool-workers):** profile CRUD; validation errors; kundali generation with the AskPanchang client mocked from the fixture; digest snapshot; session create → message stream → stored messages; stale-chart detection; owner isolation (user A can't read user B's data); rate limit returns 429.
- **LLM adapter:** mock `env.AI.run`, test SSE parsing and the error path (partial content saved with `status='error'`).
- **UI:** profile form validation, chart component renders planets in correct houses for the fixture, chat thread renders streamed tokens.
- **Manual smoke checklist** in README: create Arjun Sharma sample profile → generate → ask 3 questions → reload → session visible with all messages.

## 14. Phased plan

| Phase | Deliverable | Done when |
|---|---|---|
| **0. Scaffold** | Vite + React + TS + Cloudflare Vite plugin, Hono Worker, Tailwind, ESLint/Prettier, Vitest, `CLAUDE.md`, README, `wrangler.jsonc`, `/api/health` | `npm run dev` serves SPA and `/api/health`; tests and typecheck pass |
| **1. Profiles** | D1 migration, profile routes, geocode proxy, profile list/form/detail pages | Can create/edit/search/delete profiles with place autocomplete locally |
| **2. Kundali** | AskPanchang discovery + fixture, client, schemas, generate/list/get routes, digest, chart components, kundali view | Sample profile generates a kundali; chart and tables render from stored data; stale banner works |
| **3. Q&A** | LLM adapter, prompts, sessions + messages routes with SSE, chat UI, session list, titles | Streamed answers grounded in chart data; sessions persist and reopen after reload |
| **4. Hardening** | Access integration, rate limits, error states, security headers, a11y pass, dark mode, mobile layout | Checklist in §15 passes |
| **5. Deploy** | Remote D1 created + migrated, secrets set, deploy pipeline (§14.1), README deploy section | App live on `*.workers.dev` behind Access |

### 14.1 Deployment
- Preferred: **Cloudflare Workers Builds** connected to the GitHub repo (build `npm run build`, deploy `npx wrangler deploy`), with preview deployments for PRs if available.
- Alternative: GitHub Actions using `cloudflare/wrangler-action` with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets; run tests, apply D1 migrations (`wrangler d1 migrations apply DB --remote`), then deploy.
- Document both and set up the one I confirm (default: Workers Builds).

## 15. Definition of done

- [ ] All §3 in-scope features work end to end in production.
- [ ] Every API route validates input and returns the standard error shape.
- [ ] Tests pass in CI; typecheck and lint clean.
- [ ] AI answers cite chart factors and respect the safety rules in §9.3 (spot-check 10 varied questions, including a health one and an off-topic one).
- [ ] Unknown-birth-time profiles show warnings in UI and answers.
- [ ] Works on a 375 px wide screen and on desktop; dark mode correct.
- [ ] No secrets or personal data in the repo or production logs.
- [ ] README covers local setup, env vars, migrations and deploy; CLAUDE.md reflects final decisions.

## 16. Open decisions (use these defaults unless told otherwise)

| Decision | Default |
|---|---|
| Who uses the app | A small set of operators (me and family/astrologers), not public users |
| Auth | Cloudflare Access email allowlist |
| ORM | Drizzle with D1 (plain SQL acceptable if simpler) |
| Geocoder | Open-Meteo Geocoding API |
| Default chart options | `lahiri`, `north`, `en` |
| Answer languages | English first; Hindi and Telugu via session language selector |
| Model | Best current Workers AI model meeting §7.3, chosen after checking the catalog |
| Deploy | Workers Builds from `main`; PRs get preview builds |
