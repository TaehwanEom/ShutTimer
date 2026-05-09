// 사운드 파일 측 ios Bundle Resources 등록 자체 plugin (= expo-notifications plugin 측 sounds logic 추출).
// v1.7 hotfix Phase 13 G4-Z-1 — expo-notifications 폐기 정합 + AlarmKit 측 사운드 read 측 잔존 부탁.

const { withXcodeProject, IOSConfig } = require('expo/config-plugins');
const { copyFileSync } = require('fs');
const { basename, resolve } = require('path');

const ERROR_MSG_PREFIX = 'An error occurred while configuring sound resources. ';

function setSoundResources(projectRoot, { sounds, project, projectName }) {
  if (!projectName) {
    throw new Error(ERROR_MSG_PREFIX + 'Unable to find iOS project name.');
  }
  if (!Array.isArray(sounds)) {
    throw new Error(
      ERROR_MSG_PREFIX +
        `Must provide an array of sound files in your app config, found ${typeof sounds}.`
    );
  }
  const sourceRoot = IOSConfig.Paths.getSourceRoot(projectRoot);
  let updatedProject = project;
  for (const soundFileRelativePath of sounds) {
    const fileName = basename(soundFileRelativePath);
    const sourceFilepath = resolve(projectRoot, soundFileRelativePath);
    const destinationFilepath = resolve(sourceRoot, fileName);
    copyFileSync(sourceFilepath, destinationFilepath);
    if (!updatedProject.hasFile(`${projectName}/${fileName}`)) {
      updatedProject = IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath: `${projectName}/${fileName}`,
        groupName: projectName,
        isBuildFile: true,
        project: updatedProject,
      });
    }
  }
  return updatedProject;
}

const withSoundResources = (config, { sounds = [] } = {}) => {
  return withXcodeProject(config, (config) => {
    setSoundResources(config.modRequest.projectRoot, {
      sounds,
      project: config.modResults,
      projectName: config.modRequest.projectName,
    });
    return config;
  });
};

module.exports = withSoundResources;
