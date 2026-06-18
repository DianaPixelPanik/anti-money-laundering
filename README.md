# Fintech Compliance Platform

AI-powered fintech compliance platform combining customer onboarding and transaction monitoring.

This project integrates two complementary tools:

- **AML Transaction Monitoring** — Suspicious Transaction Pattern Detector. Upload a CSV of transactions — get risk-scored anomalies with evidence summaries in seconds. **[Live Demo →](https://anti-money-laundering-red.vercel.app)**
- **KYC Onboarding Agent** — AI-powered Know Your Customer assistant with risk scoring, document verification, audit logs, and compliance workflows.

---

## Features

- **CSV Upload** — drag and drop transaction files, instant preview
- **Detection Rules** — velocity analysis, structuring detection, geographic risk, unknown counterparty
- **Pattern Classification** — Smurfing, Unusual Velocity, Large Amount, Cross-Border Risk, Unknown Counterparty
- **Evidence Summary** — structured: Brief Summary, Red Flags, Detection Logic, Recommendation Rationale
- **Transaction Graph** — D3.js force-directed network, flagged edges highlighted, drag/zoom
- **Risk Scoring** — 0–100 with MONITOR / ESCALATE / FILE_SAR recommendation
- **Investigation Dashboard** — bar/area/distribution charts, alert table with click-to-expand drawer
- **Multi-tenant** — PostgreSQL row-level isolation per tenant
- **Immutable Audit Log** — append-only alert and decision records

---

## Architecture

The demo deployment runs entirely on Vercel (Next.js API routes, no separate backend):

```
┌─────────────────────────────────────────┐
│              Vercel (Next.js)           │
│                                         │
│  /app             →  Frontend UI        │
│  /api/uploads     →  CSV ingestion      │
│  /api/analysis/   →  Results polling    │
│  /api/auth/token  →  Demo auth          │
└─────────────────────────────────────────┘
```

Full self-hosted stack (for production):

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│   Next.js Web   │────▶│   Fastify API    │────▶│  Python Detector    │
│  (upload + UI)  │     │  (BullMQ queue)  │     │  (IsolationForest)  │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
                                │
                          ┌─────▼──────┐     ┌──────────────┐
                          │ PostgreSQL │     │  Claude API  │
                          │  (Prisma)  │     │  (triage)    │
                          └────────────┘     └──────────────┘
                                │
                           ┌────▼─────┐
                           │  Redis   │
                           │ (BullMQ) │
                           └──────────┘
```

---

## Quick Start

### AML Transaction Monitoring

```bash
cp .env.example .env
# Fill in ANTHROPIC_API_KEY and JWT_SECRET

pnpm install
pnpm docker:up
pnpm db:push
pnpm dev
```

Open **http://localhost:3000** and upload `scripts/sample.csv` to test.

### KYC Onboarding Agent

```bash
cd apps/kyc-agent
cp .env.example .env
# Fill in ANTHROPIC_API_KEY

pip install -r requirements.txt
streamlit run app.py
```

Open **http://localhost:8501** to start the KYC onboarding interview.

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
| `country` | — | Country code (ISO 3166-1 alpha-2) |
| `description` | — | Free text |

---

## Detected Patterns

| Pattern | Description |
|---------|-------------|
| SMURFING | Transactions just below the €10k reporting threshold (€8,500–€9,999) |
| UNUSUAL_VELOCITY | More than 5 transactions from one account within a 24-hour window |
| LARGE_AMOUNT | Single transaction ≥ €100,000 |
| CROSS_BORDER_RISK | Transactions involving sanctioned or high-risk jurisdictions |
| UNKNOWN_COUNTERPARTY | Accounts appearing only once in the dataset |

---

## Risk Levels

| Score | Level | Recommendation |
|-------|-------|----------------|
| 80–100 | High | FILE_SAR |
| 55–79 | Medium | ESCALATE |
| 0–54 | Low | MONITOR |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/uploads` | Upload CSV — returns 202 with full analysis |
| GET | `/api/analysis/:uploadId` | Poll status + alerts |
| GET | `/api/analysis/:uploadId/graph` | Transaction network graph data |
| GET | `/api/alerts` | All alerts for tenant |
| POST | `/api/sar/:alertId` | Generate SAR report |
| POST | `/api/ralph/:alertId` | Run Ralph autonomous investigation |
| GET | `/api/ralph/:alertId` | Get Ralph decisions for alert |

All endpoints require `Authorization: Bearer <token>`. All timestamps are ISO 8601 UTC.

---

## Testing

```bash
# Start test containers (separate DB on port 5433)
docker compose --profile test up -d

cd apps/api
pnpm test            # integration tests
pnpm test:coverage   # with lcov report
```

---

## Tech Stack

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, D3.js, Recharts, Papaparse
- **Backend**: Fastify, TypeScript, BullMQ, Zod, csv-parse
- **Database**: PostgreSQL 16, Prisma ORM (multi-tenant)
- **Queue**: Redis 7 + BullMQ
- **ML**: Python, FastAPI, scikit-learn, pandas, networkx
- **Language Model**: Anthropic Claude (claude-sonnet-4-6)
- **Monorepo**: Turborepo + pnpm workspaces
- **Deployment**: Vercel

---

## Project Structure

```
fintech-compliance-platform/
├── apps/
│   ├── web/                  # Next.js frontend + API routes (AML)
│   │   └── src/
│   │       ├── app/          # layout, page, API routes
│   │       ├── components/   # Dashboard, UploadPanel, NetworkGraph
│   │       └── lib/          # auth, detectionRules, demoStore
│   ├── api/                  # Fastify backend (self-hosted)
│   │   ├── src/
│   │   │   ├── agents/       # ralph.ts
│   │   │   ├── jobs/         # queue.ts, triageAgent.ts
│   │   │   ├── lib/          # schemas.ts (Zod)
│   │   │   └── routes/       # upload, analysis, alerts, sar, ralph
│   │   └── tests/            # Vitest integration tests
│   ├── detector/             # Python FastAPI + IsolationForest
│   └── kyc-agent/            # Streamlit KYC onboarding app
│       ├── app.py            # Main KYC agent
│       ├── requirements.txt   # Python dependencies
│       ├── .streamlit/        # Streamlit config
│       └── AGENTS.md          # Agent documentation
├── packages/
│   ├── db/                   # Prisma schema
│   └── types/                # Shared TypeScript types
├── scripts/
│   ├── sample.csv            # Test dataset
│   └── init.sql              # PostgreSQL init
├── CLAUDE.md
└── docker-compose.yml
```

---

## License

MIT
