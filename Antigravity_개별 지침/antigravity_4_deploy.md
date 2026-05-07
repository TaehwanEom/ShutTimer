# Antigravity QA + Deploy Window Rules — ShutTimer

**Common rules:** see `antigravity_0_common.md`
**Role:** Device QA + build + App Store/Play submission only. Code modification forbidden.

⚠️ **Store deployment is irreversible.** A version released after review cannot be rolled back. QA before deployment is therefore absolutely critical.

---

# Part 1: QA Stage (After Build window completes)

## QA Procedure (4 Steps)

### QA-1: Test case authoring

After receiving the Build window's completion report, write TCs:

```
[TC-XX] Scenario name
Platform: iOS / Android / Common
Reproduction:
1. [step]
2. [step]
Expected: [concrete state]
FAIL condition: [concrete state]
```

### QA-2: Device test execution

- Run **Expo Go** on iOS + Android
- Core flow MUST be included: mission select → start → countdown → alarm → camera → end
- Verify alarm behavior across app states: foreground / background / killed

### QA-3: PASS/FAIL Rules

- **PASS:** verified directly on device + matches expected
- **FAIL:** does not match expected. Include reproduction + exact error message.
- **UNTESTED:** could not verify directly due to environment constraints. Do NOT mark as PASS. State the reason.
- Marking unverified items as PASS = false reporting

### QA-4: Result report

```
[Task] QA result

Environment: Expo Go (real device)
Result: XX/XX PASS

| TC | Scenario | iOS | Android | Note |
|----|----------|-----|---------|------|
| 01 | ... | PASS | PASS | |
| 02 | ... | FAIL | - | [details] |

UNTESTED:
- TC-XX: reason

FAIL details:
- TC-XX repro: ...
- Actual: ...
- Expected: ...
```

**If any FAIL exists, do not proceed to deploy. Return to Build window.**

---

## ShutTimer Default TC List

| TC | Scenario | Platform |
|----|----------|----------|
| TC-01 | App launch → main screen renders | Common |
| TC-02 | Mission selection (all 8) | Common |
| TC-03 | Start button → timer screen transition | Common |
| TC-04 | Countdown animation (sector shrinks) | Common |
| TC-05 | Pause / resume | Common |
| TC-06 | Cancel → return to main | Common |
| TC-07 | Timer end → alarm rings (foreground) | Common |
| TC-08 | Timer end → alarm rings (background) | iOS / Android each |
| TC-09 | Alarm screen → camera launch | Common |
| TC-10 | Camera capture → alarm end | Common |
| TC-11 | App relaunch → state restored | Common |

---

# Part 2: Deployment Stage (After full QA PASS)

## Deployment Procedure (7 Steps — No Skipping)

### Step 0: Prerequisite check

- Check item 8 "Deployment prerequisites" from the plan
- **If any are incomplete, deployment is strictly forbidden**

```
| Prerequisite | Status |
|--------------|--------|
```

### Step 1: User approval

- Report full QA PASS → proceed only after user "deploy" approval
- No deployment without approval

### Step 2: Commit only relevant files

- `git add` + `git commit` only the relevant files for this task
- Unrelated files MUST NOT be included
- Include the task ID in the commit message

### Step 3: Version tag

- `git tag v[X.Y.Z]`
- `git push origin v[X.Y.Z]`
- Bump `version`, `buildNumber` (iOS), `versionCode` (Android) in `app.json`

### Step 4: EAS Build

```bash
eas build --platform all
```

- Wait for build completion
- On build failure: stop immediately + report cause

### Step 5: Store submission

```bash
eas submit --platform ios
eas submit --platform android
```

- Confirm review status and report

### Step 6: Post-deploy verification + history update

After review pass:
- [ ] Download from App Store / Google Play directly
- [ ] Verify full core flow
- [ ] Verify both iOS and Android

```
Deploy history:
| Version | Date | Content | iOS | Android |
|---------|------|---------|-----|---------|
```

---

## Commit Message Convention

```
feat: new feature
fix: bug fix
refactor: code structure change (behavior unchanged)
style: UI change
docs: documentation
chore: config/build
```

---

## Rollback Procedure

- **During review:** cancel the submission via App Store Connect / Google Play console
- **After release:** ship an emergency patch version → resubmit immediately
- **Git basis:** `git revert [bad commit]` → Build window handles → redeploy

---

## Incident Response

### Severity

- **Critical:** app crash, alarm doesn't fire at all, camera unusable
- **High:** problem only on iOS or Android (not both)
- **Medium:** UI broken (feature still works)

### Procedure

```
Step 1: Assess (do not modify)
  - Time / severity / symptom / repro / affected platform / app version

Step 2: Suspect cause
  1. Expo log / Metro bundler errors
  2. iOS console (Xcode) / Android log (adb logcat)
  3. Recent deploy history
  4. expo-notifications / expo-camera permission state

Step 3: Decide response
  After-deploy occurrence? → YES → emergency patch first
  One-line fix solves it? → YES → prep hotfix build
  Otherwise → wait for user decision

Step 4: Verify after fix
  Even for urgent: deploy only after device PASS. "It's urgent, skip testing" is forbidden.

Step 5: Postmortem
  - Occurred / fixed time / severity / root cause / fix / prevention
```

---

## Forbidden

- Code modification (Build window's job)
- Deployment without user approval
- Deploying with QA FAIL outstanding
- Submitting to stores without device verification
- Including unrelated files in commits
- Bundling multiple tasks in one deploy
- "It's urgent" test skipping
- **반말 금지. 존댓말 mandatory. No exceptions.**

---

## Repeat-Mistake Check

| # | Mistake | Check |
|---|---------|-------|
| 1 | Marked unverified item as PASS | Was it verified directly on device |
| 2 | Verified iOS only, skipped Android | Both verified |
| 3 | Background alarm not verified | Alarm verified with app in background |
| 4 | Deployed despite FAIL | Full QA PASS confirmed |
| 5 | Deployed without user approval | Step 1 approval received |
| 6 | `app.json` version not bumped | `version` / `buildNumber` / `versionCode` bumped |
| 7 | Deploy history missed | Step 6 history updated |
| 8 | Prerequisites unchecked | Step 0 all items confirmed |
