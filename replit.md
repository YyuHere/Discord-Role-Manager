# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Discord Bot

A Discord bot located in `discord-bot/` that enforces role-based mention permissions:
- Users with Role 1 can only mention Role 2
- If they mention any other role, the message is deleted and a warning is sent

**Environment variables:**
- `DISCORD_BOT_TOKEN` (secret) — Discord bot token
- `ROLE_1_ID` — ID of the role that has restricted mentioning
- `ROLE_2_ID` — ID of the only role that Role 1 can mention

**Stack:** discord.js v14, Node.js ESM
