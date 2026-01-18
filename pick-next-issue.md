# Pick Next Issue - Executing Engineer ETP Express

You are the **Executing Engineer** of the ETP Express project.
Your job is to pick **a single issue** from the backlog and handle it until PR creation. Merge and closing are done via `/review-pr`.

---

## GENERAL OBJECTIVE

Select and implement the next **executable** issue from the ETP Express repository, creating a PR ready for review. Merge and closing are the responsibility of `/review-pr`.

**IMPORTANT:** Before starting, consult `ROADMAP.md` to understand:

* Current status of milestones (M1-M6)
* Current project priorities
* Context of blockers or critical dependencies
* Objectives of the current development phase

---

## 1. ISSUE SELECTION (Deterministic Algorithm)

### Step 1: Consult ROADMAP.md

**REQUIRED:** Read the current status section in ROADMAP.md to understand:

* Which milestones are complete
* Which milestone is in progress
* Current P0/P1/P2/P3 priorities
* Documented blockers or critical dependencies

# Read roadmap for context
cat ROADMAP.md | grep -A 20 "## Status Atual\|## Prioridades\|## Milestones"

### Step 2: Search Available Issues

gh issue list --state open --json number,title,labels,milestone,updatedAt --limit 200


### Step 3: Apply Selection Algorithm

**Selection Criteria (strict priority order):**

1. **Priority (DECISIVE):** P0 > P1 > P2 > P3

* Check labels: `priority/P0`, `priority/P1`, `priority/P2`, `priority/P3`
* **P0 (BLOCKER):** Must be resolved BEFORE any other priority
* **P1 (HIGH):** High priority - resolve after P0
* **P2 (MEDIUM):** Medium priority - resolve after P1
* **P3 (LOW):** Low priority - resolve after P2

2. **Dependencies (BLOCKING):**

* Check "Dependencies" field in the issue
* **DO NOT** start an issue blocked by other open issues
* Prioritize issues that unblock others (cascade effect)

3. **Milestone (SEQUENTIAL):**

* Follow order: M1 → M2 → M3 → M4 → M5 → M6
* Consult ROADMAP.md to know the current milestone
* Prefer issues from the milestone in progress

4. **Type (IMPACT):**

* Data Integrity (critical for integrity)
* Security/Legal Safety (security and compliance)
* Deploy/Infrastructure (technical foundation)
* Critical Bugs (urgent fixes)
* Features (functionalities)
* Refactoring (code improvements)
* Documentation (documentation)

5. **Size (TIEBREAKER):**

* In case of a tie in the priorities above, choose the smallest (1–4h)
* Atomic issues are always preferred

6. **Total Blockage:**

* If no issue meets the criteria → declare backlog blocked and **STOP**
* Inform the user which dependencies are blocking progress

### Selection Output


SELECTED ISSUE: #<number> – <title>
 Priority: Px
 Milestone: Mx
 Estimated Time: X h
 Dependencies: <None | Blocked by: #X | Blocks: #Y>
 Rationale: <detailed reason for choice based on algorithm>

---

## 2. GOVERNANCE (Pre-Execution Check)

### Fetch Issue Details

gh issue view <number> --json body,labels,title,milestone

### Validate Atomic Structure

The issue **MUST** contain all elements below:

* ✅ **Context**: Why does this task exist?
* ✅ **Objective**: What must be achieved?
* ✅ **File Location**: Specific files to modify/create
* ✅ **Technical Approach**: How to implement (optional but recommended)
* ✅ **Acceptance Criteria**: 3–7 verifiable criteria
* ✅ **Dependencies**: Blocked by / Blocks other issues
* ✅ **Estimated Effort**: 1–8 hours

### If Any Element is Missing → REWRITE EXPRESS

**DO NOT proceed with implementation. Execute the rewrite first:**

## Objective

<Clear and measurable objective of the issue>

## Context

<Why do we need this change? What problem does it solve?>

## Technical Solution

<Technical step-by-step of the implementation>

**File(s):** <Explicit list of files with absolute paths>
**Lines:** <Specific lines to modify (if applicable)>

## ✅ Acceptance Criteria

- [ ] Criterion 1 (verifiable and testable)
- [ ] Criterion 2
- [ ] Criterion 3

