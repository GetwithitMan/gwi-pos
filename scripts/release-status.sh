#!/usr/bin/env bash
# release-status.sh — Single-pane-of-glass release readiness check for GWI POS.
# Usage: ./scripts/release-status.sh [version]   (defaults to package.json version)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMO=5                    # seconds per network check
REPO="GetwithitMan/gwi-pos"
IMAGE="ghcr.io/getwithitman/gwi-pos"
NUC_HOST="172.16.20.50"
NUC_PORT="3005"
PASS=0; FAIL=0; SKIP=0; REASONS=()

# ── Portable timeout (macOS lacks coreutils timeout) ────────────────────────
run_tmo() {
  local secs=$1; shift
  if command -v gtimeout &>/dev/null; then gtimeout "$secs" "$@"
  elif command -v timeout &>/dev/null; then timeout "$secs" "$@"
  else perl -e 'alarm shift; exec @ARGV' "$secs" "$@"; fi
}

# ── Color helpers (degrade gracefully) ──────────────────────────────────────
if [[ -t 1 ]] && command -v tput &>/dev/null && [[ $(tput colors 2>/dev/null || echo 0) -ge 8 ]]; then
  GREEN=$(tput setaf 2); RED=$(tput setaf 1); YELLOW=$(tput setaf 3)
  BOLD=$(tput bold); RESET=$(tput sgr0)
else
  GREEN=""; RED=""; YELLOW=""; BOLD=""; RESET=""
fi
ok()   { echo "    ${GREEN}✓${RESET} $1"; ((PASS++)) || true; }
fail() { echo "    ${RED}✗${RESET} $1"; ((FAIL++)) || true; REASONS+=("$1"); }
skip() { echo "    ${YELLOW}○${RESET} $1 (skipped)"; ((SKIP++)) || true; }

# ── 1. Local version ───────────────────────────────────────────────────────
PKG_VERSION=$(jq -r '.version' "$REPO_ROOT/package.json" 2>/dev/null || echo "")
VERSION="${1:-$PKG_VERSION}"
if [[ -z "$VERSION" ]]; then echo "Cannot determine version"; exit 1; fi

# ── 2. Version contract ────────────────────────────────────────────────────
VC=""
for f in "$REPO_ROOT/public/version-contract.json" "$REPO_ROOT/src/generated/version-contract.json"; do
  [[ -f "$f" ]] && VC="$f" && break
done
if [[ -n "$VC" ]]; then
  VC_VER=$(jq -r '.version'          "$VC")
  VC_SCHEMA=$(jq -r '.schemaVersion' "$VC")
  VC_MIG=$(jq -r '.migrationCount'   "$VC")
  VC_DASH=$(jq -r '.dashboardVersion // "n/a"' "$VC")
else
  VC_VER="n/a"; VC_SCHEMA="n/a"; VC_MIG="n/a"; VC_DASH="n/a"
fi

# ── Banner ──────────────────────────────────────────────────────────────────
BAR="═══════════════════════════════════════════════"
echo ""
echo "  ${BOLD}${BAR}${RESET}"
echo "    GWI POS Release Status -- v${VERSION}"
echo "  ${BOLD}${BAR}${RESET}"
echo ""

# ── Local section ───────────────────────────────────────────────────────────
echo "  ${BOLD}Local${RESET}"
printf "    %-24s %s\n" "package.json:" "$PKG_VERSION"
printf "    %-24s %s (schema: %s, migrations: %s)\n" "version-contract:" "$VC_VER" "$VC_SCHEMA" "$VC_MIG"
printf "    %-24s %s\n" "dashboard target:" "$VC_DASH"
echo ""

# ── Helper: does gh CLI exist? ──────────────────────────────────────────────
HAS_GH=false
command -v gh &>/dev/null && gh auth status &>/dev/null 2>&1 && HAS_GH=true

