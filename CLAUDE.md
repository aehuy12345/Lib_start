# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Pre-implementation, tooling scaffolded. `PRD.md` (Vietnamese-language spec for a library borrow/return management system) is the source of truth for requirements; read it before designing any feature. `tech.md` tracks which tools, MCP servers, accounts and libraries are installed or still missing — update it when that changes.

- `client/` — Vite + React (JS), Tailwind v4 via `@tailwindcss/vite`, Vitest + Testing Library, Playwright (`e2e/`). No app code yet beyond the Vite template.
- `server/` — Express 5 (CommonJS JS), Prisma 7.10.1 pinned (npm `latest` is an 8.x RC) with `prisma-client-js` generator + `@prisma/adapter-pg` (Prisma 7 requires a driver adapter: `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`), `bcryptjs` instead of native `bcrypt`. Only `/api/health` exists. `prisma/schema.prisma` has no models until the ERD is approved. Env template: `server/.env.example`.

## Commands

```bash
# client/
npm run dev          # Vite dev server, http://localhost:5173
npm run build
npm test             # Vitest unit tests (single file: npx vitest run path/to/file)
npm run test:e2e     # Playwright, starts dev server automatically
# server/
npm run dev          # nodemon src/index.js (PORT default 5000)
npm test             # Vitest + Supertest (single file: npx vitest run tests/x.test.js)
npx prisma validate | npx prisma generate | npm run prisma:migrate
```

## Development methodology: Waterfall

Phases run in order; do not start a phase before the previous one is signed off by the user.

1. **Requirement** — DONE (`PRD.md`).
2. **Design** — IN PROGRESS, in this order:
   1. **DONE, approved 2026-10-21.** Business flows in Mermaid, one file per PRD feature, saved to `design/flows/<feature-code>-<slug>.md` (e.g. `2.4.2-xac-nhan-tra-sach.md`). Each file covers happy case and edge cases; `design/flows/README.md` is the index. The user accepted every `[Giả định]` and proposal in the flow files; treat them as decided requirements.
   2. **IN REVIEW (drafted 2026-10-21).** ERD (Mermaid) in `design/erd/erd.md`, derived from the flows and the decisions in `design/flows/README.md`. Waiting for user approval; its `[Giả định]` and open questions are not decided yet.
   3. Migrate the schema to Supabase through the Supabase MCP (`apply_migration`), after the ERD is approved. Needs a Supabase project first.
3. Implementation → Testing → Deployment: follow PRD Part 3 phase order, using the per-feature workflow below.

## Implementation workflow (per feature)

- **One git branch per feature.** Each PRD feature (2.x.x) is built on its own new branch, named `feature/<feature-code>-<slug>` (same slug as its flow file, e.g. `feature/2.4.2-xac-nhan-tra-sach`). Do not mix features on one branch.
- **A feature is done only when all three test layers pass:**
  1. **Unit tests** — cover the business rules and edge cases from the feature's flow file in `design/flows/`.
  2. **API tests** — via the **Postman MCP**: a collection per feature covering happy case, validation errors and permission (role) checks for each endpoint.
  3. **E2E tests** — via the **Playwright MCP**: run the feature's user flows end to end in the browser.
- Postman MCP (`https://mcp.postman.com/mcp`, OAuth login) and Playwright MCP (`npx @playwright/mcp@latest`) are registered in `.mcp.json`.

Conventions for design docs: write in Vietnamese like the PRD, reference feature codes from PRD (2.x.x), mark anything not stated in the PRD as `[Giả định]` or `[Cần làm rõ]` instead of silently deciding. If a flow reveals a PRD gap, record it in the flow file and in the README open-questions list; do not edit `PRD.md` without the user's approval.

## Planned tech stack (PRD Part 4)

- Frontend: React, TailwindCSS, Context API, Axios, React Hook Form, Day.js, Recharts
- Backend: Node.js 18+, Express.js, plain JavaScript, Prisma ORM, Joi validation, JWT (`jsonwebtoken`, 24h session)
- Database: PostgreSQL hosted on Supabase (also used for file storage); deployment on Vercel; CI/CD via GitHub Actions

## Supabase MCP

`.mcp.json` registers the Supabase MCP server (HTTP, `mcp.supabase.com`). As of the last check the connected account had no Supabase projects, so one must be created before any schema work. Inspect existing tables before applying migrations.

## Domain model (spans multiple PRD sections)

Three roles: **Reader**, **Librarian**, **Admin** (Admin manages users, fine tiers, reports; Librarian manages books, confirms borrow/return and fine payments).

Core workflows are two-step "request → staff confirmation" state machines:
- **Borrow order**: `Chờ xác nhận` → `Đã mượn`/`Đang mượn` (confirm decrements available stock) or `Bị từ chối` (reason required). Derived status `Quá hạn` when past due. Rules: default max 5 books per reader, default 14-day loan (max 30), blocked if reader has unpaid fines, one extension of +7 days only if not yet expired.
- **Return request**: reader creates it (only one pending per borrow order); librarian confirms with book condition `Bình thường` / `Hư hỏng` / `Mất`. Damaged/lost requires choosing an admin-configured fine tier plus a note (≤500 chars); late returns add a separate "Trả muộn" fine. Confirming normal return increments available / decrements borrowed counts.
- **Fine ticket**: `Chưa thanh toán` → reader marks paid via bank transfer → `Chờ xác nhận` → librarian confirms or rejects (`Từ chối` with reason).
- Registration creates accounts in `Chờ xác nhận` state; admin can activate/deactivate accounts.
- Categories can only be deleted when no book uses them; books can only be deleted with no active borrow order.

Book listing/detail are public (no login); pagination is 10 per page, sort by name / newest year / most borrowed.

## Implementation order

PRD Part 3 defines feature dependencies and six phases: (1) auth & profile, (2) books & categories, (3) borrow/return, (4) fines, (5) user management, (6) reports/dashboard (CSV export). Follow this order; each feature lists its prerequisite feature codes (e.g. 2.4.2 depends on 2.1.2, 2.4.1).
