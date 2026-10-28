// Adds hyPer's widget extension to the iOS project on prebuild: the workout and
// run Live Activities and the Fuel and Training widgets.
//
// - Copies native/targets/widgets, the shared definitions (the cards' data, the
//   run card's lock-screen intent, the widgets' snapshot store) and the P's
//   font into ios/HyperWidgets.
// - Registers the HyperWidgets target (Xcode's app-extension layout: sources,
//   frameworks and resources phases, Debug and Release settings), embeds it in
//   the app and makes the app depend on it. It shares the app's App Group, so
//   the widgets can read what the app writes.
// - Compiles the run card's data and intent into the app too: iOS runs a Live
//   Activity's button intent in the app's process.
// - Marks the app as supporting Live Activities.
//
// The extension is plain SwiftUI with no pods. Prebuild with --clean after
// adding or removing files under targets/widgets: an existing target is kept.
const fs = require('fs');
const path = require('path');
const { IOSConfig, withDangerousMod, withInfoPlist, withXcodeProject } = require('expo/config-plugins');

const TARGET = 'HyperWidgets';
/** The extension's own files, relative to native/. */
const SOURCE_DIR = 'targets/widgets';
const SHARED_FILES = [
  // One definition of each card's data for the app and the extension.
  'modules/hyper-activity/ios/WorkoutActivityAttributes.swift',
  'modules/hyper-run/ios/RunActivityAttributes.swift',
  // The run card's Split, Rest and Finish buttons.
  'modules/hyper-run/shared/RunControlIntent.swift',
  // Where the app leaves the widgets' data.
  'modules/hyper-widget-data/ios/WidgetSnapshotStore.swift',
  // The P's face, for the brand mark on the cards and widgets.
  'assets/fonts/FrauncesMark-MediumItalic.ttf',
];
/** Compiled into the app as well: iOS performs a Live Activity intent in the app. */
const APP_FILES = ['modules/hyper-run/ios/RunActivityAttributes.swift', 'modules/hyper-run/shared/RunControlIntent.swift'];
const APP_GROUPS_KEY = 'com.apple.security.application-groups';
const ENTITLEMENTS = `${TARGET}.entitlements`;
const EMBED_PHASE = 'Embed Foundation Extensions';
const FILE_TYPES = { '.swift': 'sourcecode.swift', '.plist': 'text.plist.xml', '.ttf': 'file' };

const quote = (value) => `"${value}"`;
const unquote = (value) => (typeof value === 'string' ? value.replace(/^"(.*)"$/, '$1') : value);

function sourceFiles(projectRoot) {
  const own = fs
    .readdirSync(path.join(projectRoot, SOURCE_DIR))
    .filter((name) => !name.startsWith('.'))
    .map((name) => path.join(projectRoot, SOURCE_DIR, name));
  const shared = SHARED_FILES.map((file) => path.join(projectRoot, file));
  return [...own, ...shared].sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

const withLiveActivities = (config) =>
  withInfoPlist(config, (config) => {
    config.modResults.NSSupportsLiveActivities = true;
    return config;
  });

/** The App Groups the app is entitled to (app.json); the extension gets the same. */
const appGroups = (config) => config.ios?.entitlements?.[APP_GROUPS_KEY] ?? [];

function entitlementsPlist(groups) {
  const items = groups.map((group) => `\t\t<string>${group}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>${APP_GROUPS_KEY}</key>
\t<array>
${items}
\t</array>
</dict>
</plist>
`;
}

const withWidgetFiles = (config) =>
  withDangerousMod(config, [
    'ios',
    async (config) => {
      const { projectRoot, platformProjectRoot } = config.modRequest;
      const targetDir = path.join(platformProjectRoot, TARGET);
      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.mkdirSync(targetDir, { recursive: true });
      for (const file of sourceFiles(projectRoot)) {
        fs.copyFileSync(file, path.join(targetDir, path.basename(file)));
      }
      fs.writeFileSync(path.join(targetDir, ENTITLEMENTS), entitlementsPlist(appGroups(config)));

      const appDir = path.join(platformProjectRoot, IOSConfig.XcodeUtils.getProjectName(projectRoot));
      for (const file of APP_FILES) {
        fs.copyFileSync(path.join(projectRoot, file), path.join(appDir, path.basename(file)));
      }
      return config;
    },
  ]);

const withAppFiles = (config) =>
  withXcodeProject(config, (config) => {
    const project = config.modResults;
    const projectName = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
    for (const file of APP_FILES) {
      const filepath = `${projectName}/${path.basename(file)}`;
      if (!project.hasFile(filepath)) {
        IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath, groupName: projectName, project });
      }
    }
    return config;
  });

