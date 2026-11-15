const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Extend watchFolders with monorepo root, don't replace
config.watchFolders = [
  ...(config.watchFolders || []),
  monorepoRoot,
];

// Resolve modules from both the project and monorepo root node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// `config.resolver.disableHierarchicalLookup = true` used to live here. It was
// added to stop a package like react-native-safe-area-context resolving through
// two paths and being bundled twice, where both copies call
// requireNativeComponent('RNCSafeAreaProvider') and crash the release bundle
// with "Tried to register two views with the same name".
//
// It had to go on the SDK 54 upgrade, because it does not do what its name
// suggests. It does not dedupe; it stops Metro walking up node_modules trees at
// all, so Metro can only ever see the two directories listed above. That was
// survivable while npm hoisted everything flat, and stopped being survivable
// when SDK 54's tree left react-native's own `promise@8.3.0` nested inside
// node_modules/react-native/node_modules. Metro could not resolve it, and the
// bundle failed after 3,384 modules.
//
// The duplication it guarded against is now prevented by the thing that
// actually prevents it: exactly one copy of each native module on disk.
// Verified at the time of this change for react-native, safe-area-context,
// screens, svg, gesture-handler and reanimated.
//
// If "Tried to register two views with the same name" ever comes back, the fix
// is to find and remove the second copy — `npm ls <package>` will show both —
// NOT to reinstate this flag, which would break nested resolution again.

module.exports = config;
