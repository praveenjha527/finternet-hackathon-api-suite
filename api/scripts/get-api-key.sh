#!/bin/bash
# Get API key from database (requires psql)
cd "$(dirname "$0")/.."
if command -v psql &> /dev/null; then
  DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/finternet_pg?schema=public}"
  psql "$DATABASE_URL" -t -c "SELECT \"apiKey\" FROM \"Merchant\" WHERE \"isActive\" = true LIMIT 1;" | xargs
else
  echo "psql not found. Please run: bun run prisma:seed"
  echo "Then check the console output for API keys."
fi
