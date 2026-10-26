/**
 * Offline regression tests for the local emulator frontend configuration.
 *
 * Transpiles the actual TypeScript sources in an isolated Node VM context
 * with stubbed firebase/window/environment/constants - no network, no
 * Angular runtime. Covers port binding, gio URL validation, and the
 * SITE_URLS mutation that the local-isolated config depends on.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');

const BASE_FIREBASE = {
  apiKey: 'demo-generals-local-api-key',
  projectId: 'demo-generals-local',
};

function loadLocalFirebase(environment, options = {}) {
  const calls = {auth: [], firestore: [], functions: [], init: 0};
  const fakeApp = {
    options: {projectId: (environment.firebase || {}).projectId},
    auth: () => ({useEmulator: (url) => calls.auth.push(url)}),
    firestore: () => ({settings: (s) => calls.firestore.push(s)}),
    functions: () => ({useEmulator: (h, p) => calls.functions.push([h, p])}),
  };
  const firebase = {
    apps: options.existingApp ? [fakeApp] : [],
    app: () => fakeApp,
    initializeApp: () => { calls.init++; return fakeApp; },
  };
  if (options.existingApp) {
    fakeApp.options = {projectId: options.existingProject || 'other'};
  }
  const SITE_URLS = {
    na: 'https://generals.io', eu: 'https://eu.generals.io',
    bot: 'https://bot.generals.io', ek: 'http://45.50.38.248:8080',
    loc: 'http://localhost:8080',
  };
  const moduleSrc = ts.transpile(
      fs.readFileSync(path.join(SRC, 'local-firebase.ts'), 'utf8'),
      {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019});
  const moduleObj = {exports: {}};
  const sandbox = {
    module: moduleObj,
    exports: moduleObj.exports,
    require: (id) => {
      if (id === 'firebase/app') return {default: firebase};
      if (id.startsWith('firebase/')) return {};
      if (id === './environments/environment') return {environment};
      if (id === '../constants') {
        return {GeneralsServer: {LOCAL: 'loc', NA: 'na'}, SITE_URLS};
      }
      throw new Error('unexpected require: ' + id);
    },
    window: {
      location: {hostname: options.hostname || 'localhost'},
    },
    URL, console,
  };
  vm.runInNewContext(moduleSrc, sandbox, {filename: 'local-firebase.js'});
  return {calls, SITE_URLS, fn: sandbox.module.exports.setupLocalEmulators};
}

function loadGioOrigin(environment) {
  const SITE_URLS = {
    na: 'https://generals.io', eu: 'https://eu.generals.io',
    bot: 'https://bot.generals.io', ek: 'http://45.50.38.248:8080',
    loc: 'http://localhost:8180',
  };
  // extract the REAL gioOrigin method body from generals.service.ts via
  // the TypeScript AST - no hardcoded copy, so a source regression is
  // always caught
  const sourceFile = ts.createSourceFile(
      'generals.service.ts',
      fs.readFileSync(
          path.join(SRC, 'app', 'services', 'generals.service.ts'), 'utf8'),
      ts.ScriptTarget.Latest, true);
  let methodText = null;
  const visit = (node) => {
    if (ts.isMethodDeclaration(node) &&
        node.name.getText(sourceFile) === 'gioOrigin') {
      methodText = node.getText(sourceFile);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!methodText) throw new Error('gioOrigin not found in source');
  const classSrc = ts.transpile(
      `class GeneralsService { ${methodText} }`,
      {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019});
  const serviceModule = {exports: {}};
  const sandbox = {
    module: serviceModule, exports: serviceModule.exports, environment,
    GeneralsServer: {LOCAL: 'loc'}, SITE_URLS, console,
  };
  vm.runInNewContext(classSrc, sandbox, {filename: 'generals-service.js'});
  const probe = `
    const instance = new GeneralsService();
    ({origin: (srv) => instance.gioOrigin(srv)})`;
  return vm.runInNewContext(probe, sandbox);
}


function loadEnvironmentFile(file, environmentModule) {
  const src = ts.transpile(
      fs.readFileSync(path.join(SRC, 'environments', file), 'utf8'),
      {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019});
  const mod = {exports: {}};
  const sandbox = {
    module: mod, exports: mod.exports,
    require: (id) => {
      if (id === './environment.local') return environmentModule;
      throw new Error('unexpected require: ' + id);
    },
    console,
  };
  vm.runInNewContext(src, sandbox, {filename: file});
  return sandbox.module.exports.environment;
}

const envLocal = loadEnvironmentFile('environment.local.ts', null);
const envIsolated = loadEnvironmentFile('environment.local-isolated.ts',
    {environment: envLocal});
const envProd = {production: true, firebase: {projectId: 'generals'}};


function throwsWith(env, options, pattern) {
  const {fn} = loadLocalFirebase(env, options);
  assert.throws(fn, pattern);
}

// Standard local config binds the standard emulators.
{
  const {calls, SITE_URLS, fn} = loadLocalFirebase(envLocal);
  fn();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls.auth)),
      ['http://127.0.0.1:9099']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls.firestore)),
      [{host: '127.0.0.1:8089', ssl: false}]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls.functions)),
      [['127.0.0.1', 5001]]);
  assert.strictEqual(SITE_URLS.loc, 'http://localhost:8080');
}

// Isolated config binds the isolated test-owned emulators.
{
  const {calls, SITE_URLS, fn} = loadLocalFirebase(envIsolated);
  fn();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls.auth)),
      ['http://127.0.0.1:9199']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls.firestore)),
      [{host: '127.0.0.1:8189', ssl: false}]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls.functions)),
      [['127.0.0.1', 5101]]);
  assert.strictEqual(SITE_URLS.loc, 'http://localhost:8180');
}

// Production/localEmulators false: zero SDK calls, no SITE_URLS change.
{
  const {calls, SITE_URLS, fn} = loadLocalFirebase(envProd);
  fn();
  assert.strictEqual(calls.auth.length, 0);
  assert.strictEqual(calls.firestore.length, 0);
  assert.strictEqual(calls.functions.length, 0);
  assert.strictEqual(SITE_URLS.loc, 'http://localhost:8080');
}

// Hard guard failures.
{
  const {calls, fn} = loadLocalFirebase(
      {...envLocal, firebase: {projectId: 'real-proj'}});
  assert.throws(fn, /demo-generals-local/);
  assert.strictEqual(calls.init, 0);
}
{
  const {calls, fn} = loadLocalFirebase(envLocal, {hostname: 'generals.io'});
  assert.throws(fn, /loopback/);
  assert.strictEqual(calls.init, 0);
}
{
  const {calls, fn} = loadLocalFirebase(
      {...envLocal, localServices: undefined});
  assert.throws(fn, /localServices/);
  assert.strictEqual(calls.init, 0);
}
const badPorts = [0, 65536, 1.5, '9099'];
for (const name of ['authPort', 'firestorePort', 'functionsPort']) {
  for (const port of badPorts) {
    const env = {...envLocal,
      localServices: {...envLocal.localServices, [name]: port}};
    const {calls, fn} = loadLocalFirebase(env);
    assert.throws(fn, /port/, `${name}=${port} must throw`);
    assert.strictEqual(calls.init, 0,
        `no firebase init for bad ${name}`);
  }
}
// remote/credential/path gio URLs rejected before any firebase init
for (const gioUrl of [
    'https://generals.io', 'http://user:pass@localhost:8180',
    'http://localhost:8180/path', 'http://localhost:8180/?x=1',
    'http://localhost:8180/#frag', 'ftp://localhost:8180',
]) {
  const env = {...envLocal, localServices: {...envLocal.localServices, gioUrl}};
  const {calls, fn} = loadLocalFirebase(env);
  assert.throws(fn, /gioUrl|loopback|credentials|http/);
  assert.strictEqual(calls.init, 0, `no firebase init for ${gioUrl}`);
}
// existing app bound to a different project must not reuse
{
  const {calls, fn} = loadLocalFirebase(envLocal,
      {existingApp: true, existingProject: 'other-proj'});
  assert.throws(fn, /different Firebase project/);
  assert.strictEqual(calls.init, 0);
  assert.deepStrictEqual(calls.auth, []);
  assert.deepStrictEqual(calls.firestore, []);
  assert.deepStrictEqual(calls.functions, []);
}

// gioOrigin: local follows configured SITE_URLS[LOCAL] for any server.
{
  const probe = loadGioOrigin({localEmulators: true});
  assert.strictEqual(probe.origin('na'), 'http://localhost:8180');
  assert.strictEqual(probe.origin('eu'), 'http://localhost:8180');
  assert.strictEqual(probe.origin('loc'), 'http://localhost:8180');
  const probeProd = loadGioOrigin({localEmulators: false});
  assert.strictEqual(probeProd.origin('na'), 'https://generals.io');
  assert.strictEqual(probeProd.origin('eu'), 'https://eu.generals.io');
}

console.log('local-frontend tests passed');
