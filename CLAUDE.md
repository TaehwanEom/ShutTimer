# Antigravity Session Init — ShutTimer

## Session Start (Mandatory, No Exceptions)

1. On the first message, confirm the window name (Plan / Build / Deploy).
2. Read files in this order:

| Order | File | Target |
|-------|------|--------|
| 1 | `Antigravity_개별 지침/antigravity_0_common.md` | All windows |
| 2 | Window-specific guide (table below) | All windows |
| 3 | `Antigravity_개별 지침/반복실수_목록.md` | All windows |

| Window | Guide File |
|--------|-----------|
| Plan | `Antigravity_개별 지침/antigravity_1_plan.md` |
| Build | `Antigravity_개별 지침/antigravity_2_build.md` |
| Deploy | `Antigravity_개별 지침/antigravity_4_deploy.md` |

3. After reading, report: "공통 + [window name] 지침 + 반복실수 로드 완료"
4. **Start work only after reading all files. Code modification, deployment, or execution before reading is strictly forbidden.**

## "지침 읽어" → Reload the files above (own window's guide only)

## Absolute Rules
- Use 존댓말 (formal Korean). 반말 (informal) forbidden.
- Each window stays in its role. Cross the line → stop immediately.
- "확인/검토" (check/review) = check and report only. Execution requires separate approval.
- No v1-out-of-scope features.

---

## Behavioral Guidelines (LLM Coding Mistake Prevention)

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First
Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes
Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution
Define success criteria. Loop until verified.

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

### 5. No Closing Colons (Korean Output)
End Korean sentences with a period, not a colon.

When the user writes in Korean, your output is also Korean:
- Don't end sentences with `:` even if the next line is a list or example.
- LLMs trained on English docs leak the colon habit into Korean. Catch it.
- The test: every Korean sentence terminator should be `.`, `?`, or `!` — not `:`.
- Colons are fine inside code, key-value pairs, or labels. Not as sentence enders.

### 6. File Header Comments in Korean
First line of every new source file: a one-line Korean comment stating its role.

When creating a new file:
- TypeScript/JavaScript: `// 사용자 인증 상태를 관리하는 Context Provider`
- Python: `# KIS API 호출을 비동기로 래핑하는 클라이언트`
- SQL: `-- 일별 집계 결과를 저장하는 머티리얼라이즈드 뷰`
- Place it directly under required directives (`'use client'`, `'use server'`, shebang).
- Skip config files (`*.config.ts`, `package.json`, etc.).

Why: agents read files selectively, not whole codebases. A one-line Korean header gives instant context so the next session (human or agent) can navigate without re-reading the entire file.

### 7. Plan + Checklist + Context Notes
Before any non-trivial task, produce three artifacts. Don't start coding without them.

- **Plan** — what we're building and why.
- **Checklist (`checklist.md`)** — concrete tasks as checkboxes. Tick as you go.
- **Context Notes (`context-notes.md`)** — decisions made during the work and the reasoning behind them. Append continuously.

If the user gives only a plan and asks you to start coding, stop and ask: "Should I create the checklist and context notes first?" The next session — yours or someone else's — needs the notes to pick up where you left off without re-deriving every decision.

### 8. Run Tests Before Marking Complete
If you touched code, run the tests before saying "done".

- `npm test`, `pytest`, `cargo test`, whatever the project uses — run it.
- If tests pass, report results. If they fail, fix and re-run.
- No test setup? At minimum, verify the project builds/compiles.
- Run tests proactively, before the user signals "끝", "완료", "다 됐어" — not after.

This is the step LLMs skip most often. Treat it as non-negotiable.

### 9. Semantic Commits
Commit when one logical change is complete. Don't wait for the user to ask.

- The test: "Can I describe this commit in one sentence?" If yes, commit. If no, the changes are still mixed — split them.
- Good: "auth 미들웨어 추가". Bad: "auth 추가하고 UI도 고치고 버그도 수정" (split into 3).
- Don't accumulate 20 unrelated edits and lose the ability to roll back individually.
- Don't commit just to commit — meaningful units only.

Note: For solo prototypes or throwaway scripts, group commits loosely if it slows you down. The point is reversibility, not ceremony.

### 10. Read Errors, Don't Guess
Read the actual error/log line. Don't pattern-match from memory.

When something fails:
- Read the full error message and stack trace.
- Check the actual log output, not what you assume it should say.
- Don't apply a "common fix" before confirming the cause.
- If unclear, add a print/log to verify state — then fix.

This is the step LLMs skip most often after "run tests". They guess from error keywords and apply the most-recent-pattern fix. That's how a one-line bug becomes a three-file refactor.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Preservation Zone — Phase 2+ Restoration (Do Not Delete)

The code below is commented out and preserved as part of the B-plan (IAP deferral) transition.
Do not delete during future refactoring or cleanup.
Must remain re-activatable by uncommenting alone.

Preserved files:
- `src/context/PurchaseContext.tsx` (keep entirely)
- `src/constants/purchase.ts` (keep entirely)
- `src/components/AdBanner.tsx` (`isAdFree`-related blocks commented)
- `src/screens/AlarmScreen.tsx` (`isAdFree`-related blocks commented)
- `src/screens/SettingsScreen.tsx` (purchase/restore section commented)
- `App.tsx` (`PurchaseProvider` wrapper commented)
- `src/i18n/*.json` (purchase-related translation keys retained)
- `package.json` `react-native-purchases` dependency retained

Reactivation prerequisites: Business registration + ASC Paid Apps Agreement active.
Restoration procedure: search `@preserve IAP` → uncomment → build.

## Preservation Documents — Removed Feature Restoration Reference (Do Not Delete)

The documents below preserve originals of assets removed from code in response to v1.5 review.
Follow each document's "Reintroduction Checklist" procedure when restoring.

- `docs/preserve/v15-location-removal.md` — Location permission removal (includes 14-language translation originals)
  Reintroduction prerequisite: feature design that actually uses location + concrete purpose string examples rewritten.
