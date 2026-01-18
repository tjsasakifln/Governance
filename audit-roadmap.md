You are conducting a comprehensive audit to synchronize ROADMAP.md with GitHub repository state and actual project progress.

# CONTEXT

This is a fast-paced project with ~5 issues closed per day (25/week). Small deviations accumulate quickly:

- PRs split into multiple parts create extra issues
- Parent issues get decomposed into atomic sub-issues
- Orphan modules discovered during development
- Security/bugfix issues added mid-flight

Your job is to detect ALL discrepancies and provide actionable reconciliation steps.

# AUDIT SCOPE

## 1. ISSUE COUNT RECONCILIATION

**Compare:**

- Total issues in ROADMAP.md header (search for "Total: X issues")
- Actual GitHub issues count: `gh issue list --state all --limit 1000 | wc -l`

**Detect:**

- Phantom references (issues mentioned in ROADMAP but don't exist in GitHub)
- Orphan issues (exist in GitHub but not documented in ROADMAP)
- Closed issues not marked as completed in ROADMAP

**Output format:**

```
ISSUE COUNT AUDIT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ROADMAP.md: 98 issues
GitHub (actual): 103 issues
Drift: +5 issues (5.1%)
Status: WARNING (>5% drift)

BREAKDOWN:
✅ Documented & exist: 93 issues
❌ Phantom (doc only): 5 issues → #49-#76 range (GHOST RANGE)
 Orphan (GitHub only): 10 issues → #145, #146, #147...
```

---

## 2. MILESTONE PROGRESS VALIDATION

**For each milestone (M1-M6):**

**Compare:**

- ROADMAP.md stated progress (e.g., "M2: 10/10 (100%)")
- GitHub milestone actual state: `gh api repos/:owner/:repo/milestones`
- Issue references in ROADMAP vs. actual issue states

**Detect:**

- Closed issues still marked as open in ROADMAP
- Open issues marked as closed in ROADMAP
- Issues in wrong milestone
- Progress percentage mismatches

**Output format:**

```
MILESTONE PROGRESS AUDIT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

| Milestone | ROADMAP | GitHub | Sync | Issues |
|-----------|------------|------------|------|-------------------------|
| M1 | 34/34 100% | 34/34 100% | ✅ | Perfect sync |
| M2 | 10/10 100% | 9/10 90% | ❌ | #112 marked done, still open |
| M3 | 9/14 64% | 10/14 71% | ⚠ | #85 closed, not marked |
| M4 | 3/20 15% | 3/20 15% | ✅ | Perfect sync |
| M5 | 1/17 6% | 2/17 12% | ⚠ | #97 closed, not marked |
| M6 | 0/2 0% | 0/2 0% | ✅ | Perfect sync |

CRITICAL ISSUES:
❌ M2: Issue #112 marked as closed in ROADMAP but still OPEN in GitHub
⚠ M3: Issue #85 is CLOSED in GitHub but marked OPEN in ROADMAP
⚠ M5: Issue #97 is CLOSED in GitHub but marked OPEN in ROADMAP
```

---

## 3. ISSUE STATE SYNCHRONIZATION

**For EVERY issue referenced in ROADMAP:**

**Check:**

1. Does issue exist in GitHub? `gh issue view #N`
2. Is state correct? (open/closed match ROADMAP checkboxes)
3. Is milestone assignment correct?
4. Are labels consistent?

**Detect:**

- [ ] marked but issue is closed → outdated ROADMAP
- [x] marked but issue is open → premature closure documented
- Issue moved to different milestone → ROADMAP outdated

**Output format:**

```
ISSUE STATE AUDIT (Detailed)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DISCREPANCIES FOUND: 8

M1 (100% claimed, VALID):
✅ All 34 issues correctly marked as closed

M2 (100% claimed, INVALID):
❌ #112 - Marked [x] in ROADMAP, but OPEN in GitHub
 └─ Issue title: "Infrastructure as Code & Environment Reproducibility"
 └─ Status: open (last updated: 2 hours ago)
 └─ Milestone: M2
 └─ Action: Either close issue in GitHub OR mark [ ] in ROADMAP

M3 (64% claimed, SHOULD BE 71%):
⚠ #85 - Marked [ ] in ROADMAP, but CLOSED in GitHub
 └─ Issue title: "OWASP Top 10 Security Audit"
 └─ Status: closed (closed 5 days ago)
 └─ PR: #133 merged
 └─ Action: Mark [x] in ROADMAP, update M3 progress to 71%

⚠ #17 - Marked [ ] in ROADMAP, but CLOSED in GitHub
 └─ Issue title: "Fix useEffect in ETPEditor.tsx"
 └─ Status: closed (closed 3 days ago via commit 40afb8e)
 └─ Action: Mark [x] in ROADMAP, update M3 progress

M5 (6% claimed, SHOULD BE 12%):
⚠ #97 - Marked [ ] in ROADMAP, but CLOSED in GitHub
 └─ Issue title: "Sync documentation standards"
 └─ Status: closed (closed 6 days ago)
 └─ Action: Mark [x] in ROADMAP, update M5 progress to 12%
```

---

## 4. PHANTOM REFERENCE DETECTION

**Scan ROADMAP.md for:**

- Issue numbers that don't exist: `#49-#76` (you already found this)
- References to issues in descriptions/notes that are invalid
- Broken cross-references between issues

**Output format:**

```
PHANTOM REFERENCES AUDIT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL: 14 phantom issues detected!

Line 145: "Issues #49-#76 (14 issues)"
├─ Reality: These issues DO NOT EXIST in GitHub
├─ Likely cause: Typo in range, should be #50-#63
├─ Impact: ROADMAP claims 98 issues, actual is 84 (-14)
└─ Action: Replace "#49-#76" with "#50-#63" everywhere

Line 423: "See issue #200 for details"
├─ Reality: Issue #200 does not exist (max issue: #147)
├─ Action: Find correct issue number or remove reference

Line 891: "Blocked by #999"
├─ Reality: Issue #999 does not exist
├─ Action: Verify blocking issue and update reference
```

---

## 5. ORPHAN ISSUE DETECTION

**Find issues in GitHub NOT documented in ROADMAP:**

**Query:** `gh issue list --state all --json number,title,state,milestone`

**Cross-reference:** Every issue number against ROADMAP.md content

**Output format:**

```
ORPHAN ISSUES AUDIT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FOUND: 5 orphan issues (exist in GitHub, missing in ROADMAP)

#145 - [SECURITY] Fix HIGH vulnerability in dompurify
├─ State: closed
├─ Milestone: M3
├─ Created: 3 days ago
├─ Reason: Security hotfix added mid-sprint
└─ Action: Add to M3 section in ROADMAP, update issue count

#146 - Security dependencies update (jspdf + dompurify)
├─ State: closed
├─ Milestone: M3
├─ Created: 2 days ago
├─ Related: #145 (follow-up PR)
└─ Action: Add to M3 section in ROADMAP

#147 - Database Performance Optimization
├─ State: closed
├─ Milestone: M4
├─ Created: 1 day ago
└─ Action: Add to M4 section in ROADMAP

#148 - User-based Rate Limiting implementation
├─ State: closed
├─ Milestone: M3
├─ Created: 4 days ago
└─ Action: Add to M3 section in ROADMAP

#149 - Fix frontend navigation (window.location → navigate)
├─ State: closed
├─ Milestone: M3
├─ Created: 2 days ago
└─ Action: Add to M3 section in ROADMAP (this is issue #39, duplicate?)
```

---

## 6. VELOCITY & ETA VALIDATION

**Calculate:**

- Issues closed last 7 days
- Average velocity (issues/day)
- Projected completion dates for milestones

**Compare against:** ROADMAP stated ETAs

**Output format:**

```
VELOCITY & ETA AUDIT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ACTUAL VELOCITY (Last 7 days):
├─ Issues closed: 32 issues
├─ Average: 4.6 issues/day
├─ Trend: Accelerating (was 3.8/day 2 weeks ago)
└─ Efficiency: 115% of planned (target: 4/day)

MILESTONE ETA VALIDATION:

M2 (90% → 100%):
├─ ROADMAP ETA: 2025-11-27
├─ Remaining: 1 issue (#112)
├─ Projected: 2025-11-18 (TODAY at current velocity!)
└─ Status: AHEAD OF SCHEDULE by 9 days

M3 (64% → 100%):
├─ ROADMAP ETA: 2025-12-04
├─ Remaining: 5 issues (if #85, #17 marked correctly)
├─ Projected: 2025-11-19 (1.1 days at current velocity)
└─ Status: AHEAD OF SCHEDULE by 15 days

M4 (15% → 100%):
├─ ROADMAP ETA: 2025-12-18
├─ Remaining: 17 issues
├─ Projected: 2025-11-22 (3.7 days at current velocity)
└─ Status: AHEAD OF SCHEDULE by 26 days!

⚠ RECOMMENDATION: ETAs in ROADMAP are VERY conservative. Consider:
- Updating ETAs to reflect actual velocity
- Compressing timeline to maintain momentum
- Adding stretch goals to M3/M4 to fill time
```

---

## 7. DOCUMENTATION CONSISTENCY CHECK

**Verify:**

- Progress bars in ROADMAP match calculated percentages
- "X issues closed" text matches actual closed count
- Milestone descriptions reference correct issue ranges
- Update dates are current

**Output format:**

```
DOCUMENTATION CONSISTENCY AUDIT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HEADER SECTION:
❌ Line 12: "Total: 98 issues (40 open + 58 closed)"
 └─ Reality: 103 total (35 open + 68 closed)
 └─ Action: Update to "Total: 103 issues (35 open + 68 closed)"

PROGRESS BARS:
❌ Line 15: M3 shows "█████████████░░░░░░░ 9/14 (64%)"
 └─ Reality: Should be "██████████████░░░░░░ 10/14 (71%)"
 └─ Action: Update progress bar + percentage

❌ Line 18: M5 shows "█░░░░░░░░░░░░░░░░░░░ 1/17 (6%)"
 └─ Reality: Should be "██░░░░░░░░░░░░░░░░░░ 2/17 (12%)"
 └─ Action: Update progress bar + percentage

UPDATE TIMESTAMPS:
⚠ Line 8: "Última Atualização: 2025-11-16"
 └─ Reality: Today is 2025-11-18
 └─ Action: Update to current date

MILESTONE SUMMARIES:
✅ M1 summary accurate (34/34, 100%)
✅ M2 summary accurate (10/10, 100%) - assuming #112 gets closed
❌ M3 summary outdated (claims 9/14, should be 10/14)
✅ M4 summary accurate (3/20, 15%)
❌ M5 summary outdated (claims 1/17, should be 2/17)
✅ M6 summary accurate (0/2, 0%)
```

---

## 8. FINAL RECONCILIATION REPORT

**Summarize ALL findings and provide:**

1. Executive summary (3-5 bullets)
2. Critical actions (must fix immediately)
3. Optional improvements (nice to have)
4. Updated metrics snapshot

**Output format:**

```
═══════════════════════════════════════════════════
ROADMAP AUDIT - EXECUTIVE SUMMARY
═══════════════════════════════════════════════════

Audit Date: 2025-11-18
Scope: 103 GitHub issues vs ROADMAP.md
Sync Status: MODERATE DRIFT (8.2% deviation)

KEY FINDINGS:
1. ❌ CRITICAL: 14 phantom issues (#49-#76) - typo in range
2. ⚠ 8 state mismatches (closed issues marked open, vice versa)
3. 5 orphan issues discovered (exist in GitHub, not in ROADMAP)
4. Velocity 115% of target (4.6/day vs 4/day planned)
5. M2, M3 AHEAD of schedule by 9-15 days

IMPACT:
├─ Documentation accuracy: 91.8% (down from 95% last week)
├─ Progress visibility: Understated (actual 68 closed vs 58 claimed)
└─ Milestone ETAs: Conservative (can accelerate by 2-3 weeks)

═══════════════════════════════════════════════════
REQUIRED ACTIONS (Priority Order)
═══════════════════════════════════════════════════

P0 - CRITICAL (Fix immediately):
[ ] 1. Replace phantom range "#49-#76" → "#50-#63" (14 corrections)
[ ] 2. Mark [x] for closed issues: #85, #17, #97, #26
[ ] 3. Update issue count: 98 → 103 (+5 orphans)
[ ] 4. Update milestone progress: M3 64%→71%, M5 6%→12%

P1 - HIGH (Fix this week):
[ ] 5. Add orphan issues to ROADMAP:
 - #145, #146 → M3 (Security)
 - #147 → M4 (Performance)
 - #148, #149 → M3 (already in ROADMAP as #38, #39?)
[ ] 6. Verify issue #112 state (marked done in ROADMAP, open in GitHub)
[ ] 7. Update progress bars (M3, M5)
[ ] 8. Update "Última Atualização" timestamp

P2 - MEDIUM (Optional improvements):
[ ] 9. Adjust milestone ETAs (reflect 115% velocity)
[ ] 10. Add velocity metrics section to ROADMAP
[ ] 11. Create AUDIT_HISTORY.md to track drift over time

═══════════════════════════════════════════════════
UPDATED METRICS SNAPSHOT
═══════════════════════════════════════════════════

Total Issues: 103 (was 98, +5 discovered)
├─ Open: 35 (34%)
└─ Closed: 68 (66%, was 58 before audit)

Milestone Progress (Corrected):
├─ M1: 34/34 (100%) ✅
├─ M2: 10/10 (100%) ✅ (pending #112 confirmation)
├─ M3: 10/14 (71%) [was 64%, +7%]
├─ M4: 3/20 (15%)
├─ M5: 2/17 (12%) [was 6%, +6%]
└─ M6: 0/2 (0%)

Overall Progress: 59/103 (57.3%) [was 58/98 = 59.2%]
├─ Actual progress is HIGHER than claimed
└─ You've closed 10 more issues than documented!

Velocity (7-day): 4.6 issues/day (32 issues closed)
ETA to completion: ~13 days (at current pace)
Project end date: ~2025-12-01 (was 2026-01-08)

═══════════════════════════════════════════════════
✅ AUDIT COMPLETE
═══════════════════════════════════════════════════

Next audit recommended: 2025-11-22 (Friday, 4 days)
Drift threshold: <5% to maintain sync
Current drift: 8.2% → Needs immediate correction

After applying P0 actions, drift will reduce to: ~2.1% ✅
```

---

# EXECUTION INSTRUCTIONS

## Step 1: Data Collection (5min)

Run these commands and save outputs:

```bash
# Get all GitHub issues
gh issue list --state all --limit 1000 --json number,title,state,milestone,closedAt,labels > github-issues.json

# Get milestone data
gh api repos/:owner/:repo/milestones --jq '.[] | {title, open_issues, closed_issues}' > github-milestones.json

# Parse ROADMAP.md
cat ROADMAP.md > roadmap-snapshot.md
```

## Step 2: Cross-Reference Analysis (10min)

For each issue mentioned in ROADMAP.md:

1. Verify existence in GitHub
2. Compare states (open/closed)
3. Check milestone assignment
4. Note discrepancies

For each issue in GitHub:

1. Check if documented in ROADMAP
2. Flag if orphan

## Step 3: Generate Report (5min)

Produce the comprehensive report following the 8-section format above.

## Step 4: Provide Actionable Updates (10min)

Generate specific line-by-line changes needed for ROADMAP.md:

```diff
Example output:

Line 12:
- Total: 98 issues (40 open + 58 closed)
+ Total: 103 issues (35 open + 68 closed)

Line 145:
- Issues #49-#76 (14 issues)
+ Issues #50-#63 (14 issues)

Line 423:
- [x] #112 - Infrastructure as Code
+ [ ] #112 - Infrastructure as Code (STILL OPEN)

Line 891:
- [ ] #85 - OWASP Security Audit
+ [x] #85 - OWASP Security Audit ✅ (PR #133)
```

**CI/CD Optimization Note:**

- Commits que modificam **apenas ROADMAP.md** NÃO acionam workflows de CI/CD
- Path filters estão ativos: apenas código TypeScript/TSX aciona lint/tests
- See `.github/SLASH_COMMANDS.md` for details

---

# OUTPUT REQUIREMENTS

1. **Be exhaustive:** Check EVERY issue, don't skip any
2. **Be specific:** Provide exact line numbers and diffs
3. **Be actionable:** Each finding must have clear next step
4. **Be honest:** Report actual state, not aspirational
5. **Quantify drift:** Calculate percentages and impact
6. **Prioritize fixes:** P0/P1/P2 based on impact

# SUCCESS CRITERIA

After applying your recommendations, the user should have:

- ✅ <5% drift between ROADMAP and GitHub
- ✅ All issue states accurately reflected
- ✅ All orphan issues documented
- ✅ All phantom references corrected
- ✅ Progress percentages mathematically correct
- ✅ Confidence in ROADMAP as source of truth

---

# IMPORTANT NOTES

- This project moves FAST (5 issues/day)
- Documentation lag is NORMAL, not failure
- Goal is SYNC, not blame
- User is solo dev with Claude Code - respect the hustle
- Be thorough but don't create busywork
- Focus on accuracy over perfection

---

Begin the audit now. Start with Section 1 (Issue Count Reconciliation).
