#!/bin/bash
# setup.sh — Run this locally to create GitHub repo and push the project
# Requirements: git, gh CLI (https://cli.github.com), node >=20, pnpm >=9

set -e

REPO_NAME="aml-detector"
DESCRIPTION="AI-powered AML Suspicious Pattern Detector — TypeScript monorepo + Python ML + Claude"

echo "🚀 Setting up AML Detector project..."

# 1. Init git
git init
git add .
git commit -m "feat: initial project scaffold

- Turborepo monorepo (apps/web, apps/api, apps/detector)
- Next.js 14 frontend with CSV upload + results dashboard
- Fastify API with BullMQ queue for async processing
- Python FastAPI detector with IsolationForest anomaly detection
- Prisma + PostgreSQL with multi-tenant schema
- Claude AI explanations for flagged transactions
- Docker Compose for local dev
- AGENTS.md + CLAUDE.md configuration"

# 2. Create GitHub repo
echo "📦 Creating GitHub repository..."
gh repo create "$REPO_NAME" \
  --public \
  --description "$DESCRIPTION" \
  --push \
  --source .

echo ""
echo "✅ Repository created: https://github.com/$(gh api user --jq .login)/$REPO_NAME"
echo ""
echo "Next steps:"
echo "  1. cp .env.example .env"
echo "  2. Fill in ANTHROPIC_API_KEY in .env"
echo "  3. pnpm install"
echo "  4. pnpm docker:up"
echo "  5. pnpm db:push"
echo "  6. pnpm dev"
echo ""
echo "Then open http://localhost:3000 and upload scripts/sample.csv to test!"
