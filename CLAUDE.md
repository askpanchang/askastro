# CLAUDE.md — Kundali Studio

Product spec: `docs/BUILD_PROMPT.md` (the source of truth for scope, phases and rules).
Build status: **Phases 0–2 done** (scaffold, profiles, kundali). Next: Phase 3 (Q&A).

## Stack (installed versions)

| Layer   | Choice                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------ |
| Runtime | One Cloudflare Worker + Static Assets (`wrangler.jsonc`, SPA fallback, `run_worker_first: ["/api/*"]`) |
| Build   | Vite 8 + `@cloudflare/vite-plugin` (dev runs in workerd)                                               |
| API     | Hono 4, Zod 4 (schemas in `shared/`)                                                                   |
| DB      | D1, SQL migrations in `migrations/`, plain prepared statements in `worker/db/` (no ORM)                |
| AI      | Workers AI binding `AI`, model in `AI_MODEL` var                                                       |
| UI      | React 19, React Router 8 (data router), TanStack Query 5, Tailwind CSS 4, Phosphor icons               |
| Tests   | Vitest 5 + `@cloudflare/vitest-plugin` (worker project) and jsdom + Testing Library (ui project)       |
| Lint    | ESLint 10 flat config + typescript-eslint, Prettier, `tsc -b` (strict)                                 |

## Commands

```bash
npm run dev          # Vite + workerd; AI binding is remote, needs `wrangler login`
npm run dev:local    # fully offline (CF_REMOTE_BINDINGS=false); AI calls fail
npm run check        # typecheck + lint + format:check + tests  (run before every commit)
npm test             # vitest run (both projects)
npm run build        # tsc -b && vite build → dist/
npm run cf-typegen   # regenerate worker-configuration.d.ts after editing wrangler.jsonc
npm run db:migrate:local / db:migrate:remote
```

## Layout

- `worker/index.ts` — entry; `worker/app.ts` — `createApp(deps)` builds the Hono app (all routes under `/api`; `deps` lets tests swap services such as the geocoder). Middleware: 64 KB body limit, `ownerMiddleware`.
- `worker/routes/*` — one Hono sub-app per resource. `worker/db/*` — SQL + row↔API mapping. `worker/services/*` — external APIs.
- `worker/lib/validate.ts` — `parseJson` / `parseQuery` / `parseValue` throw `VALIDATION_ERROR` (400) with `z.flattenError` details (`{ formErrors, fieldErrors }`).
- `worker/lib/owner.ts` — `c.get('ownerId')` = Access email header, else `'default'`. Every query filters by owner (kundalis/sessions via their profile).
- `worker/lib/hash.ts` — `chartInputHash(profile, options)`: SHA-256 of chart-relevant birth data (not name/notes) + ayanamsa/chart/lang. A kundali is stale when this differs from its stored `input_hash`.
- `worker/lib/cursor.ts` — opaque keyset cursor over `(created_at DESC, id DESC)`.
- `worker/services/askpanchang.ts` — `buildKundaliRequest(profile, options)` (unknown time → `12:00`, place sent as `loc`) and `AskPanchangClient` (15 s timeout, one retry on 5xx/network, `KUNDALI_INVALID_INPUT` 422 / `KUNDALI_UPSTREAM_ERROR` 502, optional key in header `ASKPANCHANG_API_KEY_HEADER`). Returns `{ data, raw }`; `raw` is stored verbatim in `kundalis.response_json`. Swappable via `createApp({ kundaliClient })`.
- `worker/services/chartDigest.ts` — `buildChartDigest({ data, profile, timeUncertain, asOfSec })`: deterministic LLM context (~1.5k tokens for the fixture). Stored at generation time; Phase 3 should rebuild it with `asOfSec = now` per question so "current dasha" and Sade Sati status are right (transits/dosha flags stay as of generation).
- `shared/astro.ts` + `shared/astroLabels.generated.ts` — code → label maps. The generated file comes from `GET /api/v1/dict?lang=en` (v2026.7); `/api/v1/dict?lang=hi|te` has Hindi/Telugu labels if needed.
- `shared/dasha.ts` — `currentDasha(data, atSec)` (MD/AD from the API, PD computed with `subPeriods`), verified against the API's `dasha_now`. `shared/chartModel.ts` — `toChartHouses(data, 'D1'|'D9'|…)` normalized chart for `ChartNorth`/`ChartSouth`.
- `worker/services/geocoder.ts` — `Geocoder` interface + `OpenMeteoGeocoder`. `/api/geocode` caches results 24 h in the Cache API (`caches.open('geocode')`).
- `worker/lib/errors.ts` — `AppError(status, code, message, details?)`; thrown anywhere, rendered by `app.onError` as `{ error: { code, message, details? } }`.
- `worker/env.d.ts` — secrets missing from `wrangler types` (`ASKPANCHANG_API_KEY`) and `GlobalProps.mainModule` (types `exports.default` in tests).
- `shared/` — zod schemas + types used by both sides. `shared/app.ts` holds `APP_NAME`.
- `src/api/client.ts` — `apiFetch(path, schema, init)`; throws `ApiRequestError` with the API error code.
- `src/routes.tsx` — route table (used by `createBrowserRouter` in the app and `createMemoryRouter` in tests).
- `src/styles/index.css` — design tokens as CSS variables on `:root` / `.dark`, mapped to Tailwind colours via `@theme inline` (`bg-surface`, `text-saffron`, …).
- `src/pages/*` — ProfilesListPage, ProfileFormPage (new + edit), ProfileDetailPage (tabs via `?tab=`). `src/components/*` — ui primitives (`Button`, `inputClass`, `Spinner`, `ErrorState`, `EmptyState`), `ToastProvider`/`useToast`, `ConfirmDialog` (native `<dialog>`), `PlaceAutocomplete` (ARIA combobox).
- `test/worker/*.test.ts` — run inside workerd; migrations applied in `test/worker/setup.ts`. Use `api(path, { owner, json })` from `helpers.ts`, and `freshOwner()` per test (storage is shared across tests in a file). Mock outbound HTTP with `vi.spyOn(globalThis, 'fetch')`.
- `test/ui/*.test.tsx` — jsdom. `renderApp(path)` + `mockApi({ 'GET /api/x': handler })` from `renderApp.tsx`.