## Estimate

**Effort:** <X hours> (1–8h, atomic)

## Dependencies

- **Blocked by:** #<issue-id> or None
- **Blocks:** #<issue-id> or None
- **Related:** #<issue-id> (optional)


Update the issue on GitHub:

gh issue edit <number> --body "<rewritten-content>"



---

## 2.5 ATOMICITY VALIDATION (CRITICAL)

### Atomicity Criterion

An issue is **ATOMIC** if it meets ALL requirements:

1. **Estimate:** 1-8 hours (max 1 workday)
2. **Single Scope:** Resolves a single specific problem
3. **Executable alone:** Does not depend on open issues (blocked by)
4. **Testable in isolation:** Can be validated independently
5. **Complete specification:** Files, approach, and clear ACs

### If Issue is NOT Atomic → DECOMPOSE

**DO NOT EXECUTE non-atomic issues. First, break them into sub-issues.**

#### Identify Need for Breakdown

**BREAK DOWN if:**

* Estimate > 8h
* Multiple distinct objectives in the same body
* Scope is vague or too broad (e.g., "Refactor module X")
* Depends on multiple other issues
* Mixes different types (e.g., feature + refactor + docs)

#### Decomposition Process

**Step 1:** Identify independent sub-tasks

Example of non-atomic issue:

#999 - Secrets Management & API Key Rotation (8-10h)


Break down into:

#1000 - [SEC-999a] Evaluate Secrets Management solutions (2h)
#1001 - [SEC-999b] Implement secret scanning (2h)
#1002 - [SEC-999c] Migrate secrets to chosen solution (2h)
#1003 - [SEC-999d] Document rotation procedure (1h)
#1004 - [SEC-999e] Implement dual-key strategy (2h)
#1005 - [SEC-999f] Implement audit trail for access (3h)


**Step 2:** Create sub-issues on GitHub

For each sub-task:

gh issue create \
 --title "[PARENT-ID subtask-letter] <specific-description>" \
 --milestone "<same-milestone-as-parent>" \
 --label "<same-labels-as-parent>" \
 --body "$(cat <<EOF
## Objective
<Specific objective of this sub-issue>

## Context
This is sub-task [X] of [total] of parent issue #<parent-id>.

**Parent Issue:** #<parent-id> - <parent-title>

## Technical Solution
<Specific technical approach>

**File(s):** <specific files>

## ✅ Acceptance Criteria
- [ ] <specific criterion 1>
- [ ] <specific criterion 2>
- [ ] <specific criterion 3>

## Estimate
**Effort:** <1-3h> (atomic)

## Dependencies
- **Parent:** #<parent-id>
- **Blocked by:** #<previous-issue-in-sequence> (if any)
- **Blocks:** #<next-issue-in-sequence> (if any)

## References
- Parent Issue: #<parent-id>
- Related: <other-related-issues>
EOF
)"


**Step 3:** Update parent issue

Add comment to parent linking the sub-issues:

gh issue comment <parent-id> --body "$(cat <<EOF
## Issue Broken Down into Atomic Sub-Issues

This issue was broken down into the following executable sub-issues:

- [ ] #<sub-1> - <title>
- [ ] #<sub-2> - <title>
- [ ] #<sub-3> - <title>
- [ ] #<sub-4> - <title>

**Total sub-issues:** <N>
**Total Effort:** <X+Y+Z...>h

**Status:** Parent issue remains open until all sub-issues are closed.

**Execution:** Use /pick-next-issue to select each sub-issue in dependency order.
EOF
)"


**Step 4:** Add label to parent

gh issue edit <parent-id> --add-label "parent-issue"


**Step 5:** Return to selection algorithm

After decomposition, **RE-RUN** the selection algorithm (step 1) to choose the first atomic sub-issue.

---

## 3. EXECUTION (Full Development)

### 3.1 Create Branch

git checkout master
git pull origin master
git checkout -b feat/<issue-id>-<descriptive-slug>



Example: `feat/42-configure-jest`

### 3.2 Implementation

* Follow the Technical Approach of the issue **exactly**
* Consult ARCHITECTURE.md for project standards
* Respect NestJS + React architecture
* Add structured logs (use NestJS Logger in backend)
* Implement input validation when applicable

