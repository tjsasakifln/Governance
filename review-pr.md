# /review-pr - Automated PR Review, Fix & Merge

## Purpose

Automatically selects, analyzes, corrects, and merges pull requests with absolute rigor based on universally accepted Silicon Valley CTO-approved standards. Only PRs that achieve a **perfect score (100%)** across all 8 criteria categories are merged automatically.

## Key Principles

1. **Deterministic Selection**: Uses scoring algorithm to select the highest-priority PR (no human bias)
2. **Incontestable Criteria**: Based on Google, Netflix, AWS, OWASP industry standards
3. **Automated Fixes**: Applies only consagrated (universally accepted) fixes without approval
4. **Zero Tolerance**: 100% score required - any violation blocks merge
5. **Safety Net**: 3-layer post-merge validation with automatic rollback
6. **CI/CD Optimized**: Leverages cache NPM + path filters for faster validation (see `.github/SLASH_COMMANDS.md`)

## Selection Algorithm (Deterministic)

When invoked without arguments, `/review-pr` automatically selects the most important PR using:

### Eligibility Filter

Only PRs that meet ALL of these are considered:

- ✅ CI status: ALL checks passing (100% green) - if CI exists
- ✅ Not marked as draft
- ✅ No "wip" or "do-not-merge" labels
- ✅ No merge conflicts
- ✅ State: OPEN

### Scoring Formula

```
Total Score = Priority_Weight + Age_Weight + Size_Weight + Label_Weight

Where:
 Priority_Weight = Commit type priority
 - hotfix: 10 points
 - feat: 8 points
 - fix: 6 points
 - refactor: 4 points
 - test: 7 points (high priority for M1)
 - docs: 2 points
 - chore: 1 point

 Age_Weight = Days since PR created
 - >72 hours: +4 points
 - >48 hours: +2 points
 - >24 hours: +1 point
 - <24 hours: 0 points

 Size_Weight = Lines changed (inversely proportional)
 - <100 lines: +3 points
 - <200 lines: +2 points
 - <400 lines: +1 point
 - >400 lines: -2 points (discourage large PRs)

 Label_Weight = Special labels
 - security/deploy/performance: +5 points each
 - test/docs: +2 points each
 - wip/blocked: -100 points (effectively blocks)
```

### Tiebreaker

If multiple PRs have the same score, select the **oldest PR** (First In, First Out).

## 8 Categories of Validation Criteria

### Category 1: Code Quality Gates (12.5%)

- ✅ CI Pipeline: 100% green (if implemented)
- ✅ Test Coverage: ≥70% backend, ≥60% frontend (M1 target)
- ✅ Linting Errors: 0 (ESLint)
- ✅ Type Errors: 0 (TypeScript)
- ✅ Code Formatting: 100% Prettier-compliant
- ✅ Import Sorting: Clean, no circular dependencies

### Category 2: Testing Requirements (12.5%)

- ✅ Unit Tests: ≥70% coverage backend, ≥60% frontend, 100% passing
- ✅ Integration Tests: 100% passing (if applicable)
- ✅ E2E Tests: 100% passing (if implemented)
- ✅ Performance Tests: No regression >10% (if applicable)
- ✅ Smoke Tests: Critical paths validated

### Category 3: Security Standards (12.5%)

- ✅ Vulnerability Scan: 0 HIGH/CRITICAL (`npm audit`)
- ✅ Dependency Audit: 0 CVEs
- ✅ Hardcoded Secrets: 0 secrets detected
- ✅ SQL Injection: 0 vulnerabilities (TypeORM protects)
- ✅ XSS: 0 vulnerabilities (React escapes by default)
- ✅ Input Sanitization: class-validator applied

### Category 4: Documentation Standards (12.5%)

- ✅ Function Docstrings: 100% public functions (JSDoc/TSDoc)
- ✅ Class Docstrings: 100% public classes
- ✅ CHANGELOG Updated: If feature/fix PR
- ✅ API Docs: Swagger updated if API changed
- ✅ Type Hints: 100% TypeScript (no `any` in new code)

### Category 5: Architecture & Design (12.5%)

- ✅ Cyclomatic Complexity: ≤10 per function
- ✅ Code Duplication: <5%
- ✅ Function Length: ≤50 lines
- ✅ Maintainability Index: Grade A/B

### Category 6: Git Standards (12.5%)

