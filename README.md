# AML Detector

AI-powered Suspicious Pattern Detector for Anti-Money Laundering compliance.

Upload a CSV of transactions — get ML-detected anomalies explained by Claude in seconds.

---

## Features

- **CSV Upload** — drag and drop transaction files, instant preview
- **ML Detection** — IsolationForest + velocity analysis + network graph analysis
- **Pattern Classification** — Smurfing, Layering, Round-tripping, Unusual Velocity, Structuring, Geographic Anomaly
- **Triage Agent** — Claude tool-use loop investigates each anomaly before scoring
- **Ralph Agent** — autonomous investigation agent: up to 7 iterations, halts when confident
- **AI Explanations** — structured: Brief Summary, Red Flags, Detailed Explanation, Recommendation Rationale
- **SAR Generator** — formal Suspicious Activity Report narrative via Claude
- **Transaction Graph** — D3.js force-directed network, flagged edges highlighted, drag/zoom
- **Risk Scoring** — 0–100 with MONITOR / ESCALATE / FILE_SAR recommendation
- **Real-time Dashboard** — live polling, bar/pie charts, alert table with click-to-expand
- **Multi-tenant** — PostgreSQL row-level isolation per tenant
- **Immutable Audit Log** — append-only alert and decision records

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│   Next.js Web   │────▶│   Fastify API    │────▶│  Python Detector    │
│  (upload + UI)  │     │  (BullMQ queue)  │     │  (IsolationForest)  │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
                                │                          │
                          ┌─────▼──────┐          ┌───────▼──────┐
                          │ PostgreSQL │          │  Claude API  │
                          │  (Prisma)  │          │  (agents)    │
                          └────────────┘          └──────────────┘
                                │
                           ┌────▼─────┐
                           │  Redis   │
                           │ (BullMQ) │
                           └──────────┘
```

---

## Quick Start

```bash
cp .env.example .env
# Fill in ANTHROPIC_API_KEY

pnpm install
pnpm docker:up
pnpm db:push
pnpm dev
```

Open **http://localhost:3000** and upload `scripts/sample.csv` to test.

---

## CSV Format

| Column | Required | Description |
|--------|----------|-------------|
| `tx_id` | yes | Unique transaction ID |
| `from_account` | yes | Sender account |
| `to_account` | yes | Receiver account |
| `amount` | yes | Transaction amount |
| `date` | yes | ISO 8601 datetime |
| `currency` | — | Default: EUR |
| `type` | — | Transfer type |
| `country` | — | Country code |
| `description` | — | Free text |

---

## Detected Patterns

| Pattern | Description |
|---------|-------------|
| SMURFING | Transactions just below reporting threshold (€10k) |
| LAYERING | Complex chain to obscure origin |
| UNUSUAL_VELOCITY | Too many transactions from one account in 24h |
| ROUND_TRIPPING | Money leaves and returns within 72h |
| STRUCTURING | Large amounts split into smaller ones |
| GEOGRAPHIC_ANOMALY | Unusual cross-border patterns |

---

## Risk Levels

| Score | Level | Action |
|-------|-------|--------|
| 80–100 | High | FILE_SAR |
| 55–79 | Medium | ESCALATE |
| 0–54 | Low | MONITOR |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/uploads` | Upload CSV — returns 202 async |
| GET | `/api/analysis/:uploadId` | Poll status + alerts |
| GET | `/api/analysis/:uploadId/graph` | Transaction network graph |
| GET | `/api/alerts` | All alerts for tenant |
| POST | `/api/sar/:alertId` | Generate SAR report |
| POST | `/api/ralph/:alertId` | Run Ralph autonomous investigation |
| GET | `/api/ralph/:alertId` | Get Ralph decisions for alert |

All endpoints accept `x-tenant-id` header. All timestamps are ISO 8601 UTC.

---

## Testing

```bash
# Start test containers (separate DB on port 5433)
docker compose --profile test up -d

cd apps/api
pnpm test            # 13 integration tests, ~1.5s
pnpm test:coverage   # with lcov report
```

---

## Tech Stack

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, D3.js, Recharts, Papaparse
- **Backend**: Fastify, TypeScript, BullMQ, Zod, csv-parse
- **Database**: PostgreSQL 16, Prisma ORM (multi-tenant)
- **Queue**: Redis 7 + BullMQ
- **ML**: Python, FastAPI, scikit-learn, pandas, networkx
- **AI**: Anthropic Claude claude-sonnet-4-6
- **Monorepo**: Turborepo + pnpm workspaces
- **Infra**: Docker Compose (dev + test profiles)

---

## Project Structure

```
aml-detector/
├── apps/
│   ├── web/                  # Next.js frontend
│   │   └── src/
│   │       ├── app/          # layout, page, globals.css
│   │       └── components/   # UploadZone, AnalysisDashboard, TransactionGraph
│   ├── api/                  # Fastify backend
│   │   ├── src/
│   │   │   ├── agents/       # ralph.ts
│   │   │   ├── jobs/         # queue.ts, triageAgent.ts
│   │   │   ├── lib/          # schemas.ts (Zod)
│   │   │   └── routes/       # upload, analysis, alerts, sar, ralph
│   │   └── tests/            # Vitest integration tests
│   └── detector/             # Python FastAPI + IsolationForest
├── packages/
│   ├── db/                   # Prisma schema
│   └── types/                # Shared TypeScript types
├── scripts/
│   ├── sample.csv            # 20-row test dataset
│   └── init.sql              # PostgreSQL init
├── AGENTS.md
├── CLAUDE.md
└── docker-compose.yml
```

---

## License

MIT
