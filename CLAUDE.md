# CLAUDE.md

## What is this project?
AML (Anti-Money Laundering) Suspicious Pattern Detector.
Analyzes transaction CSV files, detects anomalies with ML, explains them with Claude AI agents.

## Stack
- **Frontend**: Next.js 14, TypeScript, Tailwind, D3.js, Recharts, Papaparse
- **Backend**: Fastify, TypeScript, BullMQ, Prisma, PostgreSQL, Zod
- **ML Service**: Python, FastAPI, scikit-learn (IsolationForest), networkx
- **AI**: Anthropic Claude claude-sonnet-4-6
- **Infra**: Docker Compose, Redis, Turborepo monorepo

## Critical constraints
1. **Never use raw SQL** — use Prisma only
2. **Never update Alert or RalphDecision records** — append-only audit log
3. **Always filter by tenantId** — multi-tenant isolation
4. **Claude model** — always `claude-sonnet-4-6`, read from `process.env.ANTHROPIC_MODEL` at call time
5. **Zod** — validate all external input (route params, query strings, headers)
6. **EU compliance** — use Anthropic EU endpoint in production

## Dev commands
```bash
pnpm install                              # install all deps
pnpm docker:up                            # start postgres + redis
docker compose --profile test up -d       # start test containers
pnpm db:push                              # apply schema to dev DB
pnpm dev                                  # start all services
cd apps/api && pnpm test                  # run integration tests
```

## Environment
See `.env.example` for all required variables.
Copy to `.env` and fill in `ANTHROPIC_API_KEY`.

## File structure
```
apps/api/src/
  agents/ralph.ts        # Ralph autonomous investigation agent
  jobs/queue.ts          # BullMQ worker
  jobs/triageAgent.ts    # Claude tool-use triage loop
  lib/schemas.ts         # Zod schemas (params, query, headers)
  app.ts                 # Fastify factory — register routes HERE
  index.ts               # Entry point — listen + shutdown only
  routes/
    upload.ts            # POST /api/uploads
    analysis.ts          # GET /api/analysis/:id + /graph
    alerts.ts            # GET /api/alerts
    sar.ts               # POST /api/sar/:alertId
    ralph.ts             # POST/GET /api/ralph/:alertId
apps/web/src/
  components/
    UploadZone.tsx
    AnalysisDashboard.tsx
    TransactionGraph.tsx  # D3 force graph
```

See AGENTS.md for full architecture and agent documentation.
