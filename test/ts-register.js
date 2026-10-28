'use strict';

// Offline TypeScript require hook and module aliasing for the tournament
// regression suite. TypeScript is resolved the normal way (project
// node_modules first); when project dependencies are not installed, set
// NODE_PATH to any node_modules directory that contains typescript, e.g.
//   NODE_PATH=/path/to/node_modules npm run test:tournaments

const fs = require('fs');
const Module = require('module');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STUBS = path.join(__dirname, 'stubs');

let ts;
try {
  ts = require('typescript');
} catch (e) {
  console.error(
    'Cannot resolve the "typescript" module. Install the project '
      + 'dependencies first, or set NODE_PATH to a node_modules directory '
      + 'that contains typescript.');
  process.exit(1);
}

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2017,
  experimentalDecorators: true,
  emitDecoratorMetadata: false,
  esModuleInterop: true,
};

// capture the pre-existing hooks so callers (e.g. the root integration
// suite running under @babel/register) can restore them after the events
// modules have been loaded
const hadTsExtension
    = Object.prototype.hasOwnProperty.call(require.extensions, '.ts');
const originalTsExtension = require.extensions['.ts'];

// transpile .ts files on require; type-only imports are elided by the
// transpiler, so browser/backend-only modules that are only used as types
// never reach the resolver
require.extensions['.ts'] = function(mod, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: COMPILER_OPTIONS,
    fileName: filename,
  });
  mod._compile(outputText, filename);
};

// specifiers that resolve to stubs in the offline environment
const STUB_ALIASES = {
  '@angular/core': 'angular-core.js',
  '@angular/common': 'angular-common.js',
  'rxjs': 'rxjs.js',
  'rxjs/operators': 'rxjs-operators.js',
  'firebase': 'firebase.js',
  'firebase-admin': 'firebase-admin.js',
  'firebase-functions': 'firebase-functions.js',
};

// specifiers that resolve to repository sources outside the importer's
// relative path, matching the tsconfig baseUrl of "./"
const ROOT_ALIASES = {
  'types': 'types.ts',
  'constants': 'constants.ts',
  'teams': 'teams.ts',
  'game-options': 'game-options.ts',
  'team-arena': 'team-arena.ts',
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function(request, ...args) {
  if (Object.prototype.hasOwnProperty.call(STUB_ALIASES, request)) {
    return path.join(STUBS, STUB_ALIASES[request]);
  }
  if (Object.prototype.hasOwnProperty.call(ROOT_ALIASES, request)) {
    return path.join(ROOT, ROOT_ALIASES[request]);
  }

  // browser/backend-only packages whose value imports are never exercised
  // by the tests resolve to an empty module
  if (request === '@angular/fire' || request.startsWith('@angular/fire/')
      || request === '@angular/router' || request.startsWith('@angular/router/')
      || request === '@ionic/angular' || request.startsWith('@ionic/angular/')
      || request.startsWith('firebase-admin/')
      || request.startsWith('firebase-functions/')) {
    return path.join(STUBS, 'empty.js');
  }

  // bare 'src/...' specifiers resolve from the repository root, matching
  // the tsconfig baseUrl
  if (request.startsWith('src/')) {
    const resolved = path.join(ROOT, request);
    for (const ext of ['.ts', '.js']) {
      if (fs.existsSync(resolved + ext)) {
        return resolved + ext;
      }
    }
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  // fall back to the stub lodash only when the real one is not installed
  try {
    return originalResolveFilename.call(this, request, ...args);
  } catch (e) {
    if (request === 'lodash') {
      return path.join(STUBS, 'lodash.js');
    }
    throw e;
  }
};

// restores the module hooks this file replaced; other suites sharing the
// process call this once the events modules are loaded so their own
// require pipeline (e.g. the root Babel hook) is unaffected afterwards
function restore() {
  Module._resolveFilename = originalResolveFilename;
  if (hadTsExtension) {
    require.extensions['.ts'] = originalTsExtension;
  } else {
    delete require.extensions['.ts'];
  }
}

module.exports = { ROOT, restore };
