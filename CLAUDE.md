# CLAUDE.md — Kundali Studio

Product spec: `docs/BUILD_PROMPT.md` (the source of truth for scope, phases and rules).
Build status: **Phase 0 (scaffold) done.** Next: Phase 1 (profiles).

## Stack (installed versions)

| Layer   | Choice                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------ |
| Runtime | One Cloudflare Worker + Static Assets (`wrangler.jsonc`, SPA fallback, `run_worker_first: ["/api/*"]`) |
| Build   | Vite 8 + `@cloudflare/vite-plugin` (dev runs in workerd)                                               |
| API     | Hono 4, Zod 4 (schemas in `shared/`)                                                                   |
| DB      | D1, SQL migrations in `migrations/` (Drizzle planned for Phase 1)                                      |
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

- `worker/index.ts` — entry; `worker/app.ts` — `createApp()` builds the Hono app (all routes under `/api`).
- `worker/lib/errors.ts` — `AppError(status, code, message, details?)`; thrown anywhere, rendered by `app.onError` as `{ error: { code, message, details? } }`.
- `worker/env.d.ts` — secrets missing from `wrangler types` (`ASKPANCHANG_API_KEY`) and `GlobalProps.mainModule` (types `exports.default` in tests).
- `shared/` — zod schemas + types used by both sides. `shared/app.ts` holds `APP_NAME`.
- `src/api/client.ts` — `apiFetch(path, schema, init)`; throws `ApiRequestError` with the API error code.
- `src/routes.tsx` — route table (used by `createBrowserRouter` in the app and `createMemoryRouter` in tests).
- `src/styles/index.css` — design tokens as CSS variables on `:root` / `.dark`, mapped to Tailwind colours via `@theme inline` (`bg-surface`, `text-saffron`, …).
- `test/worker/*.test.ts` — run inside workerd; call the Worker with `exports.default.fetch()` from `cloudflare:workers`.
- `test/ui/*.test.tsx` — jsdom; stub `fetch` with `vi.stubGlobal`.

## Conventions

- Every API route validates input with zod and returns the standard error shape; throw `AppError` rather than building responses by hand.
- Never log request bodies, birth data or chat content. Log IDs and error codes only.
- Colours only via theme tokens (no raw hex in components). Dark mode = `.dark` class on `<html>`; the theme is saved in `localStorage.theme` (`light` | `dark`; absent = system).
- `matchMedia` and `localStorage` may be missing (jsdom, private mode): guard them.
- Strict TS with `noUncheckedIndexedAccess`; `verbatimModuleSyntax` → use `import type` for types.

## Decisions and gotchas

- **`@cloudflare/vitest-pool-workers` is deprecated** → use `@cloudflare/vitest-plugin` (`cloudflareTest()` Vite plugin in `vitest.config.ts`). Tests run with `remoteBindings: false`.
- **npm 10.9 crashes** (`Cannot read properties of null (reading 'edgesOut')`) when resolving the tree from scratch. Use `npx npm@11 install <pkg>` to add deps; `npm ci` with npm 10 works from the lockfile. npm 11 blocks install scripts unless approved: `allowScripts` in package.json lists esbuild and workerd (run `npx npm@11 install-scripts approve esbuild workerd` after upgrades that bump their versions).
- `wrangler types --strict-vars=false` so vars are typed as `string`, not literals.
- **D1 `database_id`** in `wrangler.jsonc` is a zero-UUID placeholder until the remote DB is created (Phase 5).
- **AI model (provisional):** `@cf/openai/gpt-oss-120b`. Third-party listings show ~128k context, streaming, tool calling. **Not yet verified** against developers.cloudflare.com (blocked from the build sandbox). Verify the input schema (`messages` vs `input`/Responses API) before Phase 3.

## Sandbox network notes

The cloud build sandbox reaches npm but **not** `developers.cloudflare.com`, `askpanchang-api-edge.askpanchang.workers.dev` or `geocoding-api.open-meteo.com`. Phase 2 discovery needs the AskPanchang host allowed or a pasted sample response.
