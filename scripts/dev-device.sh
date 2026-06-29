#!/bin/bash
# ShutTimer 디버그 빌드를 실기기(테스트폰)에 설치·실행하는 통합 개발 명령어.
#   빌드는 Xcode(Cmd+B) 또는 eas build --local 에서 끝낸 뒤 실행. 본 스크립트는 빌드 안 함(설치·실행·Metro만).
#   사용: bash scripts/dev-device.sh            # 최신 빌드를 연결된 iPhone에 설치+실행
#        bash scripts/dev-device.sh --no-launch # 설치만
set -uo pipefail

METRO_PORT=8082
MAC_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "<맥IP>")
LAUNCH=1
[ "${1:-}" = "--no-launch" ] && LAUNCH=0

echo "── ShutTimer dev-device ──"

# 1) 연결된 iPhone 1대 자동 선택 (Taehwan 우선, 없으면 첫 connected)
DEVICE=$(xcrun devicectl list devices --json-output /tmp/_st_dev.json >/dev/null 2>&1 && python3 - <<'PY'
import json
d=json.load(open('/tmp/_st_dev.json'))
cands=[]
for x in d.get('result',{}).get('devices',[]):
    cp=x.get('connectionProperties',{}); hw=x.get('hardwareProperties',{}); dp=x.get('deviceProperties',{})
    if cp.get('tunnelState')=='connected' and 'iPhone' in (hw.get('marketingName') or ''):
        cands.append((dp.get('name',''), x.get('identifier','')))
cands.sort(key=lambda c: (0 if 'Taehwan' in c[0] else 1))
print(cands[0][1] if cands else '')
PY
)
if [ -z "$DEVICE" ]; then echo "✗ 연결된 iPhone 없음. USB/네트워크 연결 + 잠금 해제 확인."; exit 1; fi
echo "기기: $DEVICE"

# 2) 최신 Debug 빌드(.app) 자동 탐색
APP=$(ls -dt ~/Library/Developer/Xcode/DerivedData/ShutTimer-*/Build/Products/Debug-iphoneos/ShutTimer.app 2>/dev/null | head -1)
if [ -z "$APP" ]; then echo "✗ Debug-iphoneos/ShutTimer.app 없음. Xcode(Cmd+B) 또는 eas build --local 로 먼저 빌드."; exit 1; fi
echo "빌드: $APP"

# 3) 설치
echo "설치 중…"
xcrun devicectl device install app --device "$DEVICE" "$APP" || { echo "✗ 설치 실패"; exit 1; }

# 4) 실행
if [ "$LAUNCH" = "1" ]; then
  echo "실행 중…(폰 잠금 해제)"
  xcrun devicectl device process launch --device "$DEVICE" com.shuttimer.app >/dev/null 2>&1 || echo "  (실행 실패 — 폰 잠금/홈에서 직접 실행)"
fi

# 5) Metro 확인 + 접속 주소 안내
if curl -s --max-time 2 "http://localhost:$METRO_PORT/status" | grep -q "packager-status:running"; then
  echo "Metro: http://$MAC_IP:$METRO_PORT (running)"
else
  echo "Metro 미실행 → 별도 터미널: npx expo start --dev-client --port $METRO_PORT"
fi
echo "── 완료. 앱 개발메뉴에서 http://$MAC_IP:$METRO_PORT 로 접속 ──"