# ── 3. GitHub CI status ────────────────────────────────────────────────────
echo "  ${BOLD}GitHub${RESET}"
if $HAS_GH; then
  CI_RESULT=$(run_tmo "$TMO" gh run list --repo "$REPO" --workflow "CI" \
    --branch main --limit 1 --json conclusion -q '.[0].conclusion' 2>/dev/null || echo "")
  if [[ "$CI_RESULT" == "success" ]]; then
    ok "CI (typecheck):       pass"
  elif [[ -z "$CI_RESULT" ]]; then
    skip "CI (typecheck):       no data"
  else
    fail "CI (typecheck):       $CI_RESULT"
  fi

  # ── 4. Build & Release ───────────────────────────────────────────────────
  BR_RESULT=$(run_tmo "$TMO" gh run list --repo "$REPO" --workflow "Build & Release" \
    --branch main --limit 1 --json conclusion -q '.[0].conclusion' 2>/dev/null || echo "")
  if [[ "$BR_RESULT" == "success" ]]; then
    ok "Build & Release:      pass"
  elif [[ -z "$BR_RESULT" ]]; then
    skip "Build & Release:      no data"
  else
    fail "Build & Release:      $BR_RESULT"
  fi

  # ── 5. Docker image published (GHCR) ────────────────────────────────────
  IMG_CHECK=$(run_tmo "$TMO" gh api \
    "/orgs/GetwithitMan/packages/container/gwi-pos/versions" \
    --jq ".[] | select(.metadata.container.tags[] == \"$VERSION\") | .id" \
    2>/dev/null || echo "")
  if [[ -n "$IMG_CHECK" ]]; then
    ok "Docker image (GHCR):  published"
  else
    # Fallback: try docker manifest inspect
    if command -v docker &>/dev/null && \
       run_tmo "$TMO" docker manifest inspect "${IMAGE}:${VERSION}" &>/dev/null 2>&1; then
      ok "Docker image (GHCR):  published"
    else
      fail "Docker image (GHCR):  not found for $VERSION"
    fi
  fi

  # ── 6. GitHub Release ────────────────────────────────────────────────────
  REL=$(run_tmo "$TMO" gh release view "v${VERSION}" --repo "$REPO" \
    --json tagName -q '.tagName' 2>/dev/null || echo "")
  if [[ "$REL" == "v${VERSION}" ]]; then
    ok "GitHub Release:       v${VERSION}"
  else
    fail "GitHub Release:       v${VERSION} not found"
  fi
else
  skip "CI (typecheck):       gh CLI unavailable"
  skip "Build & Release:      gh CLI unavailable"
  skip "Docker image (GHCR):  gh CLI unavailable"
  skip "GitHub Release:       gh CLI unavailable"
fi
echo ""

# ── Deployment section ──────────────────────────────────────────────────────
echo "  ${BOLD}Deployment${RESET}"

# ── 7. Vercel deployment ──────────────────────────────────────────────────
VERCEL_VER=""
for url in "https://gwi-pos.vercel.app/api/health" "https://gwi-pos.vercel.app/version-contract.json"; do
  VERCEL_VER=$(curl -sf --max-time "$TMO" "$url" 2>/dev/null \
    | jq -r '.version // empty' 2>/dev/null || echo "")
  [[ -n "$VERCEL_VER" ]] && break
done
if [[ "$VERCEL_VER" == "$VERSION" ]]; then
  ok "Vercel:               live ($VERCEL_VER)"
elif [[ -n "$VERCEL_VER" ]]; then
  fail "Vercel:               $VERCEL_VER (expected $VERSION)"
else
  skip "Vercel:               unreachable"
fi

# ── 8. NUC current version ────────────────────────────────────────────────
NUC_VER=$(curl -sf --connect-timeout 2 --max-time "$TMO" \
  "http://${NUC_HOST}:${NUC_PORT}/api/health" 2>/dev/null \
  | jq -r '.version // empty' 2>/dev/null || echo "")
if [[ -z "$NUC_VER" ]]; then
  skip "NUC (${NUC_HOST}):     unreachable"
elif [[ "$NUC_VER" == "$VERSION" ]]; then
  ok "NUC (${NUC_HOST}):     ${NUC_VER}"
else
  fail "NUC (${NUC_HOST}):     ${NUC_VER} -> needs deploy"
fi
echo ""

# ── 9. Fleet readiness verdict ─────────────────────────────────────────────
echo "  ${BOLD}Fleet Readiness${RESET}"
[[ "$PKG_VERSION" == "$VERSION" ]]         && ok "Version matches package.json" || fail "Version mismatch in package.json"
[[ "$VC_VER" == "$VERSION" ]] 2>/dev/null  && ok "Version contract aligned"    || fail "Version contract stale ($VC_VER)"
echo ""

# ── Verdict ─────────────────────────────────────────────────────────────────
if ((FAIL == 0)); then
  echo "  ${GREEN}${BOLD}VERDICT: READY FOR FLEET DEPLOY${RESET}"
  [[ $SKIP -gt 0 ]] && echo "    ($SKIP checks skipped -- verify manually)"
else
  echo "  ${RED}${BOLD}VERDICT: NOT READY${RESET}"
  echo "    Blockers:"
  for r in "${REASONS[@]}"; do echo "      - $r"; done
fi

echo ""
echo "  ${BOLD}${BAR}${RESET}"
echo ""

# Exit code: 0 = ready, 1 = not ready
((FAIL == 0))
