#!/bin/bash
# db/apply-to-live.sh — create tables missing from production
#
# Safe to re-run: every seed uses CREATE TABLE IF NOT EXISTS.
# Creates only the tables that were confirmed missing from production.
#
# Usage:
#   ./db/apply-to-live.sh              # apply to izimaid_db
#   ./db/apply-to-live.sh my_db        # apply to a specific DB
#   ./db/apply-to-live.sh izimaid_db --dry-run
#
set -euo pipefail

DB="${1:-izimaid_db}"
DRY_RUN=""
if [ "${2:-}" = "--dry-run" ] || [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN="--dry-run"
  [ "${1:-}" = "--dry-run" ] && DB="izimaid_db"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEED_DIR="$ROOT/db/seed"

GREEN=$'\033[0;32m'
RED=$'\033[0;31m'
YELLOW=$'\033[0;33m'
BOLD=$'\033[1m'
DIM=$'\033[2m'
NC=$'\033[0m'

# ── Seed files that CREATE tables missing from production ─────────────
# Each file was verified missing via column diff on izimaid_test.
NEW_TABLES=(
  "contact.controller.sql"                   # → contact_messages
  "giftCertificate.controller.sql"           # → gift_certificates
  "shelter.controller.sql"                   # → shelter_applications
  "foundation.controller.sql"                # → foundation_donations
  "maidApplication.controller.sql"           # → maid_applications
  "caregiverTraining.controller.sql"         # → caregiver_applications
  "cleanerTraining.controller.sql"           # → cleaner_applications
  "domesticCertification.controller.sql"     # → domestic_certification_applications
  "housekeeperTraining.controller.sql"       # → housekeeper_applications
)

echo "============================================================"
echo "  APPLY MISSING TABLES TO: $DB"
if [ -n "$DRY_RUN" ]; then
  echo "  ${YELLOW}DRY RUN — no changes will be made${NC}"
fi
echo "  Seed dir: $SEED_DIR"
echo "============================================================"
echo ""

# Pre-flight: verify the DB exists
if ! sudo -u postgres psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "$DB"; then
  echo "${RED}❌ Database '$DB' does not exist${NC}"
  exit 1
fi

# Pre-flight: verify all seed files exist
missing_files=0
for f in "${NEW_TABLES[@]}"; do
  if [ ! -f "$SEED_DIR/$f" ]; then
    echo "  ${RED}❌ MISSING FILE: $f${NC}"
    missing_files=$((missing_files + 1))
  fi
done
if [ "$missing_files" -gt 0 ]; then
  echo ""
  echo "${RED}❌ $missing_files seed file(s) not found — aborting${NC}"
  exit 1
fi

if [ -n "$DRY_RUN" ]; then
  echo "${BOLD}Files that WOULD be applied:${NC}"
  for f in "${NEW_TABLES[@]}"; do
    printf "  %-45s (%s bytes)\n" "$f" "$(wc -c < "$SEED_DIR/$f" | tr -d ' ')"
  done
  echo ""
  echo "${GREEN}✅ Dry-run complete — nothing changed${NC}"
  exit 0
fi

# ── Apply each seed ───────────────────────────────────────────────────
applied=0
failed=0

for f in "${NEW_TABLES[@]}"; do
  echo -n "  ▶  $f ... "
  if sudo -u postgres psql "$DB" -q -f "$SEED_DIR/$f" >/dev/null 2>&1; then
    echo "${GREEN}✅${NC}"
    applied=$((applied + 1))
  else
    echo "${RED}❌ FAILED${NC}"
    echo ""
    echo "--- Error details for $f ---"
    sudo -u postgres psql "$DB" -f "$SEED_DIR/$f" 2>&1 | tail -20
    failed=$((failed + 1))
  fi
done

echo ""
echo "============================================================"
if [ "$failed" -gt 0 ]; then
  echo "  ${RED}❌ $failed of $((applied + failed)) failed${NC}"
  echo "============================================================"
  exit 1
fi

echo "  ${GREEN}✅ $applied seeds applied successfully${NC}"
echo "============================================================"
echo ""
echo "${BOLD}Tables now on $DB:${NC}"
sudo -u postgres psql "$DB" -tAc "
  SELECT tablename FROM pg_tables
  WHERE schemaname='public'
    AND tablename IN (
      'contact_messages','gift_certificates','shelter_applications',
      'foundation_donations','maid_applications','caregiver_applications',
      'cleaner_applications','domestic_certification_applications',
      'housekeeper_applications'
    )
  ORDER BY tablename;
" | sed 's/^/   /'