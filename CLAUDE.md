# CLAUDE.md

## What is this project?
AML (Anti-Money Laundering) Suspicious Pattern Detector.
Analyzes transaction CSV files, detects anomalies with ML, explains them with Claude AI.

## Stack
- **Frontend**: Next.js 14, TypeScript, Tailwind, Recharts, Papaparse
- **Backend**: Fastify, TypeScript, BullMQ, Prisma, PostgreSQL
- **ML Service**: Python, FastAPI, scikit-learn (IsolationForest), networkx
- **AI**: Anthropic Claude claude-sonnet-4-20250514
- **Infra**: Docker Compose, Redis, Turborepo monorepo

## Critical constraints
1. **Never use raw SQL** — use Prisma only
2. **Never update Alert records** — append-only audit log
3. **Always filter by tenantId** — multi-tenant isolation
4. **Claude model** — always `claude-sonnet-4-20250514`
5. **EU compliance** — use Anthropic EU endpoint in production

## Dev commands
```bash
pnpm install           # install all deps
pnpm docker:up         # start postgres + redis
pnpm db:push           # apply schema
pnpm dev               # start all services
```

## Environment
See `.env.example` for all required variables.
Copy to `.env` and fill in `ANTHROPIC_API_KEY`.

## File structure
See AGENTS.md for full architecture description.
