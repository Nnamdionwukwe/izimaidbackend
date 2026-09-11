#!/bin/bash
# Run all seed files in dependency order.
# Usage: ./db/seed-all.sh [db_name]
#   default db_name: izimaid_db

set -euo pipefail

DB="${1:-izimaid_db}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEED_DIR="$ROOT/db/seed"

GREEN=$'\033[0;32m'
RED=$'\033[0;31m'
BOLD=$'\033[1m'
NC=$'\033[0m'

if [ ! -d "$SEED_DIR" ]; then
  echo "${RED}❌ $SEED_DIR not found${NC}"
  exit 1
fi

# Dependency order — foundational tables first
ORDER=(
  "01-extensions.sql"
  "02-enums.sql"
  "users.sql"
  "auth.sql"
  "notification_preferences.sql"
  "user_settings.sql"
  "user_devices.sql"
  "push_tokens.sql"
  "platform_settings.sql"
  "supported_currencies.sql"
  "supported_languages.sql"
  "ng_banks.sql"
  "maid_profiles.sql"
  "maid_availability.sql"
  "maid_documents.sql"
  "maid_bank_details.sql"
  "maid_wallets.sql"
  "wallet_transactions.sql"
  "bookings.sql"
  "booking_locations.sql"
  "payments.sql"
  "reviews.sql"
  "sos_alerts.sql"
  "emergency_contacts.sql"
  "conversations.sql"
  "messages.sql"
  "notifications.sql"
  "withdrawals.sql"
  "maid_payouts.sql"
  "subscription_plans.sql"
  "subscriptions.sql"
  "subscription_invoices.sql"
  "support_conversations.sql"
  "support_messages.sql"
  "support_ticket_attachments.sql"
  "customer_support_tickets.sql"
  "customer_support_replies.sql"
  "maid_support_conversations.sql"
  "maid_support_messages.sql"
  "maid_support_tickets.sql"
  "maid_support_replies.sql"
  "admin_audit_log.sql"
  "admin_reports.sql"
  "leads.sql"
  "promo_codes.sql"
  "pin_attempts.sql"
)

echo "============================================================"
echo "  SEEDING $DB"
echo "  From: $SEED_DIR"
echo "============================================================"
echo ""

for f in "${ORDER[@]}"; do
  if [ ! -f "$SEED_DIR/$f" ]; then
    echo "  ⏭  $f ${RED}(not found — skipped)${NC}"
    continue
  fi
  echo -n "  ▶  $f ... "
  if sudo -u postgres psql "$DB" -q -f "$SEED_DIR/$f" >/dev/null 2>&1; then
    echo "${GREEN}✅${NC}"
  else
    echo "${RED}❌ FAILED${NC}"
    echo ""
    echo "--- Error details ---"
    sudo -u postgres psql "$DB" -f "$SEED_DIR/$f"
    exit 1
  fi
done

# Also run any seed files not in the ORDER list (in alphabetical order)
for f in "$SEED_DIR"/*.sql; do
  [ -f "$f" ] || continue
  base=$(basename "$f")
  # Skip if already in ORDER
  if [[ " ${ORDER[*]} " =~ " $base " ]]; then
    continue
  fi
  echo -n "  ▶  $base ${DIM}(not in ORDER — appended)${NC} ... "
  if sudo -u postgres psql "$DB" -q -f "$f" >/dev/null 2>&1; then
    echo "${GREEN}✅${NC}"
  else
    echo "${RED}❌ FAILED${NC}"
    sudo -u postgres psql "$DB" -f "$f"
    exit 1
  fi
done

echo ""
echo "============================================================"
echo "  ${GREEN}✅ SEED COMPLETE${NC}"
echo "============================================================"