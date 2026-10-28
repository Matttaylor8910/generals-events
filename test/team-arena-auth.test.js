'use strict';

// Committed regression coverage for the teamArenaAction callable: every
// malformed, unauthenticated, or forged request is rejected before any
// Firestore read, and the organizer source is generals.io/admins only.
//
//   NODE_ENV=test node test/team-arena-auth.test.js

require('./ts-register');

const assert = require('assert');
const { FakeFirestore } = require('./fakes');
const { DoublesPairingStrategy, EventFormat, EventType } = require('../types');
const { teamArenaAction }
    = require('../functions/src/https/callable/team-arena');

function makeEvent(overrides = {}) {
  const now = Date.now();
  return {
    id: 'evt1', name: 'TA', type: EventType.BIG_TEAM,
    format: EventFormat.ARENA, startTime: now - 1000,
    endTime: now + 3600000, teamSize: 2, playersPerGame: 4,
    doublesPairingStrategy: DoublesPairingStrategy.BRING_YOUR_PARTNER,
    server: 'na', options: {}, replays: [], arenaTeams: [],
    arenaReady: {}, arenaQueueAt: {}, arenaPlaying: [],
    arenaParticipants: [], arenaMatchNumber: 0, arenaTeamNumber: 0,
    ongoingGameCount: 0, ...overrides,
  };
}

// instrument the store so we can prove bad requests never touch Firestore
function countReads(store) {
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
  return reads;
}

async function codeOf(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error.code || error.message;
  }
}

const call = (data, uid) =>
  teamArenaAction(data, { auth: uid === null ? null : { uid } });

async function expectNoReads(store, data, uid, expectedCode) {
  const reads = countReads(store);
  const code = await codeOf(call(data, uid));
  assert.strictEqual(code, expectedCode,
    `${JSON.stringify(data)}: expected ${expectedCode}, got ${code}`);
  assert.strictEqual(reads.count, 0,
    `${expectedCode} requests must not read Firestore`);
}