## Conventions

- **Run automated tests sparingly** (owner's instruction). Don't re-run the suite after every edit; run the relevant tests once a feature is complete, and `npm run check` once before each commit. Prefer typecheck/lint for quick feedback.

- Every API route validates input with zod and returns the standard error shape; throw `AppError` rather than building responses by hand.
- Never log request bodies, birth data or chat content. Log IDs and error codes only.
- Colours only via theme tokens (no raw hex in components). Dark mode = `.dark` class on `<html>`; the theme is saved in `localStorage.theme` (`light` | `dark`; absent = system).
- `matchMedia` and `localStorage` may be missing (jsdom, private mode): guard them.
- Strict TS with `noUncheckedIndexedAccess`; `verbatimModuleSyntax` → use `import type` for types.

## API (implemented so far)

`GET /api/health` · `GET|POST /api/profiles` (list: `q`, `cursor`, `limit` ≤ 50 → `{ items, nextCursor }`; items carry `kundaliStatus` none/current/stale and `lastSessionAt`) · `GET|PATCH|DELETE /api/profiles/:id` (detail → `{ profile, latestKundali }`; PATCH re-validates the merged row; DELETE is soft and returns `{ ok: true }`) · `GET /api/geocode?q=&lang=` · `POST /api/profiles/:id/kundali` (body optional: `{ ayanamsa: lahiri|raman, chartStyle: north|south, lang: en|hi|te }` → 201 `{ kundali }`) · `GET /api/profiles/:id/kundali` (versions, newest first, each with `stale`, `timeUncertain`) · `GET /api/kundali/:id` (`{ kundali: { …version, data, digest } }`).

UI routes: `/profiles/:id` (Kundali tab = latest version), `/profiles/:id/kundali/:kid` (a specific version).

Profile rules: `tobUnknown` ⇒ `tob` stored as NULL; otherwise `tob` required (HH:MM). DOB must be a real date between 1800 and "today" in UTC+14. `tz` must be a valid IANA zone.

## AskPanchang Kundali API (discovered Phase 2)

- `POST /api/v1/kundali/generate`, body `{ bd: { nm, g, dob, tob, tz, lat, lon, loc }, opt: { ayan, chart, lang, div? } }`. No auth today. OpenAPI at `/openapi.json` (response schema undocumented); code dictionary at `/api/v1/dict`.
- Response (fixture: `test/fixtures/askpanchang-sample.json`, ~36 KB): `info` (lagna/rashi/n/pd are sign/nakshatra codes, asc_deg/min, ayan_val, `dt` Unix), `dasha_now` (md/ad/pd/sd/prd planet codes), `charts` (D1–D60, CHALIT, MOON, SUN: 12 × `{ h, r, p[], asc? }`), `pl` (per planet: p, r, deg, min, n, pd, h, dig, rx, cmb, sl, nl, r9 = D9 sign, fl[]), `houses` (h, r, lord, lh, p[], sav), `aspects` (a → b, typ = aspect number), `dosha`/`yogas` (id, val|q, txt), `dasha` (md, from, to Unix s, ad[]), `yogini`, `shadbala` (ratio = rupas/required), `birth` (panchang codes), `readings` (texts), `karakas`, `avak`, `ashtak`, `rel`, `upagrahas`, `ss` (Sade Sati/Panoti windows), `transits`, `ins`.
- Codes: planets 1 Sun … 7 Saturn, 8 Rahu, 9 Ketu; signs 1 Aries … 12 Pisces; nakshatras 1–27; dignity 0 neutral, 1 own, 2 exalted, 3 debilitated, 4 friendly, 5 enemy, 6 mooltrikona.
- **Only `lahiri` and `raman` ayanamsas work**; any other name silently falls back to Lahiri, so the app allow-lists them. `chart` and `lang` don't change the response (readings stay English); we store `chartStyle` as the default rendering and `lang` as the default Q&A answer language.
- Invalid input (bad date, lat 999) returns a plain-text **500**, not 422, so validate before calling.
- Response parsing is lenient (`z.looseObject`); only info, charts, pl, houses and dasha are required.

## Decisions and gotchas

- **`@cloudflare/vitest-pool-workers` is deprecated** → use `@cloudflare/vitest-plugin` (`cloudflareTest()` Vite plugin in `vitest.config.ts`). Tests run with `remoteBindings: false`.
- **npm 10.9 crashes** (`Cannot read properties of null (reading 'edgesOut')`) when resolving the tree from scratch. Use `npx npm@11 install <pkg>` to add deps; `npm ci` with npm 10 works from the lockfile. npm 11 blocks install scripts unless approved: `allowScripts` in package.json lists esbuild and workerd (run `npx npm@11 install-scripts approve esbuild workerd` after upgrades that bump their versions).
- **No ORM:** plain D1 prepared statements; SQL migrations are the schema source of truth (BUILD_PROMPT allows this; Drizzle would duplicate the schema).
- **Owner header is not verified yet.** Phase 4 must verify the Access JWT (`ACCESS_AUD`) before production.
- `kundalis.time_uncertain` (migration 0002) records unknown-time charts; the request payload can't distinguish them from a real noon birth.
- **workerd can't use the sandbox's HTTPS proxy** (it does its own DNS), so in the cloud build sandbox the local Worker can't reach AskPanchang/Open-Meteo. For manual testing there, run a Node relay (Node honours the proxy with `NODE_USE_ENV_PROXY=1`) and point `ASKPANCHANG_API_BASE` at it via `.dev.vars`. Not needed on a normal machine or in production. Tests read `.dev.vars` too, so assert against `env.ASKPANCHANG_API_BASE`, not a literal URL.
- React Compiler lint (`react-hooks/purity`) forbids `Date.now()` in render; use `useNowSec()`.
- `qa_messages` has no `prompt_version` column yet; add it in a Phase 3 migration (BUILD_PROMPT §9.3).
- Zod skips object-level `superRefine` while field errors exist, so the form adds the "time required" error itself (`ProfileFormPage.validateProfileForm`).
- Playwright: don't `page.route('**/api/geocode**')` — it also matches Vite's `/src/api/geocode.ts` module. Use a regex like `/\/api\/geocode\?/`.
- `wrangler types --strict-vars=false` so vars are typed as `string`, not literals.
- **D1 `database_id`** in `wrangler.jsonc` is a zero-UUID placeholder until the remote DB is created (Phase 5).
- **AI model (provisional):** `@cf/openai/gpt-oss-120b`. Third-party listings show ~128k context, streaming, tool calling. **Not yet verified** against developers.cloudflare.com (blocked from the build sandbox). Verify the input schema (`messages` vs `input`/Responses API) before Phase 3.

## Sandbox network notes

The cloud environment now allows `askpanchang-api-edge.askpanchang.workers.dev`, `developers.cloudflare.com` and `geocoding-api.open-meteo.com` (from shell tools; see the workerd note above for the local Worker).
