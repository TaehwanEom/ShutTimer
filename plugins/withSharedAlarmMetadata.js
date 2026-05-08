// v1.7 hotfix #LAUnify Phase 9-B — ShutTimerAlarmMetadata.swift 측 main app target file membership 추가
//
// 배경: AlarmKit framework 자동 LA Activity 측 = `Activity<AlarmAttributes<ShutTimerAlarmMetadata>>` 사용.
//   - main app target 측 = `AlarmManager.shared.schedule(...)` 호출 → Activity 시작
//   - widget extension target 측 = `ActivityConfiguration(for: AlarmAttributes<ShutTimerAlarmMetadata>.self)` 등록
//
// 직전: ShutTimerAlarmMetadata struct 측 두 target 측 별도 file 측 별도 정의 → Swift module 측 별도 type identity
//   → AlarmKit framework type lookup mismatch → widget body 호출 ❌ + system fallback UI ("검정 바").
//
// 정정: `targets/widget/ShutTimerAlarmMetadata.swift` 측 단일 file 측 두 target file membership share.
//   widget extension target 측 = @bacons/apple-targets 측 자동 등록 (= `targets/widget/` 디렉토리).
//   main app target 측 = 본 plugin 측 PBXBuildFile entry 추가 + Sources build phase 측 추가.
//
// Apple 공식 sample (= "SchedulingAnAlarmWithAlarmKit") 측 표준 패턴 정합.

const { withXcodeProject } = require('@expo/config-plugins');

const SHARED_FILE_NAME = 'ShutTimerAlarmMetadata.swift';
const MAIN_APP_TARGET_NAME = 'ShutTimer';

const withSharedAlarmMetadata = (config) => {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;

    // 1) Main app target UUID 검색
    const targets = project.pbxNativeTargetSection();
    let mainAppTargetUuid;
    for (const uuid in targets) {
      const target = targets[uuid];
      if (typeof target !== 'object' || !target?.name) continue;
      const name = target.name.replace(/['"]/g, '');
      if (name === MAIN_APP_TARGET_NAME) {
        mainAppTargetUuid = uuid;
        break;
      }
    }

    if (!mainAppTargetUuid) {
      console.warn(`[withSharedAlarmMetadata] main app target ${MAIN_APP_TARGET_NAME} not found — skip`);
      return config;
    }

    // 2) ShutTimerAlarmMetadata.swift PBXFileReference 검색 (= widget extension target 측 등록 영역)
    const fileReferences = project.pbxFileReferenceSection();
    let fileRefUuid;
    for (const uuid in fileReferences) {
      const ref = fileReferences[uuid];
      if (typeof ref !== 'object' || !ref?.path) continue;
      const refPath = ref.path.replace(/['"]/g, '');
      if (refPath.endsWith(SHARED_FILE_NAME)) {
        fileRefUuid = uuid;
        break;
      }
    }

    if (!fileRefUuid) {
      console.warn(`[withSharedAlarmMetadata] ${SHARED_FILE_NAME} PBXFileReference not found — skip (= prebuild widget target 측 자동 등록 측 검증 필요)`);
      return config;
    }

    // 3) main app target Sources build phase 측 = 본 file 측 등록 영역 idempotent check
    const buildFileSection = project.pbxBuildFileSection();
    const sourcesBuildPhase = project.pbxSourcesBuildPhaseObj(mainAppTargetUuid);

    if (!sourcesBuildPhase?.files) {
      console.warn('[withSharedAlarmMetadata] main app target Sources build phase 측 files 부재 — skip');
      return config;
    }

    let alreadyAdded = false;
    for (const fileEntry of sourcesBuildPhase.files) {
      const buildFile = buildFileSection[fileEntry.value];
      if (buildFile && typeof buildFile === 'object' && buildFile.fileRef === fileRefUuid) {
        alreadyAdded = true;
        break;
      }
    }

    if (alreadyAdded) {
      console.log(`[withSharedAlarmMetadata] ${SHARED_FILE_NAME} 측 main app target 측 이미 등록 — skip`);
      return config;
    }

    // 4) PBXBuildFile entry 신규 + Sources build phase 측 push
    const newBuildFileUuid = project.generateUuid();
    buildFileSection[newBuildFileUuid] = {
      isa: 'PBXBuildFile',
      fileRef: fileRefUuid,
      fileRef_comment: SHARED_FILE_NAME,
    };
    buildFileSection[newBuildFileUuid + '_comment'] = `${SHARED_FILE_NAME} in Sources`;

    sourcesBuildPhase.files.push({
      value: newBuildFileUuid,
      comment: `${SHARED_FILE_NAME} in Sources`,
    });

    console.log(`[withSharedAlarmMetadata] ${SHARED_FILE_NAME} 측 main app target file membership 추가 OK`);
    return config;
  });
};

module.exports = withSharedAlarmMetadata;
