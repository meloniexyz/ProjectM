// Lets the app import ProjectM's shared, platform-free code from the desktop app (../src).
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const config = getDefaultConfig(projectRoot)

config.watchFolders = [path.resolve(projectRoot, '../src')]

// Packages imported by the shared desktop files (e.g. 'react') must come from this app's
// node_modules, never the desktop app's (which has its own React/Electron versions).
const anchor = path.join(projectRoot, 'package.json')
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // music-metadata's format sniffer has Node-only code Hermes can't parse: use a small stand-in
  if (moduleName === 'file-type') return { type: 'sourceFile', filePath: path.join(projectRoot, 'src/lib/file-type-lite.js') }
  const fromShared = !context.originModulePath.startsWith(projectRoot)
  const bare = !moduleName.startsWith('.') && !path.isAbsolute(moduleName)
  if (fromShared && bare) return context.resolveRequest({ ...context, originModulePath: anchor }, moduleName, platform)
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
