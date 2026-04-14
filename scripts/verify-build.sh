#!/bin/bash
# ShutTimer 빌드 전 검증 스크립트
# 네이티브 설정(Info.plist, Pods)과 JS 설정(package.json, app.json)의 일관성 검증
# 전부 PASS → exit 0, 1건이라도 FAIL → exit 1

set +e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

INFO_PLIST="ios/ShutTimer/Info.plist"
APP_JSON="app.json"
PKG_JSON="package.json"
PODFILE_LOCK="ios/Podfile.lock"

FAIL=0
SUMMARY=()
BLOCKERS=()

echo "[verify-build]"

# ─────────────────────────────────────────────────────────────
# 1. Info.plist 필수 키 (iOS)
# ─────────────────────────────────────────────────────────────
REQUIRED_KEYS=(
  "NSUserTrackingUsageDescription"
  "GADApplicationIdentifier"
  "NSCameraUsageDescription"
  "ITSAppUsesNonExemptEncryption"
  "SKAdNetworkItems"
)

if [ ! -f "$INFO_PLIST" ]; then
  SUMMARY+=("❌ Info.plist file not found: $INFO_PLIST")
  BLOCKERS+=("Info.plist missing — run prebuild")
  FAIL=1
else
  PLIST_MISSING=()
  for key in "${REQUIRED_KEYS[@]}"; do
    if ! grep -q "<key>$key</key>" "$INFO_PLIST"; then
      PLIST_MISSING+=("$key")
    fi
  done

  SKA_COUNT=$(grep -c "SKAdNetworkIdentifier" "$INFO_PLIST" 2>/dev/null || echo 0)
  SKA_OK=1
  if [ "$SKA_COUNT" -lt 44 ]; then
    SKA_OK=0
  fi

  if [ ${#PLIST_MISSING[@]} -eq 0 ] && [ "$SKA_OK" -eq 1 ]; then
    SUMMARY+=("✅ Info.plist ${#REQUIRED_KEYS[@]}/${#REQUIRED_KEYS[@]} keys present (SKAdNetworkIdentifier count=$SKA_COUNT)")
  else
    for k in "${PLIST_MISSING[@]}"; do
      SUMMARY+=("❌ Info.plist missing: $k")
      BLOCKERS+=("Info.plist missing $k")
    done
    if [ "$SKA_OK" -eq 0 ]; then
      SUMMARY+=("❌ SKAdNetworkItems count=$SKA_COUNT (expected ≥44)")
      BLOCKERS+=("SKAdNetworkItems too few ($SKA_COUNT)")
    fi
    FAIL=1
  fi
fi

# ─────────────────────────────────────────────────────────────
# 2. Pods 필수 모듈 (iOS)
# ─────────────────────────────────────────────────────────────
REQUIRED_PODS=("RNGoogleMobileAds" "RNPurchases" "ExpoTrackingTransparency")

if [ ! -d "ios/Pods" ]; then
  SUMMARY+=("❌ ios/Pods directory missing — run prebuild / pod install")
  BLOCKERS+=("Pods directory missing")
  FAIL=1
else
  POD_MISSING=()
  for pod in "${REQUIRED_PODS[@]}"; do
    if ! ls -d ios/Pods/${pod}* >/dev/null 2>&1; then
      POD_MISSING+=("$pod")
    fi
  done

  if [ ${#POD_MISSING[@]} -eq 0 ]; then
    SUMMARY+=("✅ Pods ${#REQUIRED_PODS[@]}/${#REQUIRED_PODS[@]} modules installed")
  else
    for p in "${POD_MISSING[@]}"; do
      SUMMARY+=("❌ Pods missing: $p")
      BLOCKERS+=("Pod $p not installed")
    done
    FAIL=1
  fi
fi

# ─────────────────────────────────────────────────────────────
# 3. Podfile.lock 의존성 참조 + EXConstants 버전 일치
# ─────────────────────────────────────────────────────────────
if [ ! -f "$PODFILE_LOCK" ]; then
  SUMMARY+=("❌ Podfile.lock not found")
  BLOCKERS+=("Podfile.lock missing")
  FAIL=1
else
  LOCK_MISSING=()
  for pod in "${REQUIRED_PODS[@]}"; do
    if ! grep -qE "^  - $pod" "$PODFILE_LOCK"; then
      LOCK_MISSING+=("$pod")
    fi
  done

  # EXConstants 버전 비교
  JS_EXCONST=$(node -p "try{require('./node_modules/expo-constants/package.json').version}catch(e){'N/A'}" 2>/dev/null)
  POD_EXCONST=$(grep -E "^  - EXConstants \(" "$PODFILE_LOCK" | head -1 | sed -E 's/.*\(([^)]+)\).*/\1/')

  VERSION_OK=1
  if [ "$JS_EXCONST" != "$POD_EXCONST" ]; then
    VERSION_OK=0
  fi

  if [ ${#LOCK_MISSING[@]} -eq 0 ] && [ "$VERSION_OK" -eq 1 ]; then
    SUMMARY+=("✅ Podfile.lock dependencies match (EXConstants $POD_EXCONST)")
  else
    for p in "${LOCK_MISSING[@]}"; do
      SUMMARY+=("❌ Podfile.lock missing dependency: $p")
      BLOCKERS+=("Podfile.lock missing $p")
    done
    if [ "$VERSION_OK" -eq 0 ]; then
      SUMMARY+=("❌ EXConstants version mismatch: package.json=$JS_EXCONST, Podfile.lock=$POD_EXCONST")
      BLOCKERS+=("EXConstants version mismatch")
    fi
    FAIL=1
  fi
fi

# ─────────────────────────────────────────────────────────────
# 4. package.json ↔ app.json plugin 일치성
# ─────────────────────────────────────────────────────────────
CHECK_PAIRS=(
  "react-native-google-mobile-ads"
  "expo-tracking-transparency"
)

SYNC_MISSING=()
for name in "${CHECK_PAIRS[@]}"; do
  IN_PKG=$(node -p "try{!!require('./$PKG_JSON').dependencies['$name']}catch(e){false}" 2>/dev/null)
  IN_APP=$(node -p "try{JSON.stringify(require('./$APP_JSON').expo.plugins).indexOf('$name')>=0}catch(e){false}" 2>/dev/null)

  if [ "$IN_PKG" != "true" ]; then
    SYNC_MISSING+=("package.json missing: $name")
  fi
  if [ "$IN_APP" != "true" ]; then
    SYNC_MISSING+=("app.json plugin missing: $name")
  fi
done

if [ ${#SYNC_MISSING[@]} -eq 0 ]; then
  SUMMARY+=("✅ package.json ↔ app.json sync")
else
  for s in "${SYNC_MISSING[@]}"; do
    SUMMARY+=("❌ $s")
    BLOCKERS+=("$s")
  done
  FAIL=1
fi

# ─────────────────────────────────────────────────────────────
# 5. CFBundleVersion ↔ app.json buildNumber 일치
# ─────────────────────────────────────────────────────────────
APP_BN=$(node -p "try{require('./$APP_JSON').expo.ios.buildNumber}catch(e){'N/A'}" 2>/dev/null)
PLIST_BN=""
if [ -f "$INFO_PLIST" ]; then
  PLIST_BN=$(awk '/<key>CFBundleVersion<\/key>/{getline; gsub(/.*<string>|<\/string>.*/,""); print; exit}' "$INFO_PLIST")
fi

if [ -z "$PLIST_BN" ]; then
  SUMMARY+=("❌ CFBundleVersion not readable (Info.plist missing?)")
  BLOCKERS+=("CFBundleVersion unreadable")
  FAIL=1
elif [ "$APP_BN" = "$PLIST_BN" ]; then
  SUMMARY+=("✅ CFBundleVersion match ($APP_BN)")
else
  SUMMARY+=("⚠️ CFBundleVersion mismatch: Info.plist=$PLIST_BN, app.json=$APP_BN")
  BLOCKERS+=("CFBundleVersion mismatch")
  FAIL=1
fi

# ─────────────────────────────────────────────────────────────
# 출력
# ─────────────────────────────────────────────────────────────
echo ""
for line in "${SUMMARY[@]}"; do
  echo "$line"
done
echo ""

if [ $FAIL -eq 0 ]; then
  echo "ALL CHECKS PASSED. Build can proceed."
  exit 0
else
  echo "BUILD BLOCKED. Run: npx expo prebuild --platform ios --clean"
  echo ""
  echo "Blockers:"
  for b in "${BLOCKERS[@]}"; do
    echo "  - $b"
  done
  exit 1
fi
