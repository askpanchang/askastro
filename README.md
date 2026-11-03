# Kundali Studio

Create birth profiles, generate Vedic kundali charts with the AskPanchang Kundali API, and hold
AI Q&A sessions about a chart on Cloudflare Workers AI. One Cloudflare Worker serves both the
React SPA and the `/api` routes.

> Status: Phase 0 (scaffold). See `docs/BUILD_PROMPT.md` for the full spec and phase plan.

## Requirements

- Node.js 22+
- A Cloudflare account with Workers AI and D1 (for remote AI and deploys)

## Local setup

```bash
npm ci
cp .dev.vars.example .dev.vars   # optional secrets for local dev
npx wrangler login               # needed for the Workers AI binding
npm run dev
```

Open the printed URL. `/api/health` should return `{"status":"ok",...,"db":"ok"}`.

No Cloudflare login? Run `npm run dev:local`. Everything works except AI calls.

## Scripts

| Script                                           | What it does                                                 |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `npm run dev` / `dev:local`                      | Dev server (Vite + workerd), with or without remote bindings |
| `npm run check`                                  | Typecheck, lint, format check, tests                         |
| `npm test`                                       | Worker tests (in workerd) and UI tests (jsdom)               |
| `npm run build`                                  | Production build into `dist/`                                |
| `npm run deploy`                                 | Build and `wrangler deploy`                                  |
| `npm run cf-typegen`                             | Regenerate binding types after editing `wrangler.jsonc`      |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply D1 migrations                                          |

## Configuration

| Name                   | Kind               | Required | Purpose                           |
| ---------------------- | ------------------ | -------- | --------------------------------- |
| `DB`                   | D1 binding         | yes      | Data                              |
| `AI`                   | Workers AI binding | yes      | LLM                               |
| `APP_NAME`             | var                | yes      | Display name                      |
| `ASKPANCHANG_API_BASE` | var                | yes      | Kundali API base URL              |
| `ASKPANCHANG_API_KEY`  | secret             | no       | Sent as a header if set           |
| `AI_MODEL`             | var                | yes      | Workers AI model ID               |
| `AI_GATEWAY_ID`        | var                | no       | Route AI calls through AI Gateway |
| `ACCESS_AUD`           | var                | no       | Verify the Cloudflare Access JWT  |

Secrets go in `.dev.vars` locally (git-ignored) and `wrangler secret put <NAME>` in production.

## Deploy

Covered in Phase 5 (Workers Builds from `main`; GitHub Actions alternative).
