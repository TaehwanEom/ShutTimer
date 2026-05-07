# Antigravity Common Rules — ShutTimer

**Last updated:** 2026-04-07
**This document applies to all windows (Plan / Build / QA / Deploy).**
**When opening any window, read: this document + the corresponding window's guide.**

---

## Project Overview

- **App name:** ShutTimer
- **Platforms:** iOS + Android
- **Stack:** Expo (React Native) + TypeScript
- **Server:** None (local only)
- **Login:** None
- **Storage:** AsyncStorage (local)
- **Spec doc:** `timer_app_spec.md`

---

## Tech Stack Detail

| Item | Library |
|------|---------|
| Framework | Expo (React Native) |
| Background timer | `expo-notifications` (local push scheduling) |
| Alarm | `expo-notifications` |
| Camera | `expo-camera` |
| Local storage | `@react-native-async-storage/async-storage` |
| Test | Expo Go (real device) |

---

## v1 Scope (Confirmed)

- Fixed 60-min timer
- Mission selection (8 types: TV, bath, reading, study, brushing, play, game, cooking)
- Timer run → alarm → photo capture → end
- No child/adult split, single app

## v2+ (Out of scope — do not touch now)

- Custom time setting (0–60 min)
- Mute / vibration option
- Pre-alert 5 minutes before end
- Custom alarm sound

---

## Screen Structure (3)

1. **Main screen** — mission selection + analog timer UI (60 min fixed) + start button
2. **Timer running screen** — countdown animation + remaining time + pause/cancel
3. **End mission screen** — alarm + camera capture → end

---

## 4 Layers

For every task, only touch the relevant layer. Do not touch unrelated layers.

1. **UI layer** — screen components, styles, animations
2. **Logic layer** — timer state, countdown, app state management
3. **Native API layer** — `expo-notifications`, `expo-camera`, AsyncStorage
4. **Config layer** — `app.json`, permissions, App Store metadata

---

## Workflow

```
[1. Plan window] Analyze + plan
    ↓
Approval
    ↓
[2. Build window] Code modification
    ↓
[3. QA window] Expo Go device testing
    ↓
PASS → [4. Deploy window] Build + store submission
FAIL → [2. Build window] Fix → [3] re-verify
```

---

## Forbidden Actions

- **Each window stays strictly within its role. Cross the line → stop immediately.**
  - Plan: no code modification / build / deployment
  - Build: no testing / deployment
  - QA: no code modification / deployment
  - Deploy: no code modification
- v2-scope features in v1 implementation forbidden
- **반말 금지. All windows must use 존댓말 to the user. No exceptions.**

(Note: rules on assumptions, scope creep, semantic commits, "code exists ≠ feature works", running tests before completion are unified under `CLAUDE.md` "Behavioral Guidelines".)

---

## False-Reporting Prevention (Enforced in All Windows)

| # | Rule | On violation |
|---|------|--------------|
| 1 | Completion report MUST include a 1:1 done/not-done table against the full handoff list. | Report rejected |
| 2 | **Do not push to next step while partially complete.** | Recorded as repeat mistake |
| 3 | **Hiding incompletes = false reporting.** | Recorded as repeat mistake |
| 4 | **Items not verified = mark as "unverified".** | Report rejected |
| 5 | **Code existence ≠ feature working.** PASS only after execution check. | Recorded as repeat mistake |

---

## Window Role Summary

| Window | Role | Forbidden |
|--------|------|-----------|
| 1. Plan | Analyze + plan | Code modification / execution |
| 2. Build | Code modification | Testing / deployment |
| 3. QA | Expo Go device testing | Code modification / deployment |
| 4. Deploy | Build + store submission | Code modification |
