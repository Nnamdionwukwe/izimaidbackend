#!/bin/bash
# Show project structure + seed coverage
# Usage: ./db/show-project.sh

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
RED=$'\033[0;31m'
BOLD=$'\033[1m'
DIM=$'\033[2m'
NC=$'\033[0m'

echo "============================================================"
echo "  IZIMAID PROJECT STRUCTURE"
echo "  Root: $ROOT"
echo "============================================================"
echo ""

# ── Top-level layout ──────────────────────────────────────────
echo "${BOLD}📁 Top-level${NC}"
ls -1 "$ROOT" | grep -v node_modules | sed 's/^/   /'
echo ""

# ── Controllers ───────────────────────────────────────────────
echo "${BOLD}📁 src/controllers/${NC}"
if [ -d "$ROOT/src/controllers" ]; then
  for f in "$ROOT/src/controllers"/*.js; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    # Skip backups
    [[ "$base" == *.bak* ]] && continue

    # Check if a seed file exists
    seed_name="${base%.js}.sql"
    if [ -f "$ROOT/db/seed/$seed_name" ]; then
      echo "   ${GREEN}✅ $base${NC}  →  db/seed/$seed_name"
    else
      echo "   ${YELLOW}⬜ $base${NC}  →  ${DIM}(no seed yet)${NC}"
    fi
  done
else
  echo "   ${RED}❌ src/controllers not found${NC}"
fi
echo ""

# ── Routes ────────────────────────────────────────────────────
echo "${BOLD}📁 src/routes/${NC}"
if [ -d "$ROOT/src/routes" ]; then
  ls -1 "$ROOT/src/routes" | grep -v '\.bak' | sed 's/^/   /'
fi
echo ""

# ── Utils ─────────────────────────────────────────────────────
echo "${BOLD}📁 src/utils/${NC}"
if [ -d "$ROOT/src/utils" ]; then
  ls -1 "$ROOT/src/utils" | grep -v '\.bak' | sed 's/^/   /'
fi
echo ""

# ── Config ────────────────────────────────────────────────────
echo "${BOLD}📁 src/config/${NC}"
if [ -d "$ROOT/src/config" ]; then
  ls -1 "$ROOT/src/config" | grep -v '\.bak' | sed 's/^/   /'
fi
echo ""

# ── Seed files ────────────────────────────────────────────────
echo "${BOLD}📁 db/seed/${NC}"
if [ -d "$ROOT/db/seed" ]; then
  for f in "$ROOT/db/seed"/*.sql; do
    [ -f "$f" ] || continue
    size=$(wc -l < "$f" | tr -d ' ')
    printf "   %-40s (%s lines)\n" "$(basename "$f")" "$size"
  done
  # Check for orphan seeds (no matching controller)
  for f in "$ROOT/db/seed"/*.sql; do
    [ -f "$f" ] || continue
    base=$(basename "$f" .sql)
    if [ ! -f "$ROOT/src/controllers/$base.js" ]; then
      echo "   ${YELLOW}⚠️  $(basename "$f") — no matching controller${NC}"
    fi
  done
else
  echo "   ${DIM}(db/seed/ does not exist yet)${NC}"
fi
echo ""

# ── Coverage summary ──────────────────────────────────────────
echo "${BOLD}── COVERAGE ──${NC}"
total=0; seeded=0
if [ -d "$ROOT/src/controllers" ]; then
  for f in "$ROOT/src/controllers"/*.js; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    [[ "$base" == *.bak* ]] && continue
    total=$((total + 1))
    [ -f "$ROOT/db/seed/${base%.js}.sql" ] && seeded=$((seeded + 1))
  done
fi
echo "   Controllers:   $total"
echo "   Seeded:        $seeded / $total"
if [ "$total" -gt 0 ]; then
  pct=$((seeded * 100 / total))
  echo "   Progress:      $pct%"
fi
echo ""
echo "============================================================"