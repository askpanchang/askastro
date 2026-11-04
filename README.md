# Kundali Studio

Create birth profiles, generate Vedic kundali charts with the AskPanchang Kundali API, and hold
AI Q&A sessions about a chart on Cloudflare Workers AI. One Cloudflare Worker serves both the
React SPA and the `/api` routes.

> Status: v1 complete and live at https://kundali-studio.askpanchang.workers.dev (behind Cloudflare Access). See `docs/BUILD_PROMPT.md` for the full spec and phase plan.

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

Apply the database migrations once (and after pulling new ones):

```bash
npm run db:migrate:local
```

No Cloudflare login? Run `npm run dev:local`. Everything works except real AI answers. To try the Q&A flow offline, add `AI_MODEL=dev:echo` to `.dev.vars`: a development stand-in streams a canned answer that quotes the chart data it was given. Remove it before running tests.

## Manual smoke test

1. Create the sample profile: Arjun Sharma, male, 15 Aug 1990, 14:30, Hyderabad (pick it from the place search).
2. On the Kundali tab, generate a kundali (Lahiri, North). Check the chart, tables and dasha timeline.
3. On the Q&A tab, start a session and ask three questions (a starter chip, a typed question, and one you stop with **Stop**).
4. Reload the page and reopen the session from the Q&A tab: all questions and answers are still there.
5. Edit the birth time: the profile shows "Birth details changed", and the old session says it is tied to an earlier kundali.

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

| Name                   | Kind               | Required | Purpose                                                              |
| ---------------------- | ------------------ | -------- | -------------------------------------------------------------------- |
| `DB`                   | D1 binding         | yes      | Data                                                                 |
| `AI`                   | Workers AI binding | yes      | LLM                                                                  |
| `APP_NAME`             | var                | yes      | Display name                                                         |
| `ASKPANCHANG_API_BASE` | var                | yes      | Kundali API base URL                                                 |
| `ASKPANCHANG_API_KEY`  | secret             | no       | Sent as a header if set                                              |
| `AI_MODEL`             | var                | yes      | Default Workers AI model ID (admins can switch on the Settings page) |
| `AI_GATEWAY_ID`        | var                | no       | Route AI calls through AI Gateway                                    |
| `ACCESS_AUD`           | var                | no       | Verify the Cloudflare Access JWT                                     |

Secrets go in `.dev.vars` locally (git-ignored) and `wrangler secret put <NAME>` in production.

## Security

- **Sign-in:** the app is meant to sit behind Cloudflare Access (email allowlist). With `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` set, the Worker verifies the Access JWT on every API call and keeps each user's data separate. Leave them empty only for local development.
- **Limits:** per-user hourly limits on questions and kundali generation (429 with `Retry-After`).
- **Headers:** CSP, `X-Frame-Options: DENY`, `nosniff`, HSTS and a strict referrer policy on pages (`public/_headers`) and API responses; API responses are `no-store`.
- **Cross-site requests:** writes from other origins are rejected.
- **Privacy:** logs contain IDs and error codes only, never birth details or chat text.

## Deploy

Production is one Worker, `kundali-studio`, on `kundali-studio.askpanchang.workers.dev`, protected by a Cloudflare Access application of the same name (team `ask-panchang`). The D1 database `kundali-studio` is in APAC.

### Automatic (GitHub Actions, the default)

`.github/workflows/deploy.yml`:

- **Pull requests:** `npm ci`, `npm run check` and `npm run build`.
- **Pushes to `main`** (or a manual run): the same checks, then `wrangler d1 migrations apply DB --remote`, `wrangler deploy`, and a smoke check that `/` redirects to the Access login.

It needs two repository secrets (Settings → Secrets and variables → Actions): `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token needs Workers Scripts: Edit, D1: Edit and Account Settings: Read on the account.

### Manual

```bash
npx wrangler login
npm run db:migrate:remote
npm run deploy
```

### One-time setup (already done for production)

1. Create the database: `npx wrangler d1 create kundali-studio --location apac` (location can't change later), and put its ID in `wrangler.jsonc`.
2. In Zero Trust, create a self-hosted Access application for the Worker's hostname, with an Allow policy listing the operators' emails. Turn on a login method (for example One-time PIN) for people outside the Cloudflare account.
3. Set the application's audience tag and the admin list as Worker secrets: `npx wrangler secret put ACCESS_AUD` and `npx wrangler secret put ADMIN_EMAILS`. It is a secret, not a var, so local dev stays login-free. `ACCESS_TEAM_DOMAIN` is a var in `wrangler.jsonc`.
4. Keep `preview_urls: false` in `wrangler.jsonc`: preview hostnames are not covered by the Access application.

### Workers Builds (alternative)

Connect the repo under Workers & Pages → `kundali-studio` → Settings → Build: build command `npm run build`, deploy command `npx wrangler deploy`. Migrations still need running (add `npx wrangler d1 migrations apply DB --remote` before the deploy command). Use either Workers Builds or the GitHub workflow, not both.

### Adding people (family)

1. **Let them sign in:** Zero Trust → Settings → Authentication → add **One-time PIN** (once). Then Access → Applications → Kundali Studio → Policies → add their email.
2. **Share profiles with them:** open a profile → **Share** → enter their email. They can view the profile and kundali and ask their own questions (10 per hour); their Q&A sessions are private to them. They can't edit, regenerate, delete or create profiles. Remove someone from the same dialog.
3. **Admins** (who can create and share profiles) are listed in the `ADMIN_EMAILS` Worker secret: `npx wrangler secret put ADMIN_EMAILS` with a comma-separated list.
