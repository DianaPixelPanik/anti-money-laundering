# AGENTS.md — AML Detector Agent Configuration

## Project Overview
Suspicious Pattern Detector for Anti-Money Laundering compliance.
TypeScript monorepo + Python detector microservice + Claude AI agents.

## Architecture
```
apps/web        → Next.js 14 frontend (upload + dashboard + D3 graph)
apps/api        → Fastify backend (CSV ingestion, BullMQ jobs, agents)
apps/detector   → Python FastAPI (IsolationForest anomaly detection)
packages/db     → Prisma schema (PostgreSQL)
packages/types  → Shared TypeScript types
```

## Agent Rules

### Code Style
- TypeScript strict mode everywhere (`strict: true` in all tsconfigs)
- Zod for all runtime validation (`src/lib/schemas.ts`)
- Prisma for all DB access — never raw SQL
- All DB writes via append-only pattern for audit log (never UPDATE alerts or decisions)
- Error messages must be user-readable (no raw stack traces to frontend)
- Global Fastify error handler in `src/app.ts` — 500s log internally, return generic message

### AML Domain Rules
- Risk score 0–100: ≥80 = FILE_SAR, 55–79 = ESCALATE, <55 = MONITOR
- Smurfing threshold: transactions near €9,000 (just below €10k reporting limit)
- Velocity window: 24 hours
- Round-trip detection window: 72 hours
- IsolationForest contamination: adaptive (min 1%, max 15%)

### Claude Integration
- Model: `claude-sonnet-4-6` (always use this exact ID)
- Always read from `process.env.ANTHROPIC_MODEL` at call time — never at module load
- Max tokens: 600 for single-transaction explanations, 1024 for triage agent, 4000 for Ralph loop
- Structured JSON responses: `summary`, `red_flags[]`, `pattern_explanation`, `recommendation_reason`

### Multi-tenancy
- Every DB query must include `tenantId` filter
- Never mix tenant data
- RLS enforced at PostgreSQL level (see `scripts/init.sql`)
- Default tenant: `"default"` (for local dev)
- Tenant ID validated via Zod in `parseTenant()`

### Queue / Jobs
- Queue name: `"analysis"`
- Max retries: 3, backoff: exponential, 2s base
- Worker concurrency: 3
- Failed jobs → update upload status to FAILED

### API Conventions
- Tenant identified via `x-tenant-id` header
- Upload endpoint returns 202 (async)
- Analysis endpoint returns current status + alerts (poll every 2s)
- All timestamps in ISO 8601 UTC
- All params/query validated with Zod before use

### Testing
- Framework: Vitest
- Integration: use docker-compose test profile (`--profile test`)
- Test DB: postgres on port 5433, redis on port 6380
- Test env: `apps/api/.env.test`
- Always test with sample CSV from `scripts/sample.csv`
- Isolation: unique `tenantId` per test, cleaned up in `afterAll`

## Agents

### Triage Agent (`src/jobs/triageAgent.ts`)
Runs after ML detection for each anomaly. Uses Claude tool-use loop:

| Tool | Purpose |
|------|---------|
| `get_account_history` | Velocity, structuring patterns, anomaly score history |
| `find_related_accounts` | Network neighbors (one hop) |
| `score_risk` | Terminal — submits structured `TriageResult` |

- Max iterations: 6
- Result stored as JSON in `Alert.explanation`

### Ralph Loop (`src/agents/ralph.ts`)

Triggered on demand via `POST /api/ralph/:alertId`. Autonomous investigation:

```
MAX_ITERATIONS: 7
MAX_TOKENS:     4000
HALT_ON:        halt tool call
```

| Tool | Purpose |
|------|---------|
| `get_account_history` | Full transaction history (up to 90 days) |
| `get_related_accounts` | Weighted network neighbors |
| `check_sanctions` | OFAC/UN/EU sanctions screening |
| `get_graph_depth` | BFS traversal up to 3 hops, detects cycles |
| `file_sar` | Flags SAR intent without stopping the loop |
| `halt` | Terminal — saves `RalphDecision`, stops loop |

Decision stored in `RalphDecision` table (append-only).

## Common Tasks

### Add a new pattern type
1. Add to `PatternType` enum in `packages/db/prisma/schema.prisma`
2. Add to `PatternType` union in `packages/types/src/index.ts`
3. Add detection logic in `apps/detector/src/main.py` → `classify_pattern()`
4. Add color in `apps/web/src/components/AnalysisDashboard.tsx` → `PATTERN_COLORS`

### Add a new API endpoint
1. Create route file in `apps/api/src/routes/`
2. Register in `apps/api/src/app.ts` (not `index.ts`)
3. Add Zod validation using schemas from `src/lib/schemas.ts`
4. Add types to `packages/types/src/index.ts`

### Add a new agent tool
1. Define tool schema in `TOOLS` array (strict `input_schema`)
2. Implement handler function with Prisma query
3. Add `case` in the tool dispatch switch
4. Update `AGENTS.md` tool table

### Run locally
```bash
cp .env.example .env
# Fill in ANTHROPIC_API_KEY
pnpm docker:up
pnpm db:push
pnpm dev
```

### Run tests
```bash
docker compose --profile test up -d
cd apps/api && pnpm test
```
