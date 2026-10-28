// Authentication and authorization boundary tests for the teamBracketAction
// callable. Every path goes through the REAL callable handler against a fake
// Firestore: identity comes from context.auth.uid only, organizers from
// generals.io/admins only. Nothing here re-implements the validation logic.
process.env.NODE_ENV = 'test';
require('./ts-register');
const assert = require('assert');
const { teamBracketAction }
    = require('../functions/src/https/callable/team-bracket');
const { FakeFirestore } = require('./fakes');
const { EventType, EventFormat } = require('../types');

function player(name, extra = {}) {
  return {
    name, dq: false, rank: 0, points: 0, currentStreak: 0, record: [],
    ...extra,
  };
}

function call(body, uid) {
  return teamBracketAction(body,
      uid === undefined ? {} : { auth: { uid } });
}

async function expectError(promise, code, label) {
  try {
    await promise;
  } catch (e) {
    assert.strictEqual(e.code, code,
      `${label}: expected ${code}, got ${e.code}: ${e.message}`);
    return;
  }
  assert.fail(`${label}: expected rejection with ${code}`);
}

function bigTeamEvent(id, overrides = {}) {
  return {
    id, name: 'Big Team Test', type: EventType.BIG_TEAM,
    format: EventFormat.DOUBLE_ELIM, teamSize: 3,
    checkedInPlayers: [], ...overrides,
  };
}

function seed(store, event, players, admins = ['Boss']) {
  store.docs.set(`events/${event.id}`, event);
  for (const p of players) {
    store.docs.set(`events/${event.id}/players/${p.name}`, p);
  }
  if (admins) {
    store.docs.set('generals.io/admins', { names: admins });
  }
  global.__testFirestore = store;
}

async function main() {
  // no-read rejection: every malformed request fails before touching
  // Firestore at all — calls are made INSIDE the loop so each rejection
  // is awaited before the next callable runs
  {
    const store = new FakeFirestore();
    global.__testFirestore = store;
    const reads = { count: 0 };
    const origDoc = store.doc.bind(store);
    store.doc = path => {
      const doc = origDoc(path);
      const get = doc.get.bind(doc);
      doc.get = (...args) => {
        reads.count++;
        return get(...args);
      };
      return doc;
    };
    const cases = [
      [() => call({ eventId: 'e', action: 'sendInvite',
        payload: { target: 'x' } }), 'unauthenticated', 'unauthenticated'],
      [() => call({ eventId: 'e', action: 'leaveTeam', payload: {} },
        'has/slash'), 'unauthenticated', 'uid containing slash'],
      [() => call({ eventId: 'e', action: 'leaveTeam', payload: {} },
        ' spaces '), 'unauthenticated', 'uid with whitespace'],
      [() => call('not an object', 'a'),
        'invalid-argument', 'non-object body'],
      [() => call({ eventId: 'e', action: 'leaveTeam', payload: {},
        caller: 'spoof' }, 'a'), 'invalid-argument',
      'top-level identity field'],
      [() => call({ eventId: 'e', action: 'register', payload: {} }, 'a'),
        'invalid-argument', 'unknown action'],
      [() => call({ eventId: ' e ', action: 'leaveTeam', payload: {} }, 'a'),
        'invalid-argument', 'whitespace eventId'],
      [() => call({ eventId: 'e', action: 'sendInvite', payload: {} }, 'a'),
        'invalid-argument', 'missing required target'],
      [() => call({ eventId: 'e', action: 'acceptInvite', payload: {} }, 'a'),
        'invalid-argument', 'missing required captain'],
      // a missing rename name must reject before any Firestore read
      [() => call({ eventId: 'e', action: 'renameTeam', payload: {} }, 'a'),
        'invalid-argument', 'missing rename name'],
      [() => call({ eventId: 'e', action: 'sendInvite',
        payload: { target: 'x', captain: 'y' } }, 'a'),
      'invalid-argument', 'unknown payload key'],
      [() => call({ eventId: 'e', action: 'sendInvite',
        payload: { target: 'has/slash' } }, 'a'),
      'invalid-argument', 'unsafe target id'],
      [() => call({ eventId: 'e', action: 'renameTeam',
        payload: { name: 42 } }, 'a'),
      'invalid-argument', 'non-string rename'],
    ];
    for (const [invoke, code, label] of cases) {
      await expectError(invoke(), code, label);
    }
    assert.strictEqual(reads.count, 0,
      'all malformed requests rejected with zero Firestore reads');
    assert.strictEqual(store.invocations.length, 0,
      'all malformed requests rejected with zero Firestore writes');
  }

  // a forged AUTH TOKEN admin claim is NOT authority: only the
  // generals.io/admins document names organizers
  {
    const store = new FakeFirestore();
    seed(store, bigTeamEvent('evt1',
      { checkedInPlayers: ['a', 'b'] }), [player('a'), player('b')]);
    // the callable reads context.auth.uid only; a token claim never even
    // reaches the ops layer as authority
    await expectError(
      teamBracketAction({ eventId: 'evt1', action: 'withdrawPlayer',
        payload: { name: 'b' } },
      { auth: { uid: 'a', token: { admin: true } } }),
      'permission-denied', 'forged admin token claim');
    assert.ok(store.dataAt('events/evt1/players/b'),
      'target doc untouched by forged claim');
    // the doc-listed organizer CAN withdraw others
    const boss = new FakeFirestore();
    seed(boss, bigTeamEvent('evt1',
      { checkedInPlayers: ['a', 'b'] }), [player('a'), player('b')]);
    await teamBracketAction({ eventId: 'evt1',
      action: 'withdrawPlayer', payload: { name: 'b' } },
    { auth: { uid: 'Boss' } });
    assert.strictEqual(boss.dataAt('events/evt1/players/b'), undefined,
      'doc-listed organizer purge succeeded');
    // and a self-withdraw works for an ordinary member
    const own = new FakeFirestore();
    seed(own, bigTeamEvent('evt1',
      { checkedInPlayers: ['a', 'b'] }), [player('a'), player('b')]);
    await teamBracketAction({ eventId: 'evt1',
      action: 'withdrawPlayer', payload: { name: 'a' } },
    { auth: { uid: 'a' } });
    assert.strictEqual(own.dataAt('events/evt1/players/a'), undefined,
      'self withdraw allowed');
    console.log('  bracket auth passed');
  }

  // non-Big-Team and arena events reject as not-found
  {
    const store = new FakeFirestore();
    seed(store, { id: 'e2', type: EventType.ONE_VS_ONE }, []);
    await expectError(
      call({ eventId: 'e2', action: 'leaveTeam', payload: {} }, 'a'),
      'not-found', 'non-Big-Team event');
    const arena = new FakeFirestore();
    seed(arena, { id: 'e3', type: EventType.BIG_TEAM,
      format: EventFormat.ARENA }, []);
    await expectError(
      call({ eventId: 'e3', action: 'leaveTeam', payload: {} }, 'a'),
      'not-found', 'arena events do not use bracket flow');
    console.log('  bracket event-type guards passed');
  }
  console.log('All team bracket auth tests passed!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