- ✅ Commit Messages: 100% semantic (Conventional Commits)
- ✅ PR Description: All 5 sections present (Context, Changes, Testing, Risks, Closes)
- ✅ Linked Issue: "Closes #xxx" present
- ✅ Merge Conflicts: 0 conflicts
- ✅ Breaking Changes: Documented if present

### Category 7: Review Standards (12.5%)

- ✅ PR Size: ≤400 lines
- ✅ Single Responsibility: 1 primary purpose
- ✅ Backwards Compatible: No breaking changes (unless documented)
- ✅ Test-to-Code Ratio: ≥0.5
- ✅ Not Draft: Ready for production

### Category 8: Operational Excellence (12.5%)

- ✅ Health Checks: Implemented for new endpoints
- ✅ Monitoring: Logs for critical paths (NestJS Logger)
- ✅ Error Handling: Try-catch with proper logging
- ✅ Rollback Plan: Documented in PR
- ✅ Resource Cleanup: No memory leaks
- ✅ Idempotency: Critical operations idempotent

## Automated Fixes (Consagrated Standards Only)

If score = 100% but minor formatting issues exist, these are auto-fixed:

1. **Code Formatting** (`npx prettier --write`)
 - Deterministic, zero semantic changes
 - Industry standard (Google, Airbnb, Microsoft)

2. **Import Sorting** (ESLint auto-fix)
 - Removes ambiguity, improves readability
 - Zero semantic changes

3. **Auto-fixable Linting** (`npx eslint --fix`)
 - Unused imports
 - Unused variables
 - Semicolons, quotes consistency

4. **Basic JSDoc** (Google-style templates)
 - Skeleton docstrings for undocumented functions
 - Template-based (not AI-generated)

**After auto-fixes**: Re-run tests and await 100% passing before proceeding.

## Post-Merge Safety Net (3 Layers)

After successful merge, execute 3-layer validation:

### Layer 1: Health Checks (1-2 min)

```bash
# Backend
cd backend && npm run build && npm test

# Frontend
cd frontend && npm run build && npm test
```

- Build succeeds
- Tests pass
- No runtime errors

**Failure Action**: Immediate rollback

### Layer 2: Smoke Tests (3-5 min)

```bash
# Run critical path tests
npm run test:e2e -- --grep "critical"
```

- Critical user journeys
- Authentication flows
- Core API endpoints
- Database operations

**Failure Action**: Immediate rollback + reopen PR with `post-merge-failure` label

### Layer 3: CI Pipeline (5-10 min)

```bash
gh run watch --interval 10
```

- Full test suite on `master`
- Build artifacts
- Integration tests

**Failure Action**: Immediate rollback + incident report

## Rollback Strategy

If any post-merge validation fails:

```bash
# 1. Capture merge commit
MERGE_SHA=$(git log -1 --format="%H")

# 2. Revert merge commit
git revert $MERGE_SHA --no-edit -m 1

# 3. Push revert
git push origin master

# 4. Reopen PR
gh pr reopen $PR_NUMBER
gh pr edit $PR_NUMBER --add-label "post-merge-failure"

# 5. Comment failure details
gh pr comment $PR_NUMBER --body "⚠ Post-Merge Validation FAILED - Rollback executed"

# 6. Alert
echo "❌ Rollback executed for PR #$PR_NUMBER" >&2
```

## Execution Workflow

When user invokes `/review-pr`:

### Step 1: Select PR (Deterministic Algorithm)

```bash
# Fetch all open PRs
gh pr list --state open --json number,title,labels,createdAt,additions,deletions --limit 100 > /tmp/prs.json

# Filter eligible PRs (not draft, no conflicts)
# Calculate scores using formula above
# Select highest scoring PR
# If tie, select oldest

PR_NUMBER=<selected>
PR_TITLE=<title>

echo "Selected PR #$PR_NUMBER: $PR_TITLE"
echo " Score: <total_score> points"
echo " Reason: <selection_rationale>"
```

### Step 2: Validate Criteria (100% Required)

```bash
# Manual validation (until automated scripts exist)
echo "Validating PR #$PR_NUMBER against 8 criteria categories..."

# Check each category manually:
# 1. Code Quality Gates
# 2. Testing Requirements
# 3. Security Standards
# 4. Documentation Standards
# 5. Architecture & Design
# 6. Git Standards
# 7. Review Standards
# 8. Operational Excellence

# If any category fails, report and exit
if [ "$SCORE" -lt 100 ]; then
 echo "❌ PR #$PR_NUMBER REJECTED - Score: $SCORE/100"
 echo "Failed categories: <list>"
 exit 1
fi

echo "✅ PR #$PR_NUMBER achieved perfect score (100/100)"
```

