# Antigravity Build Window Rules — ShutTimer

**Common rules:** see `antigravity_0_common.md`
**Role:** Implement only approved plans. Testing/deployment strictly forbidden.

---

## Self-Check Before Modifying Code (Every Edit)

- [ ] Am I modifying only what was requested? Not touching adjacent code?
- [ ] Did I find the actual root cause? Not a guess-fix?
- [ ] Was this approved? Or was it just "report only"?
- [ ] Did I cover every related screen/component? Any missed file?
- [ ] If this is a sweep, is it actually exhaustive? Anything missed?
- [ ] Am I asking the user unnecessary questions / making excuses?
- [ ] Am I trying to add v1-out-of-scope features?

---

## External Package / Native Dependency Rules [Critical]

**Background:** repeated build failures (v1.5 spike, 2026-04-17):
- `react-native-fast-tflite` v3 API guess implementation → crash
- `react-native-worklets-core` babel plugin requirement missed → build failure
- `react-native-fast-tflite` CoreML delegate Expo config plugin requirement missed → runtime failure
- `vision-camera-resize-plugin` official `buffer.slice()` pattern not followed → potential bug

**Rules (no exceptions):**

1. **Using a public package's API → MUST verify against its official README/docs first**
   - Read `node_modules/{package}/README.md` directly
   - Mirror official examples literally (no guess-based variants)

2. **No guess-based code**
   - Don't write code from `.d.ts` typings alone
   - Verify with actual usage examples

3. **Adding a native dependency → check Expo config plugin requirements**
   - Confirm whether anything beyond `npm install` is needed
   - Check whether registration in `app.json` `plugins` is needed
   - Special features (CoreML / GPU delegate) may require extra setup

4. **Build-related setup (Podfile, babel, etc.) → read the entire official install guide**
   - Read README's "Installation" section to the end
   - Check `babel.config.js` plugin requirements
   - Check Podfile custom variables (e.g., `$EnableCoreMLDelegate`)

**Violation cost:** build failure → rebuild → debug loop = wasted user time.

**Critical:** violating this rule equals violating the "no guess-based modification" rule. On repeat violation, stop work immediately.

---

## Mandatory Workflow (5 Steps — No Skipping)

### Step 1: Impact analysis

When you receive a handoff, do not start coding. Instead:

1. **Read the current code** of the target file/component
2. grep callers
3. Inspect callees
4. State/context change → list affected components
5. Native API change → confirm permission setup (`app.json`) and iOS/Android behavior differences
6. Alarm-related → confirm behavior across foreground/background/killed

### Step 2: Impact report (mandatory before code modification)

No coding before this report. Wait for user approval.

```
[Impact analysis]
Target: file + component/function
Callers: list
Callees: list
State propagation: components affected by state/context changes
Affected existing features: concrete list
iOS/Android divergence: yes/no (if yes, describe)
Risks: things that could break due to propagation

[Native API additions]
app.json permission changes needed:
App-state (foreground/background/killed) behavior differences:

→ Proceed to Step 3 after user approval
```

### Step 3: Code modification

- Only the approved scope, one change at a time
- v1-out-of-scope features strictly forbidden

### Step 4: Self-verification

- [ ] Modified feature works in Expo Go (direct check)
- [ ] Step 2 impact list verified 1:1
- [ ] ShutTimer core flow verified: mission select → start → countdown → alarm → photo → end
- [ ] iOS / Android both verified (or "no divergence" stated explicitly)
- [ ] 0 console errors
- [ ] Handoff file list vs actually modified files: 1:1 reconciled

If anything breaks, do not report complete. Find the cause and fix first.

### Step 5: Completion report

```
[Task] Implementation complete

Modified files:
| File | Change |
|------|--------|

Files not modified: (per handoff)

Handoff reconciliation:
| Handoff file | diff exists | note |
|--------------|-------------|------|

Self-verification:
| Item | Result |
|------|--------|
| Modified feature works | OK / FAIL |
| Impact (Step 2 list) | OK / FAIL |
| Core flow (mission → timer → alarm → camera → end) | OK / FAIL |
| iOS check | OK / FAIL / Unverified |
| Android check | OK / FAIL / Unverified |
| Console errors | 0 / N |

Uncommitted changes: Y/N
```

After completion, output a QA-window handoff:

```
[QA window handoff]
Task: [task ID]
Modified files: [files + change summary]
Verification: [Expo Go test items]
iOS/Android each required: [Y/N]
```

---

## QA Feedback Response

1. Read the full FAIL list first — don't start fixing from a partial view
2. Group items by shared root cause — fix root cause once
3. After fixes, re-run Step 4 across the full FAIL list
4. Additional impact check — make sure fixes don't break adjacent features

---

## Requirement Understanding

- If ambiguous, confirm with the user. No arbitrary interpretation.
- Restate requirements in your own words → confirm with user → implement

---

## Repeat-Mistake Check

| # | Mistake | Check |
|---|---------|-------|
| 1 | Missed related file | Did grep find every related component/screen |
| 2 | iOS/Android divergence missed | Both checked (or "no divergence" stated) |
| 3 | App-state behavior missed | For alarm-related, foreground/background/killed checked |
| 4 | Permission missed | Camera/alarm permissions added to `app.json` |
| 5 | False completion report | Handoff items vs actual modifications 1:1 reconciled |
| 6 | Fix introduced new bug | Impact area verified in Expo Go |
| 7 | Arbitrary interpretation | Ambiguities confirmed with user before coding |
| 8 | v2 feature in v1 | Implementation strictly within v1 scope |
