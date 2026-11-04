'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const rx = require('rxjs');
const operators = require('rxjs/operators');

const root = path.resolve(__dirname, '..');
const decorator = () => () => {};
class EventEmitter extends rx.Subject {
  emit(value) {
    this.next(value);
  }
}

function harness(cachedName = null) {
  const auth = new rx.Subject();
  const admins = new rx.Subject();
  const queries = [];
  const deleted = [];
  const storage = new Map(cachedName ? [['generals-name', cachedName]] : []);
  const cache = new Map();
  let signOutCalls = 0;
  const db = {
    doc(id) {
      assert.strictEqual(id, 'generals.io/admins');
      return { valueChanges: () => admins };
    },
    collection(name, configure) {
      const query = { filters: [], active: false,
        orderBy: () => query,
        where: (...args) => {
          query.filters.push(args);
          return query;
        } };
      if (configure) {
        assert.strictEqual(name, 'events');
        configure(query);
        queries.push(query);
      }
      return {
        doc: id => ({
          get: async () => ({ data: () => ({ type: 'FFA' }) }),
          collection: child => ({
            doc: player => ({ delete: async () => deleted.push([id, child, player]) }),
          }),
        }),
        snapshotChanges: () => new rx.Observable(subscriber => {
          query.active = true;
          const visibility = query.filters.find(filter => filter[0] === 'visibility');
          const events = ['Public', 'Private'].filter(value =>
            !visibility || visibility[2].includes(value));
          subscriber.next(events.map(value => ({
            payload: { doc: { id: value, exists: true,
              data: () => ({ visibility: value, type: 'FFA', startTime: 0,
                endTime: Number.MAX_SAFE_INTEGER }) } },
          })));
          return () => { query.active = false; };
        }),
      };
    },
  };
  const angular = { Injectable: decorator, Component: decorator,
    Input: decorator, Output: decorator, ViewChild: decorator, EventEmitter };

  // Execute complete production classes with real RxJS; only browser/DI seams
  // are substituted, so switchMap cancellation and initial emissions are real.
  function load(file) {
    if (cache.has(file)) {
      return cache.get(file);
    }
    const exports = {};
    cache.set(file, exports);
    const compiled = ts.transpileModule(
      fs.readFileSync(path.join(root, file), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2017, experimentalDecorators: true },
      }).outputText;
    const requireModule = id => {
      if (id === '@angular/core') {
        return angular;
      }
      if (id === 'rxjs') {
        return rx;
      }
      if (id === 'rxjs/operators') {
        return operators;
      }
      if (id === 'firebase') {
        return { default: { firestore: () => db } };
      }
      if (id === 'types' || id.endsWith('/types')) {
        return load('types.ts');
      }
      if (id.endsWith('/constants')) {
        return load('constants.ts');
      }
      if (id === 'src/environments/environment') {
        return { environment: {} };
      }
      if (id.endsWith('/team-arena')) {
        return { isTeamArena: () => false };
      }
      // These imports are DI types or unrelated helpers, not exercised here.
      return {};
    };
    vm.runInNewContext(compiled, {
      exports, require: requireModule, console,
      localStorage: {
        getItem: key => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key),
      },
    }, { filename: file });
    return exports;
  }

  const { GeneralsService } = load('src/app/services/generals.service.ts');
  const generals = new GeneralsService({}, {
    authState: auth, signOut: async () => { signOutCalls++; },
  }, {}, {}, db);
  const { EventService } = load('src/app/services/event.service.ts');
  const events = new EventService(db, generals, {}, {});
  const { HomePage } = load('src/app/pages/home/home.page.ts');
  const home = new HomePage(events, {}, generals);
  const { ChatComponent } = load('src/app/components/chat/chat.component.ts');
  const chat = new ChatComponent(generals, {});
  return { auth, admins, queries, deleted, generals, events, home, chat,
    signOutCalls: () => signOutCalls };
}

function visible(home) {
  return Array.from(home.allEvents, event => event.visibility);
}