async function main() {
  // ---------------------------------------------------- no-read rejects -
  const store = new FakeFirestore();
  global.__testFirestore = store;
  store.docs.set('events/evt1', makeEvent());
  store.docs.set('generals.io/admins', { names: ['Boss'] });

  await expectNoReads(store,
    { eventId: 'evt1', action: 'register' }, null, 'unauthenticated');
  await expectNoReads(store,
    { eventId: 'evt1', action: 'register' }, ' spaced ', 'unauthenticated');
  await expectNoReads(store,
    { eventId: 'evt1', action: 'register', caller: 'a0' }, 'a0',
    'invalid-argument');
  await expectNoReads(store,
    { eventId: 'evt1', action: 'register', name: 'a0' }, 'a0',
    'invalid-argument');
  await expectNoReads(store,
    { eventId: 'evt1', action: 'notAnAction' }, 'a0', 'invalid-argument');
  await expectNoReads(store,
    { eventId: 'evt1', action: 'register', payload: { who: 'x' } }, 'a0',
    'invalid-argument');
  await expectNoReads(store,
    { eventId: ' evt1 ', action: 'register' }, 'a0', 'invalid-argument');
  await expectNoReads(store,
    { eventId: 'evt1/x', action: 'register' }, 'a0', 'invalid-argument');
  await expectNoReads(store,
    { eventId: 'evt1', action: 'setReady', payload: { ready: 'true' } }, 'a0',
    'invalid-argument');
  await expectNoReads(store,
    { eventId: 'evt1', action: 'setTeamOptions',
      payload: { acceptFill: 'yes' } }, 'a0', 'invalid-argument');
  await expectNoReads(store,
    { eventId: 'evt1', action: 'requestTeam', payload: {} }, 'a0',
    'invalid-argument');
  await expectNoReads(store,
    { eventId: 'evt1', action: 'acceptPlayer', payload: {} }, 'a0',
    'invalid-argument');
  await expectNoReads(store,
    { eventId: 'evt1', action: 'createTeam',
      payload: { teamName: 'x'.repeat(21) } }, 'a0', 'invalid-argument');
  await expectNoReads(store,
    'not an object', 'a0', 'invalid-argument');
  console.log('  no-read rejects passed');

  // --------------------------------------------- boundary/authority ----
  // non-team-arena event rejected after the single event read
  const other = new FakeFirestore();
  global.__testFirestore = other;
  other.docs.set('events/evt1',
    { ...makeEvent(), format: EventFormat.DOUBLE_ELIM });
  const reads = countReads(other);
  assert.strictEqual(await codeOf(
    call({ eventId: 'evt1', action: 'register' }, 'a0')), 'not-found');
  assert.strictEqual(reads.count, 1, 'only the event doc was read');
  global.__testFirestore = store;

  // withdraw another player: denied before/without organizer authority
  assert.strictEqual(await codeOf(call(
    { eventId: 'evt1', action: 'withdrawPlayer',
      payload: { name: 'b0' } }, 'a0')), 'permission-denied');

  // real lifecycle through the callable: register, blank + named teams,
  // rename preserving untouched option fields
  await call({ eventId: 'evt1', action: 'register' }, 'a0');
  assert.strictEqual(store.dataAt('events/evt1/players/a0').name, 'a0');
  await call({ eventId: 'evt1', action: 'register' }, 'a0');
  await call({ eventId: 'evt1', action: 'createTeam',
    payload: { teamName: '' } }, 'a0');
  assert.strictEqual(store.dataAt('events/evt1').arenaTeams[0].name,
    'a0\'s Team', 'blank display name keeps default');
  await call({ eventId: 'evt1', action: 'register' }, 'b0');
  await call({ eventId: 'evt1', action: 'createTeam',
    payload: { teamName: 'a/b squad' } }, 'b0');
  assert.strictEqual(store.dataAt('events/evt1').arenaTeams[1].name,
    'a/b squad', 'slashes are legal in display names');
  await call({ eventId: 'evt1', action: 'setTeamOptions',
    payload: { acceptFill: true } }, 'a0');
  await call({ eventId: 'evt1', action: 'setTeamOptions',
    payload: { name: 'Renamed' } }, 'a0');
  const team = store.dataAt('events/evt1').arenaTeams[0];
  assert.strictEqual(team.name, 'Renamed');
  assert.strictEqual(team.acceptFill, true,
    'omitted option field survives a rename');
  console.log('  boundary and lifecycle passed');

  // organizer from the doc only: Boss withdraws anyone, but a forged
  // admin claim in the payload changes nothing
  assert.strictEqual(await codeOf(call(
    { eventId: 'evt1', action: 'withdrawPlayer',
      payload: { name: 'b0', admin: true } }, 'Boss')),
  'invalid-argument', 'forged admin key rejected outright');
  await call({ eventId: 'evt1', action: 'withdrawPlayer',
    payload: { name: 'b0' } }, 'Boss');
  assert.strictEqual(
    store.dataAt('events/evt1/players/b0'), undefined,
    'doc-listed organizer can purge a registration');
  // missing admins doc fails closed
  const noAdmins = new FakeFirestore();
  global.__testFirestore = noAdmins;
  noAdmins.docs.set('events/evt1', makeEvent());
  noAdmins.docs.set('events/evt1/players/p0', {
    name: 'p0', rank: 0, points: 0, currentStreak: 0, dq: false,
    withdrawn: false, record: [],
  });
  assert.strictEqual(await codeOf(call(
    { eventId: 'evt1', action: 'finalize' }, 'Lazerpent')),
  'permission-denied', 'no admins doc → nobody is organizer');
  console.log('  organizer authority passed');

  // register guard rails: withdrawn+DQ cannot rejoin; DQ never clears
  const dq = new FakeFirestore();
  global.__testFirestore = dq;
  dq.docs.set('events/evt1', makeEvent());
  dq.docs.set('events/evt1/players/a0', {
    name: 'a0', rank: 0, points: 30, currentStreak: 1, dq: true,
    withdrawn: true, record: [{ replayId: 'r' }],
  });
  assert.strictEqual(await codeOf(call(
    { eventId: 'evt1', action: 'register' }, 'a0')),
  'failed-precondition', 'withdrawn DQ cannot re-register');
  assert.deepStrictEqual(dq.dataAt('events/evt1/players/a0'), {
    name: 'a0', rank: 0, points: 30, currentStreak: 1, dq: true,
    withdrawn: true, record: [{ replayId: 'r' }],
  }, 'registration left untouched');
  console.log('  register guards passed');

  console.log('All team arena auth tests passed!');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
