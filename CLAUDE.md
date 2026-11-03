# CLAUDE.md — Kundali Studio

Product spec: `docs/BUILD_PROMPT.md` (the source of truth for scope, phases and rules).
Build status: **Phases 0–1 done** (scaffold, profiles). Next: Phase 2 (kundali).

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

- Every API route validates input with zod and returns the standard error shape; throw `AppError` rather than building responses by hand.
- Never log request bodies, birth data or chat content. Log IDs and error codes only.
- Colours only via theme tokens (no raw hex in components). Dark mode = `.dark` class on `<html>`; the theme is saved in `localStorage.theme` (`light` | `dark`; absent = system).
- `matchMedia` and `localStorage` may be missing (jsdom, private mode): guard them.
- Strict TS with `noUncheckedIndexedAccess`; `verbatimModuleSyntax` → use `import type` for types.

## API (implemented so far)

`GET /api/health` · `GET|POST /api/profiles` (list: `q`, `cursor`, `limit` ≤ 50 → `{ items, nextCursor }`; items carry `kundaliStatus` none/current/stale and `lastSessionAt`) · `GET|PATCH|DELETE /api/profiles/:id` (detail → `{ profile, latestKundali }`; PATCH re-validates the merged row; DELETE is soft and returns `{ ok: true }`) · `GET /api/geocode?q=&lang=`.

Profile rules: `tobUnknown` ⇒ `tob` stored as NULL; otherwise `tob` required (HH:MM). DOB must be a real date between 1800 and "today" in UTC+14. `tz` must be a valid IANA zone.

## Decisions and gotchas

- **`@cloudflare/vitest-pool-workers` is deprecated** → use `@cloudflare/vitest-plugin` (`cloudflareTest()` Vite plugin in `vitest.config.ts`). Tests run with `remoteBindings: false`.
- **npm 10.9 crashes** (`Cannot read properties of null (reading 'edgesOut')`) when resolving the tree from scratch. Use `npx npm@11 install <pkg>` to add deps; `npm ci` with npm 10 works from the lockfile. npm 11 blocks install scripts unless approved: `allowScripts` in package.json lists esbuild and workerd (run `npx npm@11 install-scripts approve esbuild workerd` after upgrades that bump their versions).
- **No ORM:** plain D1 prepared statements; SQL migrations are the schema source of truth (BUILD_PROMPT allows this; Drizzle would duplicate the schema).
- **Owner header is not verified yet.** Phase 4 must verify the Access JWT (`ACCESS_AUD`) before production.
- `qa_messages` has no `prompt_version` column yet; add it in a Phase 3 migration (BUILD_PROMPT §9.3).
- Zod skips object-level `superRefine` while field errors exist, so the form adds the "time required" error itself (`ProfileFormPage.validateProfileForm`).
- Playwright: don't `page.route('**/api/geocode**')` — it also matches Vite's `/src/api/geocode.ts` module. Use a regex like `/\/api\/geocode\?/`.
- `wrangler types --strict-vars=false` so vars are typed as `string`, not literals.
- **D1 `database_id`** in `wrangler.jsonc` is a zero-UUID placeholder until the remote DB is created (Phase 5).
- **AI model (provisional):** `@cf/openai/gpt-oss-120b`. Third-party listings show ~128k context, streaming, tool calling. **Not yet verified** against developers.cloudflare.com (blocked from the build sandbox). Verify the input schema (`messages` vs `input`/Responses API) before Phase 3.

## Sandbox network notes

The cloud build sandbox reaches npm but **not** `developers.cloudflare.com`, `askpanchang-api-edge.askpanchang.workers.dev` or `geocoding-api.open-meteo.com`. Phase 2 discovery needs the AskPanchang host allowed or a pasted sample response.