/** A build setting of the app target, else the project's. */
function appSetting(project, key) {
  const configs = project.pbxXCBuildConfigurationSection();
  const lists = project.pbxXCConfigurationList();
  const { firstTarget } = project.getFirstTarget();
  const { firstProject } = project.getFirstProject();
  for (const listUuid of [firstTarget.buildConfigurationList, firstProject.buildConfigurationList]) {
    for (const { value } of lists[listUuid]?.buildConfigurations ?? []) {
      const setting = configs[value]?.buildSettings?.[key];
      if (setting !== undefined) return unquote(setting);
    }
  }
  return undefined;
}

function addPhase(project, isa, name, files, extra = {}) {
  const objects = project.hash.project.objects;
  objects[isa] = objects[isa] ?? {};
  const uuid = project.generateUuid();
  objects[isa][uuid] = { isa, buildActionMask: 2147483647, files, runOnlyForDeploymentPostprocessing: 0, ...extra };
  objects[isa][`${uuid}_comment`] = name;
  return { value: uuid, comment: name };
}

function addBuildFile(project, fileRef, name, phase, extra = {}) {
  const uuid = project.generateUuid();
  const comment = `${name} in ${phase}`;
  project.pbxBuildFileSection()[uuid] = { isa: 'PBXBuildFile', fileRef, fileRef_comment: name, ...extra };
  project.pbxBuildFileSection()[`${uuid}_comment`] = comment;
  return { value: uuid, comment };
}

function addFileReference(project, name, fields) {
  const uuid = project.generateUuid();
  project.pbxFileReferenceSection()[uuid] = { isa: 'PBXFileReference', ...fields };
  project.pbxFileReferenceSection()[`${uuid}_comment`] = name;
  return uuid;
}

