const fs = require('node:fs');
const path = require('node:path');
// Fast 7z compression keeps both packages smaller without changing runtime files.
process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL ||= '1';
const offline = process.env.MULTISTUDIO_PACKAGE_PROFILE === 'offline';
const localElectron = path.join(__dirname, 'node_modules', 'electron', 'dist');
module.exports = {
  electronDist: fs.existsSync(path.join(localElectron, 'version')) ? localElectron : undefined,
  // Keep the installation/data identity to allow upgrades without orphaning data.
  appId: 'app.livetranslator.desktop', productName: 'MultiStudio',
  directories: { output: process.env.MULTISTUDIO_RELEASE_DIR || 'release' },
  publish: null,
  forceCodeSigning: process.env.MULTISTUDIO_REQUIRE_SIGNING === '1',
  artifactName: 'MultiStudio-${version}-${os}-${arch}.${ext}',
  // UI dependencies are bundled; the speech addon is copied as a platform runtime.
  files: ['dist/**/*', 'electron/*.cjs', 'plugins/**/*.cjs', 'plugins/**/manifest.json', 'assets/icons/icon.png', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'package.json', '!node_modules/**/*'],
  extraResources: [
    { from: '.cache/package-licenses', to: 'licenses' },
    { from: '.cache/native-host', to: 'native', filter: ['**/*', '!**/*.pdb'] },
    { from: '.cache/package-runtime', to: 'runtime' },
    { from: 'node_modules/sherpa-onnx-node', to: 'speech-runtime/node_modules/sherpa-onnx-node' },
    { from: `node_modules/sherpa-onnx-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`, to: `speech-runtime/node_modules/sherpa-onnx-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}` },
  ],
  asar: true,
  asarUnpack: ['plugins/sherpa/speech-worker.cjs'],
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'assets/icons/icon.ico', artifactName: offline ? 'MultiStudio-${version}-win-${arch}-Offline-Setup.${ext}' : 'MultiStudio-${version}-win-${arch}-Setup.${ext}' },
  nsis: {
    oneClick: false, perMachine: false, selectPerMachineByDefault: false,
    allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false,
    createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'MultiStudio',
    runAfterFinish: false, differentialPackage: false, useZip: false,
    installerLanguages: ['zh_CN', 'en_US'], displayLanguageSelector: false,
    uninstallDisplayName: 'MultiStudio',
  },
  mac: { target: ['dmg'], icon: 'assets/icons/icon.icns', category: 'public.app-category.productivity', hardenedRuntime: true,
    extendInfo: { NSMicrophoneUsageDescription: '用于本地语音转写与翻译。' },
    entitlements: 'electron/entitlements.mac.plist', entitlementsInherit: 'electron/entitlements.mac.plist' },
};
