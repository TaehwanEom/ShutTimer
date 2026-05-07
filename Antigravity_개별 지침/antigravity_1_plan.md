# Antigravity Plan Window Rules — ShutTimer

**Common rules:** see `antigravity_0_common.md`
**Role:** Analyze + draft plan only. Code modification strictly forbidden.

---

## Mandatory Workflow (6 Steps — No Skipping)

### Step 1: Receive task + identify layer
- Identify which of the 4 layers applies (UI / Logic / Native API / Config)

### Step 2: Deep-read the target code
- Use grep to identify related files/components — **no relying on memory; grep mandatory**
- **Read the current code directly** (Read) for the target component/function
- Inspect props / state / hook dependencies of that component
- Native API change: **check permission setup (`app.json`) and platform-specific behavior**
- State management change: **check propagation across related components**

### Step 3: Impact + conflict analysis
- List existing features that could break, concretely
- Trace propagation across component → state → native API layers
- Determine whether iOS / Android behavior diverges
- For `expo-notifications`-related: check behavior across foreground / background / killed

### Step 4: v1 scope check
- State whether each requested feature is v1 or v2 scope
- If v2 scope is included: **exclude immediately and report**

### Step 5: Output the plan (8-section format)

### Step 6: Output the Build window handoff

**Core: shallow Step 2–3 will explode in the Build window. Do not just grep without reading; read the actual code and understand the behavior before writing the plan.**

---

## Pre-Modify Checklist

The plan MUST include all items below:

- [ ] Target file list confirmed (grep-based, explicit enumeration)
- [ ] Declaration that out-of-scope files will not be touched
- [ ] Impact analysis showing currently working features will not break
- [ ] v1 / v2 scope boundary check
- [ ] Among 4 layers, only the relevant one is touched (declared explicitly)

---

## Plan Output Format (Required)

```
[Task name] Plan

1. Target files:
   - filename | reason for modification (grep-based)

2. Files NOT modified:
   - explicit declaration

3. Layer:
   - One of UI / Logic / Native API / Config

4. Modification details:
   - Per-file behavioral specification (spec/behavior only — NO code).

5. Impact range:
   - Affected screens / components / state
   - iOS / Android behavior differences
   - App-state (foreground / background / killed) impact (if alarm-related)

6. Verification:
   - Expo Go device test items
   - Whether iOS / Android each need to be checked

7. Notes:
   - v1 / v2 scope boundary outcome
   - Platform-specific notes (iOS permissions, Android alarm policy, etc.)
   - Backward compatibility for AsyncStorage data structure changes

8. Deployment prerequisites (if any):
   - `app.json` permission setup, EAS Build config, etc.
   - "None" if not applicable. If any, the Deploy window enforces them as a checklist.
```

---

## Repeat-Mistake Check (Mandatory at Plan Time)

| # | Mistake | Plan-time check |
|---|---------|-----------------|
| 1 | v2 feature in v1 | Confirm requested feature is v1 |
| 2 | Missing related files | Did grep find every related component/hook |
| 3 | iOS/Android divergence missed | Is platform behavior analysis included |
| 4 | Permission setup missed | Are camera/alarm permissions checked in `app.json` |
| 5 | App-state behavior missed | Are foreground/background/killed alarm behaviors verified |
| 6 | Layer overreach | Only the relevant layer is touched |

---

## Forbidden

- Code modification during planning
- **Build/deployment execution from the Plan window — strictly forbidden. Plans only.**
- **No code in handoffs. Spec/behavior only — code is written by the Build window.**
- Submitting a plan without impact analysis
- Skipping the repeat-mistake list
- Submitting a plan without verification steps
- File lists from memory rather than grep
- Touching unrelated layers
- **반말 금지. 존댓말 mandatory. No exceptions.**

---

## Build Window Handoff (Required on Completion)

```
[Build window handoff]
Task: [task ID + name]
Target files: [filename + component/function to modify]
Files not modified: [explicit declaration]
Layer: [UI / Logic / Native API / Config]
Notes: [key cautions]
Verification: [Expo Go test items]
Deployment prerequisites: ["None" if not applicable]
```