### Step 3: Apply Auto-Fixes (If Needed)

```bash
# Check if auto-fixable issues exist
if [ -n "$(git status --porcelain)" ]; then
 echo "Applying auto-fixes..."

 # Checkout PR branch
 gh pr checkout $PR_NUMBER

 # Apply formatting
 npm run format

 # Apply linting fixes
 npm run lint:fix

 # Commit and push
 git add .
 git commit -m "chore: apply automated fixes (review-pr)"
 git push

 # CI/CD Note: Este commit acionará workflows apenas se tocar arquivos TypeScript
 # Path filters: commits apenas de formatação em docs NÃO acionam CI/CD

 # Wait for tests
 echo "Waiting for tests to re-run (cache NPM reduz tempo em ~60%)..."
 npm test

 if [ $? -ne 0 ]; then
 echo "❌ Auto-fixes caused test failures - manual review required"
 exit 1
 fi

 echo "✅ Auto-fixes applied successfully, all tests still passing"
else
 echo "✅ No auto-fixes needed - PR already perfect"
fi
```

### Step 4: Merge PR

```bash
echo "Merging PR #$PR_NUMBER to master..."

# Merge using merge commit strategy (preserves history)
gh pr merge $PR_NUMBER --merge --delete-branch

MERGE_SHA=$(git log -1 --format="%H")

echo "✅ Merged successfully (commit: $MERGE_SHA)"
```

### Step 5: Post-Merge Validation

```bash
echo "Running post-merge validation (3 layers)..."

# CI/CD Optimization Note:
# - Cache NPM is enabled: First run ~2min, subsequent runs ~30s (cache hit)
# - Path filters active: Commits apenas docs NÃO acionam workflows
# - See .github/SLASH_COMMANDS.md for optimization details

# Layer 1: Health Checks
echo "Layer 1: Building and testing..."
cd backend && npm run build && npm test
cd ../frontend && npm run build && npm test

if [ $? -ne 0 ]; then
 echo "❌ POST-MERGE VALIDATION FAILED (Layer 1)"
 echo "Executing automatic rollback..."

 # Rollback
 git revert $MERGE_SHA --no-edit -m 1
 git push origin master

 # Reopen PR
 gh pr reopen $PR_NUMBER
 gh pr edit $PR_NUMBER --add-label "post-merge-failure"

 # Comment
 gh pr comment $PR_NUMBER --body "⚠ Post-Merge Validation FAILED (Layer 1: Build/Test) - Automatic rollback executed."

 echo "✅ Rollback completed - master branch is stable"
 exit 1
fi

echo "✅ Layer 1 passed"

# Layer 2: Smoke Tests (if implemented)
# Layer 3: CI Pipeline (if implemented)

echo "✅ Post-merge validation passed - merge is safe"
```

### Step 6: Finalize

```bash
echo ""
echo "================================================================================"
echo "✅ PR #$PR_NUMBER SUCCESSFULLY MERGED AND VALIDATED"
echo "================================================================================"
echo ""
echo "Summary:"
echo " - PR Number: #$PR_NUMBER"
echo " - Title: $PR_TITLE"
echo " - Validation Score: 100/100 (Perfect)"
echo " - Merge Commit: $MERGE_SHA"
echo " - Post-Merge Validation: ✅ PASSED"
echo ""
echo "The merge is complete and production-safe!"
echo ""

# Close issue if PR closes one
ISSUE_NUMBER=$(gh pr view $PR_NUMBER --json body -q .body | grep -oP 'Closes #\K\d+' | head -1)

if [ -n "$ISSUE_NUMBER" ]; then
 echo "Closing linked issue #$ISSUE_NUMBER..."
 gh issue close $ISSUE_NUMBER --comment "Resolved by PR #$PR_NUMBER (automated merge via /review-pr)"
 echo "✅ Issue #$ISSUE_NUMBER closed"
fi
```

### Step 7: Update ROADMAP.md

