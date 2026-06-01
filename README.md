# 🚨 AML Detector

AI-powered Suspicious Pattern Detector for Anti-Money Laundering compliance.

Upload a CSV of transactions → get AI-explained anomaly alerts in seconds.

![Tech Stack](https://img.shields.io/badge/TypeScript-monorepo-blue) ![Python](https://img.shields.io/badge/Python-FastAPI-green) ![Claude](https://img.shields.io/badge/AI-Claude%20Sonnet-orange)

---

## Features

- **CSV Upload** — drag & drop transaction files
- **ML Detection** — IsolationForest + velocity analysis + graph analysis
- **Pattern Classification** — Smurfing, Layering, Round-tripping, Unusual Velocity, Structuring
- **AI Explanations** — Claude explains *why* each transaction is suspicious
- **Risk Scoring** — 0–100 score with MONITOR / ESCALATE / FILE_SAR recommendation
- **Real-time Dashboard** — live polling, bar/pie charts, filterable alert table
- **Multi-tenant** — PostgreSQL RLS isolation per tenant
- **Immutable Audit Log** — append-only alert records

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
                          │  (Prisma)  │          │ (explanations)│
                          └────────────┘          └──────────────┘
                                │
                           ┌────▼─────┐
                           │  Redis   │
                           │ (BullMQ) │
                           └──────────┘
```

## Quick Start

```bash
# 1. Clone and setup
git clone https://github.com/YOUR_USERNAME/aml-detector
cd aml-detector
cp .env.example .env
# Fill in ANTHROPIC_API_KEY

# 2. Install dependencies
pnpm install

# 3. Start infrastructure
pnpm docker:up

# 4. Apply database schema
pnpm db:push

# 5. Start all services
pnpm dev
```

Open **http://localhost:3000** and upload `scripts/sample.csv` to test.

---

## CSV Format

| Column | Required | Description |
|--------|----------|-------------|
| `tx_id` | ✓ | Unique transaction ID |
| `from_account` | ✓ | Sender account |
| `to_account` | ✓ | Receiver account |
| `amount` | ✓ | Transaction amount |
| `date` | ✓ | ISO 8601 datetime |
| `currency` | — | Default: EUR |
| `type` | — | Transfer type |
| `country` | — | Country code |
| `description` | — | Free text |

---

## Detected Patterns

| Pattern | Description |
|---------|-------------|
| **SMURFING** | Transactions just below €10,000 reporting threshold |
| **LAYERING** | Complex chain of transactions to obscure origin |
| **UNUSUAL_VELOCITY** | Too many transactions from one account in 24h |
| **ROUND_TRIPPING** | Money leaves and returns within 72h |
| **STRUCTURING** | Large amounts split into smaller ones |
| **GEOGRAPHIC_ANOMALY** | Unusual cross-border patterns |

---

## Risk Levels

| Score | Level | Action |
|-------|-------|--------|
| 80–100 | 🔴 High | FILE_SAR |
| 55–79 | 🟠 Medium | ESCALATE |
| 0–54 | 🟡 Low | MONITOR |

---

## Tech Stack

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, Recharts, Papaparse
- **Backend**: Fastify, TypeScript, BullMQ, csv-parse
- **Database**: PostgreSQL, Prisma ORM (multi-tenant RLS)
- **Queue**: Redis + BullMQ
- **ML**: Python, FastAPI, scikit-learn, pandas, networkx
- **AI**: Anthropic Claude claude-sonnet-4-20250514
- **Monorepo**: Turborepo + pnpm workspaces
- **Infra**: Docker Compose

---

## Project Structure

```
aml-detector/
├── apps/
│   ├── web/          # Next.js frontend
│   ├── api/          # Fastify backend + BullMQ worker
│   └── detector/     # Python FastAPI ML service
├── packages/
│   ├── db/           # Prisma schema
│   ├── types/        # Shared TypeScript types
│   └── queue/        # BullMQ job definitions
├── scripts/
│   ├── sample.csv    # Test data
│   └── init.sql      # PostgreSQL RLS setup
├── AGENTS.md         # Agent configuration
├── CLAUDE.md         # Claude Code instructions
└── docker-compose.yml
```

---

## License

MIT
