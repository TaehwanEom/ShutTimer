// v1.6 Phase 10 — Widget Extension target 의 App Intents Metadata Processing 명시 보장.
// 가설: ENABLE_APP_INTENTS_METADATA_PROCESSING = default YES 단 default 누락 시 Intent metadata 미등록 → LA Button 무반응.
// fix: Widget target build setting 명시 + Sources build phase 검증.
//
// 효과 미보장 (default YES 면 redundant). 본 창 D-1 영역.

const { withXcodeProject } = require('@expo/config-plugins');

const withWidgetAppIntentsMetadata = (config) => {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;

    // Widget target 찾기
    const targets = project.pbxNativeTargetSection();
    let widgetTargetUuid;
    for (const uuid in targets) {
      const target = targets[uuid];
      if (typeof target !== 'object' || !target?.name) continue;
      if (target.name === 'widget' || target.name === '"widget"') {
        widgetTargetUuid = uuid;
        break;
      }
    }

    if (!widgetTargetUuid) {
      console.warn('[withWidgetAppIntentsMetadata] widget target not found — skip');
      return config;
    }

    // build configuration list 의 모든 configuration 에 ENABLE_APP_INTENTS_METADATA_PROCESSING = YES 명시
    const configListUuid = targets[widgetTargetUuid].buildConfigurationList;
    const configurations = project.pbxXCBuildConfigurationSection();
    const configList = project.pbxXCConfigurationList()[configListUuid];

    if (!configList?.buildConfigurations) {
      console.warn('[withWidgetAppIntentsMetadata] widget configurationList not found — skip');
      return config;
    }

    for (const configRef of configList.buildConfigurations) {
      const buildConfig = configurations[configRef.value];
      if (buildConfig && typeof buildConfig === 'object' && buildConfig.buildSettings) {
        buildConfig.buildSettings.ENABLE_APP_INTENTS_METADATA_PROCESSING = 'YES';
      }
    }

    console.log('[withWidgetAppIntentsMetadata] ENABLE_APP_INTENTS_METADATA_PROCESSING=YES applied to widget target');
    return config;
  });
};

module.exports = withWidgetAppIntentsMetadata;
