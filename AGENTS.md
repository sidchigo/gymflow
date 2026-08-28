# GymFlow Engineering Rules & Architecture Guide

## 1. Stack & Runtime

- Framework: Next.js 15 (App Router, Server Components by default)
- Language: TypeScript (Strict Mode enabled, zero `any` allowed)
- Styling: Tailwind CSS
- State & Caching: Upstash Redis (HTTP-based client)
- AI Engine: Google GenAI SDK or OpenCode free models compatible
- Validation: Zod (Mandatory at all external network boundaries)

## 2. Security & Token Isolation

- CRITICAL: Never expose third-party gym Bearer tokens to the browser.
- Store gym credentials exclusively in Redis keyed by `session:{userId}:gym_token` with an 82,800-second TTL (23 hours).
- Issue an internal encrypted, HttpOnly, Secure session cookie (`gymflow_session`) for client authentication.
- Never hardcode live gym URLs or domains in client code. Use `process.env.GYM_API_BASE_URL`.

## 3. Data Ingestion & LLM Optimization

- Strip boilerplate metadata from raw gym JSON before passing it to the LLM context.
- Always compare new timetable payloads with Redis cached snapshots to generate actionable diff logs.
- Never let the LLM generate unvalidated schedule updates via plain text; all schedule alterations MUST use tool/function calling (`replan_week_schedule`).

## 4. Coding Workflow

- Follow the specifications in `/specs/` strictly.
- When generating new features, write unit types and Zod schemas before route handlers.
- Verify each phase with `npx tsc --noEmit` and the evaluation harness in `/evals`.

## 5. Git & Branching Conventions

### Commit Messages
- Use [Conventional Commits](https://www.conventionalcommits.org/) format: `<type>(<scope>): <subject>`.
- **No commit body** — subject line only; keep it concise and to the point.
- Types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `ci`, `perf`, `style`.
- Example: `feat(auth): add session cookie encryption`

### Branch Naming
- `main` — production-ready code only.
- `feat/<short-description>` — new features (e.g. `feat/gym-token-proxy`).
- `fix/<short-description>` — bug fixes (e.g. `fix/redis-ttl-overflow`).
- `chore/<short-description>` — tooling / config changes.
- `docs/<short-description>` — documentation only changes.
