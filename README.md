# Memento

*Memento mori — note everything.* A **structured, sourced, living, auditable** knowledge
substrate, consumed by agents via **MCP**. Where a RAG stores a bag of documents, Memento
represents **know-how**: typed blocks, sourced at fine grain, linked, kept current by a
**propose-validate** loop under human control.

- **Hosted**: [mento.cc](https://mento.cc) — viewer + MCP + OAuth (alpha, invite-only).
- **License**: Apache-2.0.

## What's in this repo

| Path | What |
|---|---|
| `supabase/functions/` | Edge runtime (Deno) — the **MCP server** (`mem_*` verbs) + a REST mirror, over a shared services layer (`_shared/`). |
| `server/` | Canonical **Drizzle schema** + migrations + seed + admin CLI (Node tooling; the prod runtime is Deno). |
| `app/` | The **viewer** (Vue 3 + Vite) — read, graph, review loop, public gallery. |
| `docs/` | `principles.md` (the why), `specs/knowledge-base.md` (model + MCP surface), `connect-mcp.md`, `access-control.md`. |

## Read in order

1. [`docs/principles.md`](docs/principles.md) — the **why** in two pages.
2. [`docs/specs/knowledge-base.md`](docs/specs/knowledge-base.md) — the **spec**: model, MCP surface (`mem_*`), invariants, ingestion.
3. [`docs/connect-mcp.md`](docs/connect-mcp.md) — **connect** an MCP client (claude.ai, Claude Code).
4. [`docs/access-control.md`](docs/access-control.md) — orgs, memberships, roles.

## Quickstart (local)

Prereqs: Postgres (with `pgvector`), Node ≥ 20, [Deno](https://deno.com), [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
# 1. Schema
cd server && npm ci && DATABASE_URL=postgres://… npm run db:migrate && npm run seed

# 2. Edge functions (MCP + API) locally
supabase functions serve            # serves mcp + api

# 3. Viewer
cd app && npm ci && cp .env.example .env   # set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
```

See [`CLAUDE.md`](CLAUDE.md) for dev orientation (stack, commands).

## Status

Alpha. The model and MCP surface are stable enough to build on; expect change. Issues and
PRs welcome.