const withWidgetTarget = (config) =>
  withXcodeProject(config, (config) => {
    const project = config.modResults;
    if (project.pbxTargetByName(TARGET)) return config;

    const objects = project.hash.project.objects;
    const { firstProject } = project.getFirstProject();
    const appTargetUuid = project.getFirstTarget().uuid;
    const files = sourceFiles(config.modRequest.projectRoot).map((file) => path.basename(file));

    // Files, grouped under HyperWidgets, with their sources and resources.
    const children = [];
    const sources = [];
    const resources = [];
    for (const name of files) {
      const fileRef = addFileReference(project, name, {
        lastKnownFileType: FILE_TYPES[path.extname(name)] ?? 'file',
        path: quote(name),
        sourceTree: quote('<group>'),
      });
      children.push({ value: fileRef, comment: name });
      if (name.endsWith('.swift')) sources.push(addBuildFile(project, fileRef, name, 'Sources'));
      else if (!name.endsWith('.plist')) resources.push(addBuildFile(project, fileRef, name, 'Resources'));
    }
    const groupUuid = project.generateUuid();
    objects.PBXGroup[groupUuid] = { isa: 'PBXGroup', children, path: TARGET, sourceTree: quote('<group>') };
    objects.PBXGroup[`${groupUuid}_comment`] = TARGET;
    objects.PBXGroup[firstProject.mainGroup].children.push({ value: groupUuid, comment: TARGET });

    // The product, listed under Products.
    const product = `${TARGET}.appex`;
    const productRef = addFileReference(project, product, {
      explicitFileType: quote('wrapper.app-extension'),
      includeInIndex: 0,
      path: quote(product),
      sourceTree: 'BUILT_PRODUCTS_DIR',
    });
    objects.PBXGroup[firstProject.productRefGroup].children.push({ value: productRef, comment: product });

    // Build settings: versions, team and deployment target follow the app. iOS
    // wants an extension's versions to match its app's Info.plist, which Expo
    // writes from the app config.
    const team = appSetting(project, 'DEVELOPMENT_TEAM') ?? config.ios?.appleTeamId;
    const shared = {
      APPLICATION_EXTENSION_API_ONLY: 'YES',
      CLANG_ENABLE_MODULES: 'YES',
      CODE_SIGN_STYLE: 'Automatic',
      CURRENT_PROJECT_VERSION: quote(config.ios?.buildNumber ?? '1'),
      ...(team ? { DEVELOPMENT_TEAM: team } : {}),
      ...(appGroups(config).length > 0 ? { CODE_SIGN_ENTITLEMENTS: `${TARGET}/${ENTITLEMENTS}` } : {}),
      GENERATE_INFOPLIST_FILE: 'YES',
      INFOPLIST_FILE: `${TARGET}/Info.plist`,
      INFOPLIST_KEY_CFBundleDisplayName: quote(config.ios?.infoPlist?.CFBundleDisplayName ?? config.name ?? 'hyPer'),
      INFOPLIST_KEY_NSHumanReadableCopyright: quote(''),
      IPHONEOS_DEPLOYMENT_TARGET: appSetting(project, 'IPHONEOS_DEPLOYMENT_TARGET') ?? '16.4',
      LD_RUNPATH_SEARCH_PATHS: quote('$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks'),
      MARKETING_VERSION: quote(config.ios?.version ?? config.version ?? '1.0'),
      // The released app keeps the Capacitor extension's registered ID (app.config.js).
      PRODUCT_BUNDLE_IDENTIFIER: config.extra?.widgetBundleIdentifier ?? `${config.ios.bundleIdentifier}.widgets`,
      PRODUCT_NAME: quote('$(TARGET_NAME)'),
      SKIP_INSTALL: 'YES',
      SWIFT_EMIT_LOC_STRINGS: 'YES',
      SWIFT_VERSION: '5.0',
      TARGETED_DEVICE_FAMILY: '1',
    };
    const perConfiguration = {
      Debug: { DEBUG_INFORMATION_FORMAT: 'dwarf', SWIFT_OPTIMIZATION_LEVEL: quote('-Onone') },
      Release: { DEBUG_INFORMATION_FORMAT: quote('dwarf-with-dsym'), SWIFT_COMPILATION_MODE: 'wholemodule', SWIFT_OPTIMIZATION_LEVEL: quote('-O') },
    };
    const listComment = `Build configuration list for PBXNativeTarget "${TARGET}"`;
    const configurationList = project.addXCConfigurationList(
      ['Debug', 'Release'].map((name) => ({
        isa: 'XCBuildConfiguration',
        name,
        buildSettings: { ...shared, ...perConfiguration[name] },
      })),
      'Release',
      listComment,
    );

    // The target itself.
    const targetUuid = project.generateUuid();
    const nativeTarget = {
      isa: 'PBXNativeTarget',
      buildConfigurationList: configurationList.uuid,
      buildConfigurationList_comment: listComment,
      buildPhases: [
        addPhase(project, 'PBXSourcesBuildPhase', 'Sources', sources),
        addPhase(project, 'PBXFrameworksBuildPhase', 'Frameworks', []),
        addPhase(project, 'PBXResourcesBuildPhase', 'Resources', resources),
      ],
      buildRules: [],
      dependencies: [],
      name: TARGET,
      productName: TARGET,
      productReference: productRef,
      productReference_comment: product,
      productType: quote('com.apple.product-type.app-extension'),
    };
    project.addToPbxNativeTargetSection({ uuid: targetUuid, pbxNativeTarget: nativeTarget });
    project.addToPbxProjectSection({ uuid: targetUuid, pbxNativeTarget: nativeTarget });
    firstProject.attributes.TargetAttributes = firstProject.attributes.TargetAttributes ?? {};
    firstProject.attributes.TargetAttributes[targetUuid] = { CreatedOnToolsVersion: '26.0' };

    // Embedded in the app, right after its resources (before the script phases,
    // which Xcode otherwise reports as a dependency cycle).
    const embedded = addBuildFile(project, productRef, product, EMBED_PHASE, {
      settings: { ATTRIBUTES: ['RemoveHeadersOnCopy'] },
    });
    const embedPhase = addPhase(project, 'PBXCopyFilesBuildPhase', EMBED_PHASE, [embedded], {
      dstPath: quote(''),
      dstSubfolderSpec: 13,
      name: quote(EMBED_PHASE),
    });
    const appTarget = project.pbxNativeTargetSection()[appTargetUuid];
    const resourcesIndex = appTarget.buildPhases.findIndex((phase) => phase.comment === 'Resources');
    appTarget.buildPhases.splice(resourcesIndex >= 0 ? resourcesIndex + 1 : appTarget.buildPhases.length, 0, embedPhase);

    objects.PBXTargetDependency = objects.PBXTargetDependency ?? {};
    objects.PBXContainerItemProxy = objects.PBXContainerItemProxy ?? {};
    project.addTargetDependency(appTargetUuid, [targetUuid]);

    return config;
  });

module.exports = (config) => withAppFiles(withWidgetTarget(withWidgetFiles(withLiveActivities(config))));