```bash
echo ""
echo "================================================================================"
echo "📝 UPDATING ROADMAP.md"
echo "================================================================================"
echo ""

# Checkout master (garantir que estamos na branch certa)
git checkout master
git pull origin master

# Extrair informações do PR
TODAY=$(date +%Y-%m-%d)

# Determinar tipo do PR baseado no título
if [[ "$PR_TITLE" =~ ^feat ]]; then
  PR_TYPE="Feature"
elif [[ "$PR_TITLE" =~ ^fix ]]; then
  PR_TYPE="Fix"
elif [[ "$PR_TITLE" =~ ^refactor ]]; then
  PR_TYPE="Refactor"
elif [[ "$PR_TITLE" =~ ^test ]]; then
  PR_TYPE="Test"
elif [[ "$PR_TITLE" =~ ^docs ]]; then
  PR_TYPE="Docs"
elif [[ "$PR_TITLE" =~ ^security ]]; then
  PR_TYPE="Security"
elif [[ "$PR_TITLE" =~ ^perf ]]; then
  PR_TYPE="Perf"
elif [[ "$PR_TITLE" =~ ^chore ]]; then
  PR_TYPE="Chore"
elif [[ "$PR_TITLE" =~ ^deps ]]; then
  PR_TYPE="Deps"
else
  PR_TYPE="Feature"
fi

echo "Updating ROADMAP.md with PR #$PR_NUMBER..."
echo " - Date: $TODAY"
echo " - Type: $PR_TYPE"
echo " - Issue: #$ISSUE_NUMBER"

# 1. Adicionar entrada na tabela "Atualizações Recentes"
NEW_ENTRY="| $TODAY | #$PR_NUMBER | $PR_TYPE | ${PR_TITLE} (#${ISSUE_NUMBER}) ✅ |"

# Encontrar a linha após o cabeçalho da tabela (após a linha de separação com dashes)
# Inserir logo após a linha que contém "| ----------"
sed -i "/| ---------- | ----- | -------- |/a\\$NEW_ENTRY" ROADMAP.md

echo "✅ Added entry to Recent Updates table"

# 2. Atualizar status da issue no Milestone (se encontrada)
if grep -q "#${ISSUE_NUMBER}" ROADMAP.md; then
  # Mudar 🔴 para ✅
  sed -i "s/\(.*#${ISSUE_NUMBER}.*\)🔴/\1✅/" ROADMAP.md

  echo "✅ Updated issue #${ISSUE_NUMBER} status to ✅"
else
  echo "⚠ Issue #${ISSUE_NUMBER} not found in milestone sections (may be orphan issue)"
fi

# 3. Atualizar header (progresso total e data)
CURRENT_COMPLETED=$(grep "Progresso:" ROADMAP.md | grep -oP '\d+(?=/)')
TOTAL=$(grep "Progresso:" ROADMAP.md | grep -oP '(?<=/)\d+')
NEW_COMPLETED=$((CURRENT_COMPLETED + 1))
NEW_PERCENTAGE=$(awk "BEGIN {printf \"%.1f\", ($NEW_COMPLETED/$TOTAL)*100}")

sed -i "s/Progresso: ${CURRENT_COMPLETED}\/${TOTAL}/Progresso: ${NEW_COMPLETED}\/${TOTAL}/" ROADMAP.md
sed -i "s/([0-9.]*%)/($NEW_PERCENTAGE%)/" ROADMAP.md
sed -i "s/Atualizado: [0-9-]*/Atualizado: $TODAY/" ROADMAP.md

echo "✅ Updated progress: ${CURRENT_COMPLETED}/${TOTAL} → ${NEW_COMPLETED}/${TOTAL} (${NEW_PERCENTAGE}%)"

# 4. Commit e Push
git add ROADMAP.md

git commit -m "$(cat <<EOF
docs(roadmap): update after PR #${PR_NUMBER} merge - ${PR_TITLE}

- Add entry to Recent Updates table
- Update issue #${ISSUE_NUMBER} status to ✅
- Update progress metrics: ${NEW_COMPLETED}/${TOTAL} (${NEW_PERCENTAGE}%)

Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

git push origin master

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ ROADMAP.md updated and pushed to master successfully!"
  echo ""
else
  echo ""
  echo "❌ Failed to push ROADMAP.md to master"
  echo "⚠ Manual intervention required"
  echo ""
  exit 1
fi
```

## Usage Examples

### Example 1: Auto-select and merge best PR

```
User: /review-pr
```
