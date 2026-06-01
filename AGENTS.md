# AGENTS.md — AML Detector Agent Configuration

## Project Overview
Suspicious Pattern Detector for Anti-Money Laundering compliance.
TypeScript monorepo + Python detector microservice + Claude AI explanations.

## Architecture
```
apps/web       → Next.js 14 frontend (upload + dashboard)
apps/api       → Fastify backend (CSV ingestion, BullMQ jobs)
apps/detector  → Python FastAPI (IsolationForest anomaly detection)
packages/db    → Prisma schema (PostgreSQL)
packages/types → Shared TypeScript types
packages/queue → BullMQ job definitions
```

## Agent Rules

### Code Style
- TypeScript strict mode everywhere
- Zod for all runtime validation
- Prisma for all DB access — never raw SQL
- All DB writes via append-only pattern for audit log (never UPDATE alerts)
- Error messages must be user-readable (no raw stack traces to frontend)

### AML Domain Rules
- Risk score 0–100: ≥80 = FILE_SAR, 55–79 = ESCALATE, <55 = MONITOR
- Smurfing threshold: transactions near €9,000 (just below €10k reporting limit)
- Velocity window: 24 hours
- Round-trip detection window: 72 hours
- IsolationForest contamination: adaptive (min 1%, max 15%)

### Claude Integration
- Model: claude-sonnet-4-20250514 (always use this, never opus for bulk tasks)
- Always request JSON-only responses for structured analysis
- Max tokens: 600 for single transaction explanations
- Prompt must include: tx details, all anomaly scores, pattern type
- Response must include: summary, red_flags[], pattern_explanation, recommendation_reason

### Multi-tenancy
- Every DB query must include tenantId filter
- Never mix tenant data
- RLS enforced at PostgreSQL level (see scripts/init.sql)
- Default tenant: "default" (for local dev)

### Queue / Jobs
- Queue name: "analysis"
- Max retries: 3
- Backoff: exponential, 2s base
- Worker concurrency: 3
- Failed jobs → update upload status to FAILED

### API Conventions
- Tenant identified via `x-tenant-id` header
- Upload endpoint returns 202 (async)
- Analysis endpoint returns current status + alerts (poll every 2s)
- All timestamps in ISO 8601 UTC

### Testing
- Unit tests: Vitest
- Integration: use docker-compose test profile
- Always test with sample CSV from scripts/sample.csv

## Common Tasks

### Add a new pattern type
1. Add to `PatternType` enum in `packages/db/prisma/schema.prisma`
2. Add to `PatternType` union in `packages/types/src/index.ts`
3. Add detection logic in `apps/detector/src/main.py` → `classify_pattern()`
4. Add color in `apps/web/src/components/AnalysisDashboard.tsx` → `PATTERN_COLORS`

### Add a new API endpoint
1. Create route file in `apps/api/src/routes/`
2. Register in `apps/api/src/index.ts`
3. Add types to `packages/types/src/index.ts`

### Run locally
```bash
cp .env.example .env
# Fill in ANTHROPIC_API_KEY
pnpm docker:up
pnpm db:push
pnpm dev
```
