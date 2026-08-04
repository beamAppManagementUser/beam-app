#!/usr/bin/env bash
# scripts/run_migrations.sh
# Usage: ./scripts/run_migrations.sh
# Runs each migration file in migrations/ in lexical order using wrangler d1 execute
set -euo pipefail
BINDING_NAME=${1:-DB}
MIG_DIR="migrations"

echo "Running D1 migrations against binding: ${BINDING_NAME}"
for f in $(ls ${MIG_DIR}/*.sql | sort); do
  echo "Applying migration: ${f}"
  wrangler d1 execute --binding ${BINDING_NAME} --file "${f}"
done

echo "Migrations complete"
