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

## Architecture
```
apps/web        → Next.js 14 frontend (upload + investigation dashboard + D3 graph)
apps/api        → Fastify backend (CSV ingestion, BullMQ jobs, agents)
apps/detector   → Python FastAPI (IsolationForest anomaly detection)
packages/db     → Prisma schema (PostgreSQL)
packages/types  → Shared TypeScript types
```

## Critical constraints
1. **Never use raw SQL** — use Prisma only
2. **Never update Alert or RalphDecision records** — append-only audit log
3. **Always filter by tenantId** — multi-tenant isolation; comes from JWT, never from headers
4. **Claude model** — always `claude-sonnet-4-6`, read from `process.env.ANTHROPIC_MODEL` at call time
5. **Zod** — validate all external input (route params, query strings, headers) via `src/lib/schemas.ts`
6. **EU compliance** — use Anthropic EU endpoint in production

## Code style
- TypeScript `strict: true` in all tsconfigs
- Prisma for all DB access — never raw SQL
- All DB writes via append-only pattern (never UPDATE alerts or decisions)
- Error messages user-readable; global Fastify error handler hides 500 stack traces
- Auth: JWT via `@fastify/jwt`; all routes use `request.user.tenantId`

## AML domain rules
- Risk score 0–100: ≥80 = FILE_SAR, 55–79 = ESCALATE, <55 = MONITOR
- Smurfing threshold: transactions near €9,000 (just below €10k reporting limit)
- Velocity window: 24 hours; round-trip detection: 72 hours
- IsolationForest contamination: adaptive (min 1%, max 15%)
- Thresholds configurable via env: `AML_SMURFING_THRESHOLD`, `AML_VELOCITY_WINDOW_HOURS`, etc.

## API conventions
- All routes require `Authorization: Bearer <token>` (JWT)
- Upload endpoint returns 202 (async); poll `/api/analysis/:id` every 2s
- All timestamps in ISO 8601 UTC

## Dev commands
```bash
pnpm install                              # install all deps
pnpm docker:up                            # start postgres + redis
docker compose --profile test up -d       # start test containers
pnpm db:push                              # apply schema to dev DB
pnpm dev                                  # start all services
cd apps/api && pnpm test                  # run integration tests (15 tests)
```

## Environment
Copy `.env.example` → `.env` and fill in `ANTHROPIC_API_KEY` and `JWT_SECRET`.

## File structure
```
apps/api/src/
  agents/ralph.ts        # Ralph autonomous investigation agent
  jobs/queue.ts          # BullMQ worker (batch score updates, parallel triage)
  jobs/triageAgent.ts    # Claude tool-use triage loop (MAX_ITERATIONS=3)
  lib/schemas.ts         # Zod schemas (params, query)
  plugins/auth.ts        # @fastify/jwt + onRequest hook
  app.ts                 # Fastify factory — register routes HERE
  index.ts               # Entry point — listen + shutdown only
  routes/
    auth.ts              # POST /api/auth/token (dev token issuer)
    upload.ts            # POST /api/uploads
    analysis.ts          # GET /api/analysis/:id + /graph
    alerts.ts            # GET /api/alerts
    sar.ts               # POST /api/sar/:alertId
    ralph.ts             # POST/GET /api/ralph/:alertId

apps/web/src/
  types/aml.ts           # Frontend types: Alert, Transaction, AnalysisSummary...
  lib/
    auth.tsx             # AuthProvider + useAuth() hook (JWT from /api/auth/token)
    parseCsv.ts          # PapaParse wrapper + downloadSampleCsv()
    detectionRules.ts    # Client-side detection rules (5 rules)
  components/
    upload/
      CsvUploadPanel.tsx   # Two-column upload workspace
      SchemaChecklist.tsx  # Required/optional columns + sample download
    dashboard/
      InvestigationDashboard.tsx  # Main dashboard, polls API, maps data
      FlaggedTransactionsTable.tsx # Primary UI — dense 11-col table with filters
      TransactionDrawer.tsx        # Right-side alert detail drawer
      InvestigationSidebar.tsx     # Risk breakdown, top accounts, pattern summary
      SummaryMetricCard.tsx        # Compact KPI card
    charts/
      PatternsDetectedChart.tsx    # Horizontal bar chart (Recharts)
      RiskDistributionChart.tsx    # Stacked proportion bar (Recharts)
      AlertsTimelineChart.tsx      # Area chart by date (Recharts)
    network/
      TransactionNetworkGraph.tsx  # D3 force graph (replaces TransactionGraph.tsx)
```

## Agents

### Triage Agent (`src/jobs/triageAgent.ts`)
Runs after ML detection for each anomaly. Claude tool-use loop, MAX_ITERATIONS=3, max_tokens=900.

| Tool | Purpose |
|------|---------|
| `get_account_history` | Velocity, structuring patterns, anomaly score history |
| `find_related_accounts` | Network neighbors (one hop) |
| `score_risk` | Terminal — saves structured `TriageResult` |

Result stored as JSON in `Alert.explanation`: `{ summary, red_flags[], pattern_explanation, recommendation_reason }`.

### Ralph Loop (`src/agents/ralph.ts`)
Triggered on demand via `POST /api/ralph/:alertId`. MAX_ITERATIONS=7, MAX_TOKENS=4000. Agent calls `halt` to stop.

| Tool | Purpose |
|------|---------|
| `get_account_history` | Full transaction history (up to 90 days) |
| `get_related_accounts` | Weighted network neighbors |
| `check_sanctions` | OFAC/UN/EU sanctions screening |
| `get_graph_depth` | BFS traversal up to 3 hops, detects cycles |
| `file_sar` | Flags SAR intent without stopping the loop |
| `halt` | Terminal — saves `RalphDecision` (append-only) |

## Common tasks

### Add a new pattern type
1. Add to `PatternType` enum in `packages/db/prisma/schema.prisma`
2. Add to `PatternType` union in `packages/types/src/index.ts`
3. Add detection logic in `apps/detector/src/main.py` → `classify_pattern()`
4. Add to frontend `PatternType` in `apps/web/src/types/aml.ts`

### Add a new API endpoint
1. Create route file in `apps/api/src/routes/`
2. Register in `apps/api/src/app.ts` (not `index.ts`)
3. Add Zod validation using schemas from `src/lib/schemas.ts`
4. Use `request.user.tenantId` from JWT — never trust request headers for tenant

### Add a new agent tool
1. Define tool schema in `TOOLS` array with strict `input_schema`
2. Implement handler function using Prisma
3. Add `case` in the tool dispatch switch
4. Update this file's agent tool table

### Testing
- Framework: Vitest, integration tests hit real DB
- Test DB: postgres:5433, redis:6380 via `docker compose --profile test up -d`
- Test env: `apps/api/.env.test`
- Each test uses unique `tenantId`, cleaned up in `afterAll`
- Auth: `getAuthHeaders(tenantId)` helper acquires JWT per tenant
