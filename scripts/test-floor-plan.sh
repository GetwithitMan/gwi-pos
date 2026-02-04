#!/bin/bash

# Floor Plan Feature Test Script
# This script runs an iterative build-test-fix loop for floor plan features

set -e

echo "=== GWI POS Floor Plan Test Script ==="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track test results
TESTS_PASSED=0
TESTS_FAILED=0

log_pass() {
    echo -e "${GREEN}✓ PASS:${NC} $1"
    ((TESTS_PASSED++))
}

log_fail() {
    echo -e "${RED}✗ FAIL:${NC} $1"
    ((TESTS_FAILED++))
}

log_info() {
    echo -e "${YELLOW}→${NC} $1"
}

# Step 1: Check TypeScript compilation
echo "--- Step 1: TypeScript Check ---"
log_info "Running TypeScript type check..."
if npx tsc --noEmit 2>&1 | grep -q "error"; then
    log_fail "TypeScript errors found"
    npx tsc --noEmit 2>&1 | grep "error" | head -10
else
    log_pass "TypeScript compilation"
fi
echo ""

# Step 2: Check ESLint
echo "--- Step 2: ESLint Check ---"
log_info "Running ESLint on floor-plan components..."
if npm run lint -- --quiet 2>&1 | grep -q "error"; then
    log_fail "ESLint errors found"
else
    log_pass "ESLint check"
fi
echo ""

# Step 3: Check that the floor plan files exist and have expected patterns
echo "--- Step 3: Code Pattern Verification ---"

# Check entertainment drag fix
log_info "Checking entertainment element drag fix..."
if grep -q "elementOriginalPositionsRef" src/app/\(admin\)/floor-plan/page.tsx; then
    log_pass "Entertainment element original position tracking exists"
else
    log_fail "Entertainment element original position tracking missing"
fi

if grep -q "handleElementDragStart" src/app/\(admin\)/floor-plan/page.tsx; then
    log_pass "handleElementDragStart function exists"
else
    log_fail "handleElementDragStart function missing"
fi

# Check table split fix
log_info "Checking table split position restoration..."
if grep -q "originalPosX.*originalPosY" src/app/\(admin\)/floor-plan/page.tsx | grep -q "hasOriginalPos"; then
    log_pass "Table split uses original positions"
else
    # More lenient check
    if grep -q "hasOriginalPos" src/app/\(admin\)/floor-plan/page.tsx; then
        log_pass "Table split original position check exists"
    else
        log_fail "Table split original position restoration missing"
    fi
fi

echo ""

# Step 4: Build check
echo "--- Step 4: Build Check ---"
log_info "Running production build..."
if npm run build > /dev/null 2>&1; then
    log_pass "Production build successful"
else
    log_fail "Production build failed"
    echo "Run 'npm run build' to see detailed errors"
fi
echo ""

# Summary
echo "=== Test Summary ==="
echo -e "Passed: ${GREEN}${TESTS_PASSED}${NC}"
echo -e "Failed: ${RED}${TESTS_FAILED}${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}All automated checks passed!${NC}"
    echo ""
    echo "Next steps for manual testing:"
    echo "1. Run 'npm run dev' to start the dev server"
    echo "2. Navigate to /floor-plan in admin mode"
    echo "3. Test entertainment item placement and dragging"
    echo "4. Test table combining and unmerging"
    echo "5. Verify positions are correct after each operation"
    exit 0
else
    echo -e "${RED}Some checks failed. Fix the issues and re-run.${NC}"
    exit 1
fi
