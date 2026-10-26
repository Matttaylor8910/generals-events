// Storage codec coverage for the event_team lobby contract: documents
// cannot hold nested arrays, so storeLobby wraps each roster in {players}
// and loadLobby restores the wire shape with the same strict validation.
const assert = require('assert');
const TeamArena = require('../functions/src/util/TeamArena');
const {FakeFirestore} = require('./fakes');

async function main() {
  const wire = {
    version: 1, teamSize: 2, gameSize: 4,
    teams: [['a', 'b'], ['c', 'd']],
  };

  // store: nested rosters become object-wrapped for the document
  const stored = TeamArena.storeLobby(wire);
  assert.deepStrictEqual(stored.teams,
      [{players: ['a', 'b']}, {players: ['c', 'd']}],
      'storeLobby wraps each roster');
  assert.strictEqual(stored.gameSize, 4);
  assert.strictEqual(stored.teamSize, 2);
  assert.strictEqual(stored.version, 1);
  // the stored shape must satisfy the no-nested-arrays document rule
  assert.ok(stored.teams.every(t =>
      !Array.isArray(t) && Array.isArray(t.players)),
      'stored shape is document-safe');

  // load: exact round-trip back to the normalized wire contract
  const back = TeamArena.loadLobby(stored);
  assert.deepStrictEqual(back, wire, 'loadLobby restores the wire shape');

  // a raw nested-array wire payload must NOT decode — no compat fallback
  assert.throws(() => TeamArena.loadLobby(wire), /stored/,
      'raw nested arrays are rejected');

  // malformed stored shapes reject, including extra object keys
  assert.throws(() => TeamArena.loadLobby({
      version: 1, teamSize: 2, gameSize: 4,
      teams: [{players: ['a', 'b'], extra: 1}, {players: ['c', 'd']}],
    }), 'extra team key rejected');
  assert.throws(() => TeamArena.loadLobby({
      version: 1, teamSize: 2, gameSize: 4,
      teams: [{roster: ['a', 'b']}, {players: ['c', 'd']}],
    }), 'non-players key rejected');
  assert.throws(() => TeamArena.loadLobby(null), 'null rejected');
  assert.throws(() => TeamArena.loadLobby({
      version: 1, teamSize: 2, gameSize: 4, teams: 'x',
    }), 'non-array teams rejected');

  // an invalid roster still fails after decoding, same as the wire path
  assert.throws(() => TeamArena.loadLobby({
      version: 1, teamSize: 2, gameSize: 4,
      teams: [{players: ['a', 'a']}, {players: ['c', 'd']}],
    }), 'duplicate player rejected');
  assert.throws(() => TeamArena.loadLobby({
      version: 1, teamSize: 2, gameSize: 4,
      teams: [{players: ['a', 'b', 'c']}, {players: ['d']}],
    }), 'oversized team rejected');
  // store-side validation stays strict: malformed wire input never writes
  assert.throws(() => TeamArena.storeLobby({
      version: 1, teamSize: 2, gameSize: 4,
      teams: [['a', 'b', 'c'], ['d']],
    }), 'storeLobby validates the wire input first');

  // a nested-array write inside a transaction or batch must reject the
  // whole atomic unit — earlier valid writes must not apply
  {
    const store = new FakeFirestore();
    const batch = store.batch();
    batch.create(store.doc('events/e/b/b'), {good: 1});
    batch.create(store.doc('events/e/c/c'),
        {teams: [['x', 'y'], ['z']]});
    await assert.rejects(batch.commit(), /nested array/,
        'batch nested array rejected');
    assert.ok(!store.docs.has('events/e/b/b'),
        'no write applied after batch preflight failure');
    assert.strictEqual(store.invocations.length, 0);

    await assert.rejects(store.runTransaction(tx => {
      tx.create(store.doc('events/e/d/d'), {good: 1});
      tx.create(store.doc('events/e/e/e'),
          {teams: [['x', 'y'], ['z']]});
    }), /nested array/, 'transaction nested array rejected');
    assert.ok(!store.docs.has('events/e/d/d'),
        'no write applied after tx preflight failure');
    assert.strictEqual(store.invocations.length, 0);
    console.log('  atomic nested-array rejection passed');
  }

  console.log('event team codec tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
