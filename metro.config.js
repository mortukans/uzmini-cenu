// Stub native-only SDKs on web so `expo start --web` works for screen smoke tests.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
const WEB_STUBS = new Set([]);
const stub = path.resolve(__dirname, 'src/web-stubs/empty.js');

const prev = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_STUBS.has(moduleName)) return { type: 'sourceFile', filePath: stub };
  return prev ? prev(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