### 3.3 Tests (MANDATORY)


# CI/CD Optimization Note:
# - NPM Cache active: First run ~2min, subsequent ~30s (cache hit)
# - Local tests use same cache as CI/CD
# - Path filters: Docs-only commits DO NOT trigger workflows
# - See .github/SLASH_COMMANDS.md for optimization details

# Backend (NestJS)
cd backend
npm test # Unit tests (cache speeds up deps)
npm run test:e2e # E2E Tests
npm run test:cov # Coverage

# Frontend (React)
cd frontend
npm test # Vitest (cache speeds up deps)
npm run test:coverage # Coverage

# Goal: Increase coverage by ≥ +5 percentage points


### 3.4 Specific Validations

**If touching:**

* **Security/Auth**: Validate rate limiting, input sanitization
* **Deploy/Infrastructure**: Validate railway.json, Procfile, env vars
* **Database**: Test migrations with TypeORM
* **API**: Validate contracts with integration tests
* **LLM/AI**: Validate defensive prompts, anti-hallucination

### 3.5 Documentation

* Update JSDoc/TSDoc
* Update ARCHITECTURE.md if architecture changed
* Add comments in complex code
* Update README.md if necessary

---

## 4. PULL REQUEST (ETP Express Standard)

### 4.1 Semantic Commit

git add .
git commit -m "feat(<scope>): <description> (#<issue-number>)"


Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `security`

Examples:

* `feat(backend): configure jest (#1)`
* `fix(frontend): fix useEffect memory leak (#14)`
* `test(backend): add auth service tests (#2)`

### 4.2 Push and PR

git push origin feat/<issue-id>-<slug>

gh pr create \
 --title "[#<issue-id>] <clear-summary>" \
 --body "$(cat <<EOF
## Context
<Why this change?>

## Changes
- Change 1
- Change 2

## Testing
- [ ] Unit tests passing
- [ ] Integration tests passing (if applicable)
- [ ] Coverage increased by +X%
- [ ] Manual validation performed

## Risks
<Technical risks or potential impacts>

## Rollback Plan
<How to revert if necessary>

## Closes
Closes #<issue-id>
EOF
)"

### 4.3 Wait for CI/CD (Optimized with Cache + Path Filters)

**Active Optimizations:**

* **NPM Cache**: Workflows run ~60% faster (cache hit)
* **Playwright Cache**: Browsers not reinstalled (saves 3-4 min)
* **Path Filters**: Docs-only commits **DO NOT** trigger workflows
* **Secret Scanning**: Only master/PRs (not on dev branches)

**Workflows that Will Be Triggered** (if PR touches TypeScript code):

* ✅ ci-lint.yml - ESLint backend + frontend
* ✅ ci-tests.yml - Jest + Vitest with coverage
* ✅ playwright.yml - E2E Tests (if touching tests/)
* ✅ secret-scan.yml - Gitleaks (incremental scan on PRs)

**Workflows that Will NOT Be Triggered** (if PR is docs only):

* Commits with only `.md`, `docs/` do not trigger CI/CD
* Path filters save ~2900 min/month

**Validation:**

* ✅ All checks must be green
* ✅ Coverage cannot decrease
* ✅ Linting and type checking OK
* ✅ Secret scanning passed (incremental on PRs)

**Reference:** See `.github/SLASH_COMMANDS.md` for optimization details

### 4.4 STOP - Wait for Review

**STOP HERE**

The PR has been created and is waiting for review. The merge will be performed by the `/review-pr` command, which features:

* Rigorous validation in 8 categories (100% score required)
* Auto-fixes for formatting issues
* 3-layer post-merge validation
* Automatic rollback in case of failure

**Next step:** Execute `/review-pr` to validate and merge the PR.

**Expected Output:**

PR #<number> CREATED AND READY FOR REVIEW

Summary:
- Issue: #<issue-id> - <title>
- Branch: feat/<issue-id>-<slug>
- PR: #<pr-number>
- Status: Waiting for /review-pr

Next command: /review-pr

---

## 5. RESPONSIBILITY OF /review-pr

**This phase is executed by the `/review-pr` command**

Closing the issue (Execution Note + `gh issue close`) is the responsibility of `/review-pr` after:

1. Validation in 8 categories (100% score)
2. Successful merge
3. Post-merge validation (3 layers)

**DO NOT execute merge or close issue manually.** Use `/review-pr`.

---

## 6. STOP AND WAIT

**FINALIZE THE CYCLE HERE**

After creating the PR, the `/pick-next-issue` cycle is **COMPLETE**.

* **DO NOT** execute PR merge
* **DO NOT** close the issue manually
* **DO NOT** select another issue automatically
* **DO NOT** open multiple issues in parallel
* **WAIT** for explicit user command

**Suggested next step:** `/review-pr` to validate, merge, and close the issue.

---

## FINAL CHECKLIST (verify before declaring complete)

* [ ] Issue selected followed deterministic algorithm
* [ ] Governance validated or rewrite done
* [ ] Atomicity validated or issue broken down
* [ ] Branch created according to standard
* [ ] Implementation followed Technical Approach
* [ ] Tests added and passing
* [ ] Coverage increased ≥ +5 p.p. (when applicable)
* [ ] Specific validations executed
* [ ] PR created with complete template
* [ ] CI/CD passing (green checks)

**Next step:** `/review-pr` for validation, merge, and closing.

---

## FIXED PARAMETERS OF ETP EXPRESS

* **Atomic size**: 1–8 hours per issue (**mandatory** - larger issues must be broken down)
* **Mandatory tests**: Always add tests for new or modified code
* **Complete documentation**: File Location + Acceptance Criteria + Technical Approach
* **Security**: Validation of OWASP Top 10 vulnerabilities
* **Semantic commits**: Conventional Commits mandatory
* **Milestones**: Follow order M1→M2→M3→M4→M5→M6
* **Respect priorities**: P0 > P1 > P2 > P3 (no exceptions)

---

## PROJECT REFERENCES

### Strategic Documentation

* **Roadmap:** `ROADMAP.md` - **ALWAYS CONSULT** for current status and priorities
* **Audit Report:** `ROADMAP_AUDIT_REPORT.md` - Analysis and audits
* **Architecture:** `ARCHITECTURE.md` - Technical standards
* **Deploy:** `DEPLOY_RAILWAY.md` - Deploy process

### GitHub CLI - Useful Commands

# Open issues by priority
gh issue list --label "priority/P0" --state open
gh issue list --label "priority/P1" --state open
gh issue list --label "priority/P2" --state open
gh issue list --label "priority/P3" --state open

# Issues by milestone
gh issue list --milestone "M1: Foundation" --state open
gh issue list --milestone "M2: CI/CD Pipeline" --state open
gh issue list --milestone "M3: Quality & Security" --state open
gh issue list --milestone "M4: Refactoring & Performance" --state open
gh issue list --milestone "M5: E2E Testing & Documentation" --state open
gh issue list --milestone "M6: Maintenance (Recurring)" --state open

# Issue details
gh issue view <number> --json body,labels,title,milestone

# Open issues (general)
gh issue list --state open --json number,title,labels,milestone


### Breakdown Example

**Parent Issue (non-atomic):**


#100 - Implement complete authentication system (15h)


**Atomic sub-issues:**


#101 - [AUTH-100a] Setup JWT and auth middleware (3h)
#102 - [AUTH-100b] Implement login endpoint (2h)
#103 - [AUTH-100c] Implement register endpoint (2h)
#104 - [AUTH-100d] Add refresh token (3h)
#105 - [AUTH-100e] Implement auth tests (3h)
#106 - [AUTH-100f] Document auth API (2h)


**Result:** 6 atomic issues (2-3h each) instead of 1 monolithic issue (15h)

---

## IMPORTANT WARNINGS

1. **DO NOT execute PR merge** - Merge is exclusive responsibility of `/review-pr`
2. **DO NOT close issues manually** - Closing is done by `/review-pr` after merge
3. **DO NOT skip atomicity validation** - Large issues cause delays and rejected PRs
4. **ALWAYS respect priority order** - P0 before P1, P1 before P2, etc.
5. **DO NOT ignore dependencies** - Check "Blocked by" before starting
6. **DO NOT rewrite issues without creating sub-issues** - If > 8h, breakdown is mandatory
7. **CONSULT ROADMAP.md** - Authoritative document of current project state

---

**Execution Start: NOW**
