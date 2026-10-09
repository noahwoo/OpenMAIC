# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

OpenMAIC (Open Multi-Agent Interactive Classroom): a Next.js 16 / React 19 / TypeScript app that turns a topic or uploaded material into a classroom (slides, quizzes, interactive HTML, PBL) delivered by AI teacher/classmate agents with TTS and a whiteboard. Since 1.2.0 it is **server-first**: generation, model configuration and all persistence live on the server and require PostgreSQL and a long-running Node process (no browser-storage fallback, no Vercel).

## Commands

Package manager is pnpm (Node >= 22.19). `pnpm install` runs `postinstall`, which builds every workspace package (`build:packages`) — re-run `pnpm build:packages` after editing anything under `packages/` that the app imports from `dist`.

```bash
pnpm db:up / pnpm db:down     # local Postgres in Docker on 127.0.0.1:5432
pnpm dev                      # refuses to start without DATABASE_URL (set in .env.local)
pnpm build && pnpm start

# CI's checks (run all before pushing)
pnpm check                    # prettier --check   (pnpm format to write)
pnpm lint                     # eslint             (pnpm lint --fix)
npx tsc --noEmit
pnpm check:i18n-keys          # every locale must have exactly en-US.json's keys
pnpm test                     # root vitest: tests/**/*.test.ts

# Single test
npx vitest run tests/path/to/file.test.ts
npx vitest run -t "test name"

# Workspace packages
pnpm --filter @openmaic/<dsl|generation|importer|storage|renderer|editor> test
pnpm --filter @openmaic/generation run typecheck

pnpm test:e2e                 # Playwright (e2e/tests), port 3002, needs DATABASE_URL
pnpm eval:<name>              # offline LLM eval harnesses in eval/ (need real keys)
```

Unit tests are hermetic: `.env.local` is not loaded unless `TEST_LOAD_LOCAL_ENV=1`.

`pnpm dev` builds the standalone HTML player (`lib/standalone-player`, used by "Export as HTML") only once at startup; after editing it run `pnpm build:standalone-player`.

## Configuration

- `.env.local` (from `.env.example`) holds keys and server options. Adding/renaming an operator-facing env var requires updating `.env.example` in the same change (optional?, default, build-time vs runtime).
- `openmaic.yml` (from `openmaic.example.yml`, or `OPENMAIC_CONFIG`) declares **providers** and assigns a model to each **slot** (`llm`, `course.outline`, `course.content`, `tts`, `image`, `video`, `webSearch`, …). Parsed/resolved in `lib/server/model-config/` (`openmaic-yml.ts`, `resolve-slot.ts`, `legacy-config.ts` translates pre-1.2 env-var config). Docs: `packages/docs/content/docs/configuration.mdx`.

## Architecture

**Boot (`instrumentation.ts`)** is the process-scoped entry point: fatal config validation (DATABASE_URL, model config, asset quota, owner identity, host hooks — a bad config exits the process), schema checks, then background workers: the generation runner, material extractor, legacy classroom import, asset collector, and (when enabled) the agent runtime runner + Postgres LISTEN/NOTIFY event bus. Anything periodic belongs here, not in a route module. `middleware.ts` gates `/workbench` and establishes the anonymous owner cookie.

**Server course generation** — `lib/server/generation/`: `run/` is a durable, resumable run engine (store, runner, retry, deadline, SSE) that survives restarts; `steps/` are the pipeline stages (material-analysis, research, outline, scene-content, scene-actions, narration, image, video). The pure, app-agnostic contracts and prompt assets live in `packages/@openmaic/generation`. The browser only starts/follows runs via `lib/generation-run-client/` and `app/api/generation-runs`.

**LLM access** — all server-side model calls must go through `callLLM` / `streamLLM` in `lib/ai/llm.ts` (usage accounting, `LLM_THINKING_DISABLED`, per-provider thinking config). ESLint forbids importing `generateText`/`streamText` from `ai` (static or dynamic) everywhere except `lib/ai/llm.ts`, `eval/`, and `tests/`.

**Live classroom** — `lib/orchestration/director-graph.ts` is a LangGraph StateGraph doing one director→agent round per request (director picks the next agent; single-agent mode uses code, not an LLM); the client serializes requests to drive multi-agent discussion, streamed over SSE from `app/api/chat`. Playback of scene actions (speech, whiteboard, spotlight, etc.) is `lib/playback/` + `lib/action/engine.ts`; client state is Zustand stores in `lib/store/`.

**Persistence** — `lib/persistence/` (server provider over `pg`, owner-scoped documents/assets/materials, schema bootstrap) built on the pluggable `@openmaic/storage` primitives. Identity: `lib/server/identity/`. Hosts embedding OpenMAIC extend via registered hooks (`lib/server/persistence-hooks`, `lib/server/generation-run-hooks`, owner auth methods) — see comments in `instrumentation.ts`. Outbound provider fetches go through SSRF-guarded helpers in `lib/server/` (`ssrf-guard.ts`, `provider-fetch.ts`, pinned dispatcher); don't use raw `fetch` for user-supplied URLs.

**Agent workbench** (`app/workbench`, `lib/server/agent-runtime`, `skills/agent-runtime`) is feature-flagged (`lib/config/feature-flags.ts`) and needs the agent runtime configured.

**Export** — PPTX via vendored `packages/pptxgenjs` + `mathml2omml`; HTML via the standalone player; MP4 via `lib/video-export` (compiles to a Hyperframes project) rendered by the separate, optional `render-service/` (own package/tsconfig, excluded from root lint; used only when `RENDER_SERVICE_URL` is set).

### Workspace packages (`packages/@openmaic/*`)

`dsl` (slide document contract: types, JSON Schema, validators, migrations — the root dependency of the others), `renderer`, `editor`, `importer` (.pptx parsing; its bundle is synced into `public/vendor` by `scripts/sync-maic-importer.mjs`), `storage`, `generation`. `packages/docs` is a standalone docs site outside the workspace.

- **Published packages (`dsl`, `storage`, `renderer`, `importer`) require a semver `version` bump in the same PR when any publishable file changes** — CI (`scripts/check-package-version-bumps.mjs`) fails otherwise. Below 1.0.0, minor = breaking. Narrowing what a `dsl` document may contain is breaking. Never publish manually.
- The install must not rewrite tracked files under `packages/@openmaic` (e.g. renderer's generated fonts.css); if it does, commit the regenerated output.

### Lint-enforced module boundaries

`eslint.config.mjs` encodes boundaries as errors; respect them rather than disabling:
- `@openmaic/renderer`, `storage`, `generation` must not contain any `@/…` host-app path string — inject host concerns via props/callbacks/params.
- `lib/choreography` and `lib/video-export` have import allowlists (pure Node, no React/DOM, no `@/…`; app imports them, never the reverse).
- `lib/pbl/v2/operations/kernel` must not import `operations/runtime`.

## Conventions

- All user-facing UI text must be i18n'd: add keys to `lib/i18n/locales/en-US.json` and every other locale (12 locales; see `lib/i18n/TRANSLATION_GUIDE.md`). `@/` aliases the repo root.
- Conventional Commits (`feat(scope): …`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`, `style`); branches `feat/`, `fix/`, `docs/` off `main`. PRs must link an issue and note if AI-assisted; refactor-only PRs aren't accepted unless requested.