async function main() {
  const h = harness('alice');
  assert.strictEqual(h.home.canCreateEvent, false, 'cached name is not authority');
  assert.deepStrictEqual(visible(h.home), ['Public']);
  h.admins.next({ names: ['alice'] });
  assert.strictEqual(h.home.canCreateEvent, false, 'doc alone is not authority');
  await assert.rejects(h.events.removePlayer('event', 'bob'), /only remove yourself/);
  assert.strictEqual(h.deleted.length, 0);
  h.auth.next({ uid: 'alice' });
  assert.strictEqual(h.home.canCreateEvent, true);
  assert.deepStrictEqual(visible(h.home), ['Public', 'Private']);
  assert.strictEqual(h.queries[0].active, false, 'old listener is cancelled');
  assert.strictEqual(h.queries[1].active, true);
  await h.events.removePlayer('event', 'bob');
  assert.deepStrictEqual(h.deleted, [['event', 'players', 'bob']]);
  assert.strictEqual(h.chat.isAdmin('alice'), true);
  assert.strictEqual(h.chat.isAdmin('Automated Message'), true, 'system crown retained');
  assert.strictEqual(h.generals.isOrganizer('Automated Message'), false);

  h.admins.next({ names: ['bob'] });
  assert.strictEqual(h.home.canCreateEvent, false, 'live removal hides controls');
  assert.deepStrictEqual(visible(h.home), ['Public']);
  assert.strictEqual(h.queries[1].active, false);
  assert.strictEqual(h.chat.isAdmin('alice'), false);
  h.admins.next({ names: ['alice', 'bob'] });
  assert.strictEqual(h.home.canCreateEvent, true, 'live grant restores controls');
  h.auth.next({ uid: 'carol' });
  assert.strictEqual(h.home.canCreateEvent, false, 'account switch revokes');
  h.auth.next({ uid: 'alice' });
  let roleAtNameChange;
  h.generals.nameChanged$.subscribe(() => {
    roleAtNameChange = h.generals.isAdmin;
  });
  const logout = h.generals.logout();
  assert.strictEqual(h.home.canCreateEvent, false, 'logout revokes synchronously');
  assert.strictEqual(roleAtNameChange, false, 'role revoked before name notification');
  await logout;
  assert.strictEqual(h.signOutCalls(), 1);
  h.home.ngOnDestroy();
  assert.strictEqual(h.queries.filter(query => query.active).length, 0);

  const parent = harness();
  const subscription = parent.events.getEvents('parent').subscribe();
  assert.deepStrictEqual(
    Array.from(parent.queries[parent.queries.length - 1].filters[0]),
    ['parentId', '==', 'parent']);
  parent.auth.next({ uid: 'alice' });
  parent.admins.next({ names: ['alice'] });
  assert.deepStrictEqual(
    Array.from(parent.queries[parent.queries.length - 1].filters[0]),
    ['parentId', '==', 'parent']);
  subscription.unsubscribe();
  parent.home.ngOnDestroy();

  for (const malformed of [undefined, {}, { names: null }, { names: 'alice' }]) {
    const missing = harness();
    missing.auth.next({ uid: 'alice' });
    missing.admins.next({ names: ['alice'] });
    assert.strictEqual(missing.generals.isAdmin, true);
    missing.admins.next(malformed);
    assert.strictEqual(missing.generals.isAdmin, false);
    assert.deepStrictEqual(visible(missing.home), ['Public']);
    missing.home.ngOnDestroy();
  }

  const denied = harness();
  denied.auth.next({ uid: 'alice' });
  denied.admins.next({ names: ['alice'] });
  denied.admins.error(new Error('read denied'));
  assert.strictEqual(denied.generals.isAdmin, false);
  assert.deepStrictEqual(visible(denied.home), ['Public']);
  denied.home.ngOnDestroy();

  const exact = harness();
  exact.auth.next({ uid: 'alice' });
  exact.admins.next({ names: ['Alice', '', null, 42, { name: 'alice' }] });
  assert.strictEqual(exact.generals.isAdmin, false);
  assert.strictEqual(exact.generals.isOrganizer('Alice'), true);
  exact.auth.next({ uid: 'EklipZ' });
  assert.strictEqual(exact.generals.isAdmin, false, 'no hardcoded organizer fallback');
  exact.home.ngOnDestroy();
  console.log('Frontend organizer reactive controls/query/privacy checks passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
