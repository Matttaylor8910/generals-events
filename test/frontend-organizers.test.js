'use strict';
// Live-organizer regression: drives the actual GeneralsService constructor
// (authState + generals.io/admins doc subscription) through a VM-transpiled
// harness - no passthrough stubs, no production edits.
const assert = require('assert');
const ts = require('typescript');
const vm = require('vm');
const path = require('path');
const fs = require('fs');

class BS {
  constructor(v) { this.v = v; this._s = []; }
  next(v) { this.v = v; this._s.forEach(f => f(v)); }
  subscribe(f) { this._s.push(f); f(this.v); }
  getValue() { return this.v; }
  pipe() { return this; }
}

function compileService(relPath) {
  const src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const sandbox = {
    require: (m) => {
      if (m.includes('firestore')) return { AngularFirestore: class {} };
      if (m === '@angular/core')
        return { Injectable: () => () => {},
          EventEmitter: class extends BS { emit(v) { this.next(v); } } };
      if (m === 'rxjs') return { BehaviorSubject: BS, EventEmitter: class extends BS {} };
      if (m === 'rxjs/operators') {
        return { distinctUntilChanged: () => s => s,
          map: fn => s => s, switchMap: fn => s => s };
      }
      if (m.includes('local-firebase')) return { environment: {} };
      if (m === '../../../constants') {
        return { SITE_URLS: { NA: 'https://x' }, GeneralsServer: {} };
      }
      if (m === 'src/environments/environment') return { environment: {} };
      if (m.includes('game-options')) return { normalizeEventGameOptions: x => x };
      if (m.includes('team-arena')) {
        return { isTeamArena: () => false, normalizeEventTeam: x => x };
      }
      if (m === 'teams') return { isValidTeamSize: () => true };
      if (m === 'types') return {};
      if (m.includes('util.service')) return { UtilService: class {} };
      return {};
    },
    exports: {}, module: { exports: {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    window: {}, document: { title: '' },
    console, process: { env: {} },
  };
  const wrapped = '(function(exports) {' + out
      + ' return exports;})(sandbox.exports)';
  vm.createContext(sandbox);
  sandbox.sandbox = sandbox;             // expose the sandbox object itself
  vm.runInContext(wrapped, sandbox);
  return sandbox.exports;
}

function makeService() {
  const auths = [], docs = [];
  const mod = compileService('src/app/services/generals.service.ts');
  const afs = {
    doc: () => ({ valueChanges: () => ({ subscribe: (ok, err) => docs.push({ ok, err }) }) }),
  };
  const afAuth = { authState: { subscribe: f => auths.push(f) } };
  const svc = new mod.GeneralsService(
    { httpsCallable: () => ({ toPromise: async () => [] }) },
    afAuth, {}, {}, afs);
  svc.name = null;
  return { svc, auths, docs };
}

const push = (docs, names) => docs.forEach(d => d.ok({ names }));
const auth = (auths, uid) => auths.forEach(f => f(uid ? { uid } : null));

// grant/revoke
{
  const { svc, auths, docs } = makeService();
  assert.ok(!svc.isAdmin, 'no admin before auth or doc');
  auth(auths, 'alice');
  assert.ok(!svc.isAdmin, 'auth alone is not enough');
  push(docs, ['alice', 'bob']);
  assert.ok(svc.isAdmin, 'auth + doc grants');
  push(docs, []);
  assert.ok(!svc.isAdmin, 'list removal revokes');
  push(docs, ['alice']);
  assert.ok(svc.isAdmin);
  auths.forEach(f => f(null));
  assert.ok(!svc.isAdmin, 'logout revokes');
  auths.forEach(f => f({ uid: 'carol' }));
  assert.ok(!svc.isAdmin, 'a different account has no role');
}
// cached-name denial
{
  const { svc, auths, docs } = makeService();
  svc.name = 'alice';
  push(docs, ['alice']);
  assert.ok(!svc.isAdmin,
    'cached name must not grant - only authenticatedName');
}
// malformed/missing/error
{
  const { svc, auths, docs } = makeService();
  auth(auths, 'alice'); push(docs, ['alice']);
  assert.ok(svc.isAdmin);
  push(docs, 'not-an-array');
  assert.ok(!svc.isAdmin, 'non-array names revoke');
  auth(auths, 'alice'); push(docs, ['alice']);
  docs.forEach(d => d.err(new Error('read denied')));
  assert.ok(!svc.isAdmin, 'read error revokes');
  docs.forEach(d => d.ok(undefined));
  assert.ok(!svc.isAdmin, 'missing doc revokes');
}
// case-exact organizer attribution
{
  const { svc, docs } = makeService();
  push(docs, ['Alice']);
  assert.ok(svc.isOrganizer('Alice'));
  assert.ok(!svc.isOrganizer('alice'), 'case must match exactly');
}
console.log('frontend-organizers: all organizer-role checks passed');
