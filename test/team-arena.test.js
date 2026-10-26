'use strict';

// Offline team arena regression suite. Runs with plain node plus the
// TypeScript require hook in ./ts-register.js; Firestore, axios, and browser
// dependencies are faked, so no network or real database is ever touched.
//
//   npm run test:team-arena
//
// When project dependencies are not installed, point NODE_PATH at a
// node_modules directory containing typescript.

require('./ts-register');

global.localStorage = {
  getItem: () => null,
  setItem() {},
  removeItem() {},
};
global.window = {open() {}, addEventListener() {}};
global.location = {href: ''};

const assert = require('assert');
const path = require('path');
const LZString = require('lz-string');
const axios = require('axios');
// functions code resolves axios through functions/node_modules — stub that
// instance too or replay/simulator requests escape to the real network
const functionsAxios = require(require.resolve('axios', {
    paths: [path.resolve(__dirname, '../functions')]}));

const {FakeFirestore} = require('./fakes');
const functionsStub = require('firebase-functions');
const TeamArena = require('../functions/src/util/TeamArena.js');
const deserializeReplay = require(
    '../functions/src/util/ReplayDeserializer');
const simulator = require('../functions/src/util/simulator');
const {
  DoublesPairingStrategy, EventFormat, EventStatus, EventType, GameStatus,
} = require('../types');
const {isTeamArena, normalizeEventTeam, rankArenaTeams,
    validateTeamArenaConfig} = require('../team-arena');
const {handleArenaEventUpdate} = require(
    '../functions/src/events/arena');
const {TeamArenaService} = require(
    '../src/app/services/team-arena.service');
const {EventService} = require(
    '../src/app/services/event.service');
const {GeneralsService} = require(
    '../src/app/services/generals.service');
const {ArenaQueueComponent} = require(
    '../src/app/components/arena-queue/arena-queue.component.ts');
const {EventTrophiesComponent} = require(
    '../src/app/components/event-trophies/event-trophies.component.ts');

// registering the result writers captures their triggers on the stub
global.__testFirestore = new FakeFirestore();
require('../functions/src/events/games/onWrite.ts');
require('../functions/src/events/redirect/onCreate.ts');
const HANDLERS = functionsStub.__handlers;

const BYP = DoublesPairingStrategy.BRING_YOUR_PARTNER;
const RANDOM = DoublesPairingStrategy.RANDOM_PARTNERS;
const READY_TTL_MS = 90 * 1000;

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function player(name, overrides = {}) {
  return {
    name, rank: 0, points: 0, currentStreak: 0, dq: false, record: [],
    ...overrides,
  };
}

function team(id, captain, members, overrides = {}) {
  return {
    id,
    name: `${captain}'s Team`,
    captain,
    members: members.slice(),
    requests: [],
    noShows: [],
    acceptFill: false,
    allowShortHanded: false,
    points: 0,
    games: 0,
    wins: 0,
    participants: [],
    ...overrides,
  };
}

function teamArenaEvent(id, overrides = {}) {
  return {
    id,
    type: EventType.BIG_TEAM,
    format: EventFormat.ARENA,
    visibility: 'Public',
    startTime: Date.now() - 1000,
    endTime: Date.now() + 60 * 60 * 1000,
    teamSize: 2,
    playersPerGame: 4,
    doublesPairingStrategy: BYP,
    server: 'na',
    replays: [],
    playerCount: 0,
    ongoingGameCount: 0,
    completedGameCount: 0,
    arenaTeams: [],
    arenaReady: {},
    arenaQueueAt: {},
    arenaPlaying: [],
    arenaParticipants: [],
    arenaMatchNumber: 0,
    arenaTeamNumber: 0,
    options: {},
    ...overrides,
  };
}

function seedEvent(store, event, players) {
  store.docs.set(`events/${event.id}`, clone(event));
  for (const p of players || []) {
    store.docs.set(`events/${event.id}/players/${p.name}`, clone(p));
  }
}

function makeSnapshot(store, eventId) {
  return {data: () => store.dataAt(`events/${eventId}`),
      ref: store.doc(`events/${eventId}`)};
}

async function expectReject(promise, match, label) {
  try {
    await promise;
  } catch (e) {
    const ok = !match ||
        (match instanceof RegExp ? match.test(String(e.message))
            : String(e.message).includes(match));
    if (!ok) {
      assert.fail(`${label}: rejected with unexpected error: ${e.message}`);
    }
    return e;
  }
  assert.fail(`${label}: expected rejection`);
}

// the client facade routes through the real callable handler; the fake
// AngularFireFunctions passes the caller as context.auth.uid, exactly how
// production identity arrives
const {teamArenaAction} = require('../functions/src/https/callable/team-arena');
function makeService(store, caller) {
  global.__testFirestore = store;
  // Lazerpent is the seeded organizer in every fixture store; the admins
  // doc mirrors production's generals.io/admins names membership
  if (!store.dataAt('generals.io/admins')) {
    seedOrganizer(store, 'Lazerpent');
  }
  return new TeamArenaService({
    httpsCallable: () => data =>
        ({toPromise: () => teamArenaAction(data, {auth: {uid: caller}})}),
  });
}

function seedOrganizer(store, name) {
  const existing = store.dataAt('generals.io/admins') || {names: []};
  store.docs.set('generals.io/admins',
      {names: [...new Set([...existing.names, name])]});
}

function makeEventService(store, caller) {
  global.__testFirestore = store;
  return new EventService(store, {name: caller}, makeService(store, caller));
}

// ------------------------------------------------- replay fixtures ------

// sequential field order consumed by ReplayDeserializer.js (same layout as
// modifier-options.test.js): afk entries serialize as [playerIndex, turn]
function makeReplayFields(overrides = {}) {
  const fields = [
    20, 'fixture', 4, 4, ['P0', 'P1'], [0, 0], [], [], [0, 8], [], [],
    [[1, 5]], null, null, [], [], [], [], [1, 2], [],
    [1, 0.4, 0.5, 0.1, -1, -1, 0, 0, 0], null, [], [], [], [0, 0], null,
    null, null, null, null, null, null, null, null, null, null, null,
  ];
  const data = fields.slice();
  data[4] = overrides.usernames || ['P0', 'P1'];
  data[8] = overrides.generals || [0, 8];
  data[10] = overrides.moves || [];
  data[11] = overrides.afks !== undefined ? overrides.afks : [[1, 5]];
  data[12] = overrides.teams !== undefined ? overrides.teams : null;
  data[21] = overrides.modifiers !== undefined ? overrides.modifiers : null;
  return data;
}

function compressReplay(fields) {
  return Buffer.from(
      LZString.compressToUint8Array(JSON.stringify(fields)));
}

// a 6-player team arena replay: teams a=[a0,a1], b=[b0,b1], c=[c0,c1];
// team c surrenders on turn 10, team b on turn 20, team a wins
const TA_USERNAMES = ['a0', 'a1', 'b0', 'b1', 'c0', 'c1'];
const TA_TEAMS = [1, 1, 2, 2, 3, 3];
const TA_REPLAY = compressReplay(makeReplayFields({
  id: 'replay-ta',
  usernames: TA_USERNAMES,
  generals: [0, 3, 12, 15, 4, 7],
  afks: [[4, 10], [5, 10], [2, 20], [3, 20]],
  teams: TA_TEAMS,
}));

const TA_GAME_TEAMS = [
  {id: 'team_a', name: 'A Team', players: ['a0', 'a1']},
  {id: 'team_b', name: 'B Team', players: ['b0', 'b1']},
  {id: 'team_c', name: 'C Team', players: ['c0', 'c1']},
];

const ADV_USERNAMES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const ADV_REPLAY = compressReplay(makeReplayFields({
  id: 'replay-adv',
  usernames: ADV_USERNAMES,
  generals: [5, 14, 6, 8, 9, 15],
  moves: [
    [2, 6, 7, 0, 4], [2, 6, 7, 0, 8], [2, 6, 7, 0, 12], [2, 6, 7, 0, 16],
    [2, 6, 7, 0, 20],
    [0, 5, 6, 0, 22],
    [0, 5, 6, 0, 24], [1, 14, 13, 0, 24],
    [1, 14, 13, 0, 28],
    [0, 5, 6, 0, 30],
    [1, 14, 13, 0, 32],
    [0, 5, 6, 0, 36], [1, 14, 13, 0, 36],
    [1, 14, 13, 0, 40],
    [0, 5, 6, 0, 42], [5, 15, 14, 0, 42],
    [3, 8, 12, 0, 44],
    [0, 5, 6, 0, 48],
    [3, 8, 12, 0, 50],
    [0, 5, 6, 0, 54],
    [3, 8, 12, 0, 56],
    [0, 5, 6, 0, 60],
    [3, 8, 12, 0, 62], [4, 9, 5, 0, 62],
    [3, 8, 12, 0, 66],
    [3, 8, 12, 0, 70],
    [4, 9, 8, 0, 72],
  ],
  afks: [],
  teams: [1, 1, 2, 2, 3, 3],
}));
const ADV_GAME_TEAMS = [
  {id: '0', name: 'A Team', players: ['A1', 'A2']},
  {id: '1', name: 'B Team', players: ['B1', 'B2']},
  {id: '2', name: 'C Team', players: ['C1', 'C2']},
];

const EARLY_USERNAMES = ['A0', 'A1', 'B0', 'B1'];
const EARLY_REPLAY = compressReplay(makeReplayFields({
  id: 'replay-early',
  usernames: EARLY_USERNAMES,
  generals: [0, 15, 1, 8],
  moves: [
    [0, 0, 4, 0, 4], [0, 0, 4, 0, 6], [0, 0, 4, 0, 8],
    [2, 1, 0, 0, 10],
  ],
  afks: [[2, 20], [3, 20]],
  teams: [1, 1, 2, 2],
}));
const EARLY_GAME_TEAMS = [
  {id: 'team_a', name: 'A Team', players: ['A0', 'A1']},
  {id: 'team_b', name: 'B Team', players: ['B0', 'B1']},
];

// --------------------------------------------------- axios interception -

let replayListResponse = [];

// invoked with the replay id each time the stubbed .gior fetch resolves;
// lets a test simulate a concurrent claim landing between the replay
// metadata lookup and the commit transaction
let onReplayFetch = () => {};

function stubAxios() {
  onReplayFetch = () => {};
  const fakeGet = url => {
    if (url.endsWith('.gior')) {
      const id = url.slice(url.lastIndexOf('/') + 1, -'.gior'.length);
      const buffers = {
        'replay-ta': TA_REPLAY,
        'replay-claimed': TA_REPLAY,
        'replay-adv': ADV_REPLAY,
        'replay-early': EARLY_REPLAY,
      };
      if (!buffers[id]) {
        return Promise.reject(new Error(`unstubbed replay ${id}`));
      }
      onReplayFetch(id);
      return Promise.resolve({data: buffers[id]});
    }
    if (url.includes('replaysForUsername')) {
      return Promise.resolve({data: replayListResponse});
    }
    return Promise.resolve({data: []});
  };
  axios.get = fakeGet;
  axios.default.get = fakeGet;
  functionsAxios.get = fakeGet;
  functionsAxios.default.get = fakeGet;
}

// --------------------------------------------------- unit: contracts ----

function testDetectionAndConfig() {
  assert.ok(isTeamArena({format: EventFormat.ARENA, type: EventType.BIG_TEAM}));
  assert.ok(isTeamArena({format: EventFormat.ARENA, type: EventType.TWO_VS_TWO}));
  assert.ok(!isTeamArena({format: EventFormat.ARENA, type: EventType.FFA}));
  assert.ok(!isTeamArena({format: EventFormat.DOUBLE_ELIM,
      type: EventType.BIG_TEAM}));
  assert.ok(!isTeamArena({format: EventFormat.DYNAMIC_DYP,
      type: EventType.TWO_VS_TWO}));
  assert.ok(!isTeamArena(null) && !isTeamArena({}));

  // every legal boundary: teamSize 2..8, gameSize = 2..(16/teamSize) teams
  for (let teamSize = 2; teamSize <= 8; teamSize++) {
    for (let players = teamSize * 2; players <= 16; players += teamSize) {
      validateTeamArenaConfig({
        format: EventFormat.ARENA, type: EventType.BIG_TEAM, teamSize,
        playersPerGame: players, doublesPairingStrategy: BYP,
      });
    }
    // out-of-range game sizes reject
    for (const bad of [teamSize, teamSize * 2 - 1, 17 + teamSize,
        teamSize * 2 + 1]) {
      assert.throws(() => validateTeamArenaConfig({
        format: EventFormat.ARENA, type: EventType.BIG_TEAM, teamSize,
        playersPerGame: bad, doublesPairingStrategy: BYP,
      }), /multiple|2-16/i,
          `teamSize ${teamSize} gameSize ${bad} rejected`);
    }
  }

  // illegal non-multiple: 4 players on teams of 3
  assert.throws(() => validateTeamArenaConfig({
    format: EventFormat.ARENA, type: EventType.BIG_TEAM, teamSize: 3,
    playersPerGame: 4, doublesPairingStrategy: BYP,
  }), /multiple/i);

  // missing or bogus pairing strategies reject
  for (const strategy of [undefined, 'Dynamic DYP', '']) {
    assert.throws(() => validateTeamArenaConfig({
      format: EventFormat.ARENA, type: EventType.BIG_TEAM, teamSize: 2,
      playersPerGame: 4, doublesPairingStrategy: strategy,
    }), /partners/i);
  }

  // a configured 2v2 is exactly two teams of two
  validateTeamArenaConfig({
    format: EventFormat.ARENA, type: EventType.TWO_VS_TWO, teamSize: 2,
    playersPerGame: 4, doublesPairingStrategy: RANDOM,
  });
  assert.throws(() => validateTeamArenaConfig({
    format: EventFormat.ARENA, type: EventType.TWO_VS_TWO, teamSize: 3,
    playersPerGame: 6, doublesPairingStrategy: BYP,
  }), /2v2/i);
  console.log('  detection and config passed');
}

function testNormalizeLobby() {
  const lobby = normalizeEventTeam({
    version: 1, teamSize: 2, gameSize: 6,
    teams: [['a', 'b'], ['c'], ['d', 'e']],
  });
  assert.deepStrictEqual(lobby, {
    version: 1, teamSize: 2, gameSize: 6,
    teams: [['a', 'b'], ['c'], ['d', 'e']],
  }, 'short-handed rosters normalize');
  assert.deepStrictEqual(Object.keys(lobby),
      ['version', 'teamSize', 'gameSize', 'teams']);

  for (const bad of [
    // unknown keys reject outright; the wire contract is exact
    {version: 1, teamSize: 2, gameSize: 4,
        teams: [['a', 'b'], ['c', 'd']], extra: 'nope'},
    {version: 2, teamSize: 2, gameSize: 4, teams: [['a', 'b'], ['c', 'd']]},
    {version: 1, teamSize: 2, gameSize: 4, teams: [['a', 'b']]},
    {version: 1, teamSize: 2, gameSize: 4, teams: [['a', 'a'], ['c', 'd']]},
    {version: 1, teamSize: 2, gameSize: 4, teams: [['a', 'b'], ['c', '']]},
    {version: 1, teamSize: 2, gameSize: 4, teams: 'nope'},
    'not an object',
  ]) {
    assert.throws(() => normalizeEventTeam(bad), /roster|team|size|count/i,
        `bad lobby ${JSON.stringify(bad)} rejected`);
  }
  console.log('  normalizeLobby passed');
}

function testAssertReplayTeams() {
  // the frozen permutation: replay player order differs from dispatch
  // order but team ids must map consistently
  const expected = [
    {id: 'a', name: 'A', players: ['a0', 'a1']},
    {id: 'b', name: 'B', players: ['b0', 'b1']},
    {id: 'c', name: 'C', players: ['c0', 'c1']},
  ];
  const replay = {
    usernames: ['b1', 'a0', 'c1', 'a1', 'c0', 'b0'],
    teams: [7, 2, 9, 2, 9, 7],
  };
  TeamArena.assertReplayTeams(replay, expected);

  // swapped team ids across rosters reject
  assert.throws(() => TeamArena.assertReplayTeams({
    usernames: ['b1', 'a0', 'c1', 'a1', 'c0', 'b0'],
    teams: [7, 2, 9, 7, 9, 2],
  }, expected), /team/i);

  // a foreign roster rejects
  assert.throws(() => TeamArena.assertReplayTeams({
    usernames: ['b1', 'a0', 'c1', 'a1', 'c0', 'x0'],
    teams: [7, 2, 9, 2, 9, 7],
  }, expected), /team|player|roster/i);
  console.log('  assertReplayTeams passed');
}

function testScoring() {
  // frozen expectation from the authoritative module
  const teams = [
    {id: 'a', name: 'A', players: ['a0', 'a1']},
    {id: 'b', name: 'B', players: ['b0', 'b1']},
    {id: 'c', name: 'C', players: ['c0', 'c1']},
  ];
  const playerScores = [
    {name: 'a0', killed: ['b0', 'b1', 'a1']},  // friendly a1 must not count
    {name: 'a1', killed: []},
    {name: 'b0', killed: ['c0', 'c1']},
    {name: 'b1', killed: []},
    {name: 'c0', killed: []},
    {name: 'c1', killed: []},
  ];
  const outcomes = [
    {id: 'a', winner: true, eliminatedTurn: null},
    {id: 'b', winner: false, eliminatedTurn: 20},
    {id: 'c', winner: false, eliminatedTurn: 10},
  ];
  const {teams: scoredTeams, scores: scoredPlayers} =
      TeamArena.scoreTeamArena(teams, playerScores, outcomes, 4);
  const byName = new Map(scoredPlayers.map(s => [s.name, s]));

  // [id, rank, points, kills]
  const expectedTeams = [['a', 1, 13, 2], ['b', 2, 5, 2], ['c', 3, 0, 0]];
  for (const [id, rank, points, kills] of expectedTeams) {
    const scoredTeam = scoredTeams.find(t => t.id === id);
    assert.strictEqual(scoredTeam.rank, rank, `${id} rank`);
    assert.strictEqual(scoredTeam.points, points, `${id} points`);
    assert.strictEqual(scoredTeam.kills, kills, `${id} enemy kills`);
    for (const name of teams.find(t => t.id === id).players) {
      const s = byName.get(name);
      assert.strictEqual(s.rank, rank, `${name} shared rank`);
      assert.strictEqual(s.points, points, `${name} shared points`);
      assert.strictEqual(s.teamId, id);
    }
  }
  assert.deepStrictEqual(
      scoredPlayers.map(s => s.points), [13, 13, 5, 5, 0, 0]);

  // ties in elimination turn share the rank
  const tied = TeamArena.scoreTeamArena(teams, playerScores, [
    {id: 'a', winner: true, eliminatedTurn: null},
    {id: 'b', winner: false, eliminatedTurn: 10},
    {id: 'c', winner: false, eliminatedTurn: 10},
  ], 0);
  assert.deepStrictEqual(tied.scores.map(s => s.rank), [1, 1, 2, 2, 2, 2]);

  // frozen lead review expectations: placement points count only teams
  // strictly outlived, so simultaneously-eliminated teams get no credit for
  // outliving each other
  const noKills = playerScores.map(s => ({name: s.name, killed: []}));
  const simultaneous = TeamArena.scoreTeamArena(teams, noKills, [
    {id: 'a', winner: true, eliminatedTurn: null},
    {id: 'b', winner: false, eliminatedTurn: 10},
    {id: 'c', winner: false, eliminatedTurn: 10},
  ], 0);
  assert.deepStrictEqual(
      simultaneous.teams.map(t => [t.id, t.rank, t.points]),
      [['a', 1, 7], ['b', 2, 0], ['c', 2, 0]]);

  const sequential = TeamArena.scoreTeamArena(teams, noKills, [
    {id: 'a', winner: true, eliminatedTurn: null},
    {id: 'b', winner: false, eliminatedTurn: 11},
    {id: 'c', winner: false, eliminatedTurn: 10},
  ], 0);
  assert.deepStrictEqual(
      sequential.teams.map(t => [t.id, t.rank, t.points]),
      [['a', 1, 7], ['b', 2, 1], ['c', 3, 0]]);

  const sharedVictim = TeamArena.scoreTeamArena(teams, [
    {name: 'a0', killed: ['b0']},
    {name: 'a1', killed: ['b0']},
    {name: 'b0', killed: []},
    {name: 'b1', killed: []},
    {name: 'c0', killed: []},
    {name: 'c1', killed: []},
  ], outcomes, 0);
  assert.strictEqual(sharedVictim.teams.find(t => t.id === 'a').kills, 1,
      'a victim captured by two teammates counts once');

  for (const s of scoredPlayers) {
    assert.strictEqual(s.teamCount, 3);
  }

  const twoTeams = [
    {id: 'x', name: 'X', players: ['x0', 'x1']},
    {id: 'y', name: 'Y', players: ['y0', 'y1']},
  ];
  const two = TeamArena.scoreTeamArena(twoTeams, [
    {name: 'x0', killed: ['y0']},
    {name: 'x1', killed: []},
    {name: 'y0', killed: ['x0', 'x1']},
    {name: 'y1', killed: []},
  ], [
    {id: 'x', winner: true, eliminatedTurn: null},
    {id: 'y', winner: false, eliminatedTurn: 30},
  ], 100);
  assert.deepStrictEqual(
      two.teams.map(t => [t.id, t.rank, t.points, t.kills]),
      [['x', 1, 2, 1], ['y', 2, 0, 2]],
      'two-team games score flat base while kills still report');
  assert.deepStrictEqual(two.scores.map(s => s.points), [2, 2, 0, 0]);
  for (const s of two.scores) {
    assert.strictEqual(s.teamCount, 2);
  }

  // ranked team ordering: points, then win rate, then games, then id
  const ranked = rankArenaTeams([
    {...team('t1', 'p1', ['p1', 'p2']), points: 10, games: 4, wins: 2},
    {...team('t2', 'q1', ['q1', 'q2']), points: 10, games: 2, wins: 2},
    {...team('t3', 'r1', ['r1', 'r2']), points: 3, games: 9, wins: 3},
  ]);
  assert.deepStrictEqual(ranked.map(t => t.id), ['t2', 't1', 't3']);
  console.log('  scoring passed');
}

function testTeamOutcomeScoring() {
  const replay = deserializeReplay(ADV_REPLAY);
  const {scores, teamOutcomes} = simulator.simulate(replay, ADV_GAME_TEAMS);
  assert.deepStrictEqual(scores.map(s => s.name),
      ['C1', 'C2', 'A1', 'B2', 'A2', 'B1'],
      'individual order puts killers ahead of survival');
  const outcomeById = new Map(teamOutcomes.map(o => [o.id, o]));
  assert.strictEqual(outcomeById.get('2').winner, true);
  assert.ok(outcomeById.get('1').eliminatedTurn >
      outcomeById.get('0').eliminatedTurn,
      'team B outlived team A even though A1 outranks B2 individually');

  const {teams: scoredTeams, scores: scoredPlayers} =
      TeamArena.scoreTeamArena(ADV_GAME_TEAMS, scores, teamOutcomes, 0);
  assert.deepStrictEqual(scoredTeams.map(t => [t.id, t.rank, t.points]),
      [['2', 1, 10], ['1', 2, 1], ['0', 3, 1]],
      'C: 2 outlived + 3 captures + 5 win; B outlived 1; A captured 1');
  for (const s of scoredPlayers) {
    const expected = ADV_GAME_TEAMS.find(t => t.players.includes(s.name));
    const scored = scoredTeams.find(t => t.id === expected.id);
    assert.strictEqual(s.rank, scored.rank,
        `${s.name} shares its team rank`);
    assert.strictEqual(s.points, scored.points,
        `${s.name} shares the team base`);
    assert.strictEqual(s.teamCount, 3);
  }
  console.log('  team outcome scoring passed');
}

// ------------------------------------------------- service operations ---

async function testTeamLifecycle() {
  const store = new FakeFirestore();
  const event = teamArenaEvent('evt-byp');
  seedEvent(store, event, members4());

  function members4() {
    return [player('alice'), player('bob'), player('carol'), player('dave'),
        player('erin')];
  }

  // createTeam: captain becomes the first member; ids come from the
  // event's monotonic arenaTeamNumber, so they stay unique across
  // captain transfers
  let service = makeService(store, 'alice');
  await service.createTeam('evt-byp', 'Alphas');
  let data = store.dataAt('events/evt-byp');
  assert.strictEqual(data.arenaTeams.length, 1);
  assert.deepStrictEqual(data.arenaTeams[0].members, ['alice']);
  assert.strictEqual(data.arenaTeams[0].captain, 'alice');
  assert.strictEqual(data.arenaTeams[0].id, 'team_1');
  assert.strictEqual(data.arenaTeams[0].name, 'Alphas');
  assert.strictEqual(data.arenaTeamNumber, 1);

  // second team for the second pair
  service = makeService(store, 'carol');
  await service.createTeam('evt-byp', 'Gammas');
  assert.strictEqual(
      store.dataAt('events/evt-byp').arenaTeams[1].id, 'team_2');

  // cannot create a second team while on one
  service = makeService(store, 'alice');
  await expectReject(service.createTeam('evt-byp', 'Nope'),
      'already on a team', 'createTeam on team');

  // unregistered callers cannot create
  service = makeService(store, 'ghost');
  await expectReject(service.createTeam('evt-byp', 'Ghosts'),
      'not registered', 'unregistered createTeam');

  // request + captain accept
  service = makeService(store, 'bob');
  await service.requestTeam('evt-byp', 'team_1');
  data = store.dataAt('events/evt-byp');
  assert.deepStrictEqual(data.arenaTeams[0].requests, ['bob']);

  // non-captains cannot accept
  service = makeService(store, 'bob');
  await expectReject(service.acceptPlayer('evt-byp', 'bob'),
      'captain', 'non-captain accept');

  service = makeService(store, 'alice');
  await service.acceptPlayer('evt-byp', 'bob');
  data = store.dataAt('events/evt-byp');
  assert.deepStrictEqual(data.arenaTeams[0].members, ['alice', 'bob']);
  assert.deepStrictEqual(data.arenaTeams[0].requests, []);

  // capacity: the team is full (teamSize 2), so even requesting rejects
  service = makeService(store, 'dave');
  await expectReject(service.requestTeam('evt-byp', 'team_1'),
      'full', 'request to a full team');
  data = store.dataAt('events/evt-byp');
  assert.deepStrictEqual(data.arenaTeams[0].members, ['alice', 'bob']);

  // captain options: opt into fill and rename
  service = makeService(store, 'carol');
  await service.setTeamOptions('evt-byp',
      {acceptFill: true, name: 'Gammas+'});
  data = store.dataAt('events/evt-byp');
  const gammas = data.arenaTeams.find(t => t.id === 'team_2');
  assert.strictEqual(gammas.acceptFill, true);
  assert.strictEqual(gammas.name, 'Gammas+');

  // a pending request sits on the open team; once it fills by voluntary
  // random join, the captain can no longer accept over capacity
  service = makeService(store, 'dave');
  await service.requestTeam('evt-byp', 'team_2');
  service = makeService(store, 'erin');
  await service.joinRandomTeam('evt-byp');
  data = store.dataAt('events/evt-byp');
  assert.deepStrictEqual(
      data.arenaTeams.find(t => t.id === 'team_2').members,
      ['carol', 'erin']);
  await expectReject(
      makeService(store, 'carol').acceptPlayer('evt-byp', 'dave'),
      'full', 'accept over capacity');

  // with no incomplete opt-in team, random join rejects; teamless players
  // cannot fill a full one
  await expectReject(
      makeService(store, 'erin').joinRandomTeam('evt-byp'),
      'already on a team', 'joinRandomTeam while teamed');
  await expectReject(
      makeService(store, 'dave').joinRandomTeam('evt-byp'),
      'No teams', 'joinRandomTeam with nothing open');

  // no-show handling: captain removes a member, self-mark is rejected
  service = makeService(store, 'alice');
  await expectReject(service.markNoShow('evt-byp', 'alice'),
      'captain', 'self no-show');
  await service.markNoShow('evt-byp', 'bob');
  data = store.dataAt('events/evt-byp');
  const alphas = data.arenaTeams.find(t => t.id === 'team_1');
  assert.deepStrictEqual(alphas.members, ['alice']);
  assert.deepStrictEqual(alphas.noShows, ['bob']);

  // captain leaving transfers the role deterministically to the first
  // remaining member; empty teams disappear entirely
  await service.leaveTeam('evt-byp');
  data = store.dataAt('events/evt-byp');
  assert.ok(!data.arenaTeams.some(t => t.id === 'team_1'),
      'emptied team removed');
  console.log('  team lifecycle passed');
}

async function testReadiness() {
  const store = new FakeFirestore();
  seedEvent(store, teamArenaEvent('evt-ready'), [
    player('a0'), player('a1'), player('b0'), player('b1'),
  ]);
  store.docs.set('events/evt-ready', {
    ...store.dataAt('events/evt-ready'),
    arenaTeams: [
      team('ta', 'a0', ['a0', 'a1']),
      team('tb', 'b0', ['b0', 'b1']),
    ],
  });

  // BYP readiness needs a team
  const solo = new FakeFirestore();
  seedEvent(solo, teamArenaEvent('evt-solo'), [player('lone')]);
  await expectReject(
      makeService(solo, 'lone').setReady('evt-solo', true),
      'team', 'unassigned BYP ready');

  // incomplete teams cannot ready without the short-handed opt-in
  const short = new FakeFirestore();
  seedEvent(short, teamArenaEvent('evt-short', {teamSize: 4,
      playersPerGame: 8}), [player('s0'), player('s1'), player('s2')]);
  store.short = short;
  short.docs.set('events/evt-short', {
    ...short.dataAt('events/evt-short'),
    arenaTeams: [team('ts', 's0', ['s0', 's1', 's2'])],
  });
  await expectReject(
      makeService(short, 's0').setReady('evt-short', true),
      /full|short/, 'incomplete team ready');

  // everyone readies; the freshness timestamps land under arenaReady and
  // the queue positions under arenaQueueAt
  for (const name of ['a0', 'a1', 'b0', 'b1']) {
    await makeService(store, name).setReady('evt-ready', true);
  }
  let data = store.dataAt('events/evt-ready');
  assert.strictEqual(Object.keys(data.arenaReady).length, 4);
  assert.strictEqual(Object.keys(data.arenaQueueAt).length, 4);
  for (const name of ['a0', 'a1', 'b0', 'b1']) {
    assert.ok(Number.isFinite(data.arenaReady[name]));
    assert.ok(Number.isFinite(data.arenaQueueAt[name]));
  }

  // a heartbeat while still fresh renews the timestamp but keeps the queue
  // position; a team's place in line cannot move by re-confirming
  const stalePos = Date.now() - 5000;
  store.docs.set('events/evt-ready', {
    ...data,
    arenaReady: {...data.arenaReady, a0: Date.now() - 3000},
    arenaQueueAt: {...data.arenaQueueAt, a0: stalePos},
  });
  await makeService(store, 'a0').setReady('evt-ready', true);
  data = store.dataAt('events/evt-ready');
  assert.ok(data.arenaReady.a0 > Date.now() - 2000,
      'freshness timestamp renewed');
  assert.strictEqual(data.arenaQueueAt.a0, stalePos,
      'queue position preserved across heartbeat');

  // taking one member off ready unqueues the whole team: all confirmations
  // and queue positions for that team are revoked so everyone must
  // re-confirm the next game
  await makeService(store, 'a0').setReady('evt-ready', false);
  data = store.dataAt('events/evt-ready');
  assert.ok(data.arenaReady.a0 === undefined &&
      data.arenaReady.a1 === undefined, 'team a readiness revoked');
  assert.ok(data.arenaQueueAt.a0 === undefined &&
      data.arenaQueueAt.a1 === undefined, 'team a queue positions revoked');
  assert.ok(Number.isFinite(data.arenaReady.b0) &&
      Number.isFinite(data.arenaReady.b1), 'team b untouched');

  // unreadying is allowed after the event ends so stale confirmations can
  // always be cleared
  const ended = new FakeFirestore();
  seedEvent(ended, teamArenaEvent('evt-ended', {
    startTime: Date.now() - 7200000, endTime: Date.now() - 3600000,
  }), [player('late')]);
  await makeService(ended, 'late').setReady('evt-ended', false);

  // readiness is rejected outside the event window
  const closed = new FakeFirestore();
  seedEvent(closed, teamArenaEvent('evt-closed', {
    startTime: Date.now() - 7200000, endTime: Date.now() - 3600000,
  }), [player('late')]);
  await expectReject(
      makeService(closed, 'late').setReady('evt-closed', true),
      'running', 'ready after end');
  console.log('  readiness passed');
}

// ------------------------------------------------- matchmaking ----------

// first-ready: stamps both the freshness timestamp and the immutable queue
// position, the way TeamArenaService.setReady does for a first confirm
function readyAll(store, eventId, names, at = Date.now()) {
  const event = store.dataAt(`events/${eventId}`);
  const arenaReady = {...event.arenaReady};
  const arenaQueueAt = {...event.arenaQueueAt};
  for (const name of names) {
    arenaReady[name] = at;
    if (!Number.isFinite(arenaQueueAt[name])) {
      arenaQueueAt[name] = at;
    }
  }
  store.docs.set(`events/${eventId}`, {...event, arenaReady, arenaQueueAt});
}

// a heartbeat only refreshes the freshness timestamp; the queue position
// never moves
function heartbeat(store, eventId, names) {
  const event = store.dataAt(`events/${eventId}`);
  const arenaReady = {...event.arenaReady};
  for (const name of names) {
    arenaReady[name] = Date.now();
  }
  store.docs.set(`events/${eventId}`, {...event, arenaReady});
}

async function dispatch(store, eventId) {
  global.__testFirestore = store;
  return handleArenaEventUpdate(makeSnapshot(store, eventId));
}

async function testBypDispatch() {
  const store = new FakeFirestore();
  seedEvent(store, teamArenaEvent('evt1'), [
    player('a0'), player('a1'), player('b0'), player('b1'),
    player('c0'), player('c1'),
  ]);
  store.docs.set('events/evt1', {
    ...store.dataAt('events/evt1'),
    arenaTeams: [
      team('ta', 'a0', ['a0', 'a1']),
      team('tb', 'b0', ['b0', 'b1']),
      team('tc', 'c0', ['c0', 'c1']),
    ],
  });

  // one fully-ready team is not enough for a 4-player game
  readyAll(store, 'evt1', ['a0', 'a1']);
  await dispatch(store, 'evt1');
  assert.strictEqual(store.dataAt('events/evt1').arenaMatchNumber, 0,
      'no dispatch below a full game');

  // the second team completes the game; the third team is also ready but
  // waits for the next dispatch
  readyAll(store, 'evt1', ['b0', 'b1', 'c0', 'c1']);
  await dispatch(store, 'evt1');

  const event = store.dataAt('events/evt1');
  assert.strictEqual(event.arenaMatchNumber, 1);
  assert.strictEqual(event.ongoingGameCount, 1);
  assert.deepStrictEqual(event.arenaPlaying.sort(), ['a0', 'a1', 'b0', 'b1']);
  assert.deepStrictEqual(event.arenaParticipants.sort(),
      ['a0', 'a1', 'b0', 'b1']);
  // dispatched players' readiness is consumed; the waiting team's survives
  assert.deepStrictEqual(event.arenaReady, {c0: event.arenaReady.c0,
      c1: event.arenaReady.c1});

  const game = store.dataAt('events/evt1/games/game_1');
  assert.strictEqual(game.status, GameStatus.STARTED);
  assert.strictEqual(game.lobby, 'event_team_evt1_1');
  assert.deepStrictEqual(game.players, ['a0', 'a1', 'b0', 'b1']);
  assert.deepStrictEqual(game.eventTeam, TeamArena.storeLobby({
    version: 1, teamSize: 2, gameSize: 4,
    teams: [['a0', 'a1'], ['b0', 'b1']],
  }));

  const redirect = store.dataAt('events/evt1/redirect/game_1');
  assert.strictEqual(redirect.lobby, 'event_team_evt1_1');
  assert.strictEqual(redirect.gameId, 'game_1');
  assert.deepStrictEqual(redirect.players, ['a0', 'a1', 'b0', 'b1'],
      'the mutable ack list starts with every dispatched player');

  // fixed-team participants recorded on the standing team records
  const ta = event.arenaTeams.find(t => t.id === 'ta');
  assert.deepStrictEqual(ta.participants, ['a0', 'a1']);

  // a game in flight locks its players: another trigger only dispatches
  // when a second complete pair readies
  await dispatch(store, 'evt1');
  assert.strictEqual(store.dataAt('events/evt1').arenaMatchNumber, 1,
      'busy teams are not re-dispatched');

  readyAll(store, 'evt1', ['d0', 'd1']);
  // d0/d1 are unregistered -> their team could never form; register them
  // first and show unregistered readiness does not count
  await dispatch(store, 'evt1');
  assert.strictEqual(store.dataAt('events/evt1').arenaMatchNumber, 1,
      'unregistered ready players are not counted');

  // the queued team must personally re-confirm for the next game; stale
  // confirmations consumed by the dispatch cannot re-queue them
  store.docs.set('events/evt1', {
    ...store.dataAt('events/evt1'),
    arenaPlaying: [],
    arenaReady: {},
  });
  await dispatch(store, 'evt1');
  assert.strictEqual(store.dataAt('events/evt1').arenaMatchNumber, 1,
      'fresh readiness required for the next game');

  // expiry: confirmations older than the TTL do not queue a team
  const stale = store.dataAt('events/evt1');
  stale.arenaReady = {a0: Date.now() - READY_TTL_MS - 1,
      a1: Date.now(), b0: Date.now(), b1: Date.now()};
  store.docs.set('events/evt1', stale);
  await dispatch(store, 'evt1');
  assert.strictEqual(store.dataAt('events/evt1').arenaMatchNumber, 1,
      'expired readiness does not queue');
  console.log('  byp dispatch passed');
}

async function testShortHanded() {
  const store = new FakeFirestore();
  seedEvent(store, teamArenaEvent('evt-short', {
    teamSize: 4, playersPerGame: 8,
  }), [player('a0'), player('a1'), player('a2'), player('a3'),
      player('b0'), player('b1'), player('b2')]);
  store.docs.set('events/evt-short', {
    ...store.dataAt('events/evt-short'),
    arenaTeams: [
      team('ta', 'a0', ['a0', 'a1', 'a2', 'a3']),
      // a no-show left team b at 3-of-4, opted into playing short
      team('tb', 'b0', ['b0', 'b1', 'b2'],
          {allowShortHanded: true, noShows: ['b3']}),
    ],
  });
  readyAll(store, 'evt-short',
      ['a0', 'a1', 'a2', 'a3', 'b0', 'b1', 'b2']);
  await dispatch(store, 'evt-short');

  const game = store.dataAt('events/evt-short/games/game_1');
  assert.ok(game, 'short-handed dispatch happened');
  assert.deepStrictEqual(TeamArena.loadLobby(game.eventTeam).teams,
      [['a0', 'a1', 'a2', 'a3'], ['b0', 'b1', 'b2']],
      'actual short roster preserved, nominal gameSize stays 8');
  assert.strictEqual(game.eventTeam.gameSize, 8);

  // without the explicit opt-in the incomplete team cannot dispatch
  const store2 = new FakeFirestore();
  seedEvent(store2, teamArenaEvent('evt2', {
    teamSize: 4, playersPerGame: 8,
  }), [player('a0'), player('a1'), player('a2'), player('a3'),
      player('b0'), player('b1'), player('b2')]);
  store2.docs.set('events/evt2', {
    ...store2.dataAt('events/evt2'),
    arenaTeams: [
      team('ta', 'a0', ['a0', 'a1', 'a2', 'a3']),
      team('tb', 'b0', ['b0', 'b1', 'b2']),
    ],
  });
  readyAll(store2, 'evt2', ['a0', 'a1', 'a2', 'a3', 'b0', 'b1', 'b2']);
  await dispatch(store2, 'evt2');
  assert.strictEqual(store2.dataAt('events/evt2').arenaMatchNumber, 0,
      'incomplete team without opt-in never queues');
  console.log('  short-handed dispatch passed');
}

async function testRandomPartners() {
  const store = new FakeFirestore();
  seedEvent(store, teamArenaEvent('evt-rand', {
    doublesPairingStrategy: RANDOM,
  }), [player('p0'), player('p1'), player('p2'), player('p3'),
      player('p4')]);

  // individuals ready independently; 5th player waits for the next game
  readyAll(store, 'evt-rand', ['p0', 'p1', 'p2', 'p3', 'p4']);
  await dispatch(store, 'evt-rand');

  const event = store.dataAt('events/evt-rand');
  assert.strictEqual(event.arenaMatchNumber, 1);

  const game = store.dataAt('events/evt-rand/games/game_1');
  assert.strictEqual(game.players.length, 4);
  assert.strictEqual(game.eventTeam.teamSize, 2);
  // every dispatched roster is exactly teamSize: nobody is split mid-team
  for (const roster of TeamArena.loadLobby(game.eventTeam).teams) {
    assert.strictEqual(roster.length, 2);
  }
  // the leftover player stays ready for the next game
  const left = ['p0', 'p1', 'p2', 'p3', 'p4'].filter(
      p => !game.players.includes(p));
  assert.strictEqual(left.length, 1);
  assert.ok(Number.isFinite(event.arenaReady[left[0]]),
      'undispatched player keeps their readiness');
  console.log('  random partners passed');
}

async function testConcurrentDispatch() {
  const store = new FakeFirestore();
  seedEvent(store, teamArenaEvent('evt-race'), [
    player('a0'), player('a1'), player('b0'), player('b1'),
  ]);
  store.docs.set('events/evt-race', {
    ...store.dataAt('events/evt-race'),
    arenaTeams: [
      team('ta', 'a0', ['a0', 'a1']),
      team('tb', 'b0', ['b0', 'b1']),
    ],
  });
  readyAll(store, 'evt-race', ['a0', 'a1', 'b0', 'b1']);

  // two triggers racing on the same state must produce exactly one game:
  // the serialized transaction forces the loser to observe the committed
  // dispatch and find the players already locked
  await Promise.all([dispatch(store, 'evt-race'), dispatch(store, 'evt-race')]);
  const event = store.dataAt('events/evt-race');
  assert.strictEqual(event.arenaMatchNumber, 1, 'exactly one dispatch');
  assert.strictEqual(event.ongoingGameCount, 1,
      'counter incremented exactly once');
  assert.ok(!store.dataAt('events/evt-race/games/game_2'),
      'no duplicate game doc');

  // a queued player cannot mutate a team that is in a game or queued
  const busy = makeService(store, 'a0');
  await expectReject(busy.leaveTeam('evt-race'), 'game', 'leave while playing');
  // heartbeat while already playing: an idempotent no-op - the caller was
  // dispatched between the client's stale snapshot and this call, so the
  // renewal must neither error nor write a queue slot
  const invocationsBefore = store.invocations.length;
  const before = clone(store.dataAt('events/evt-race'));
  await busy.setReady('evt-race', true);
  const after = store.dataAt('events/evt-race');
  assert.strictEqual(store.invocations.length, invocationsBefore,
      'no write issued for a playing caller heartbeat');
  assert.strictEqual(after.arenaReady['a0'], before.arenaReady['a0'],
      'no ready timestamp mutation while playing');
  assert.strictEqual(after.arenaQueueAt['a0'], before.arenaQueueAt['a0'],
      'no queue slot granted while playing');
  console.log('  heartbeat while already playing passed');
  console.log('  concurrent dispatch passed');
}

// ------------------------------------------------- result writer --------

async function testTeamArenaWriter() {
  const handler = 'events/{eventId}/games/{gameId}';
  assert.ok(HANDLERS[handler]?.onWrite, 'games onWrite registered');

  const store = new FakeFirestore();
  global.__testFirestore = store;
  stubAxios();

  // a fully-scored game: the event was dispatched by the matcher, the
  // replay shows team a winning
  const event = teamArenaEvent('evtW', {
    arenaTeams: [
      team('team_a', 'a0', ['a0', 'a1'], {name: 'A Team'}),
      team('team_b', 'b0', ['b0', 'b1'], {name: 'B Team'}),
      team('team_c', 'c0', ['c0', 'c1'], {name: 'C Team'}),
    ],
    arenaPlaying: TA_USERNAMES.slice(),
    arenaParticipants: TA_USERNAMES.slice(),
    arenaMatchNumber: 1,
    ongoingGameCount: 1,
    playersPerGame: 6,
  });
  seedEvent(store, event, TA_USERNAMES.map(name => player(name)));
  store.docs.set('events/evtW/games/game_1', {
    players: TA_USERNAMES.slice(),
    arenaTeams: clone(TA_GAME_TEAMS),
    eventTeam: TeamArena.storeLobby({
      version: 1, teamSize: 2, gameSize: 6,
      teams: [['a0', 'a1'], ['b0', 'b1'], ['c0', 'c1']],
    }),
    lobby: 'event_team_evtW_1',
    started: 1000000,
    status: GameStatus.STARTED,
    timesChecked: 0,
    // dispatch-time option snapshot: the event's mutable copy can be
    // edited later without invalidating this game's contract
    options: {speed: '1x'},
    server: 'na',
  });
  store.docs.set('events/evtW/redirect/game_1', {
    players: TA_USERNAMES.slice(),
    arenaTeams: clone(TA_GAME_TEAMS),
    eventTeam: TeamArena.storeLobby({version: 1, teamSize: 2, gameSize: 6,
        teams: [['a0', 'a1'], ['b0', 'b1'], ['c0', 'c1']]}),
    gameId: 'game_1', lobby: 'event_team_evtW_1', started: 1000000,
  });

  // editing the event's options between dispatch and scoring cannot
  // invalidate the dispatched contract
  store.docs.set('events/evtW', {
    ...store.dataAt('events/evtW'),
    options: {modifiers: [9]},  // would fail validation if consulted
  });

  // every player's recent replays report the same game, started after the
  // lobby was created, with the exact dispatched roster
  replayListResponse = [{
    id: 'replay-ta', started: 2000000,
    ranking: TA_USERNAMES.map(name => ({name})),
  }];

  const gameRef = store.doc('events/evtW/games/game_1');
  const snap = await gameRef.get();
  await HANDLERS[handler].onWrite(
      {before: {exists: false}, after: snap}, {params: {}});

  const game = store.dataAt('events/evtW/games/game_1');
  assert.strictEqual(game.status, GameStatus.FINISHED);
  assert.strictEqual(game.replayId, 'replay-ta');
  assert.ok(!store.dataAt('events/evtW/redirect/game_1'),
      'consumed redirect deleted with the score transaction');
  assert.ok(game.replay.teamOutcomes, 'team outcomes persisted');
  const outcomeA = game.replay.teamOutcomes.find(o => o.id === 'team_a');
  assert.strictEqual(outcomeA.winner, true);

  // team totals applied once: a=shared placement 2 + 5 win, b=1, c=0
  const after = store.dataAt('events/evtW');
  const teamA = after.arenaTeams.find(t => t.id === 'team_a');
  const teamB = after.arenaTeams.find(t => t.id === 'team_b');
  const teamC = after.arenaTeams.find(t => t.id === 'team_c');
  assert.strictEqual(teamA.games, 1);
  assert.strictEqual(teamA.wins, 1);
  assert.strictEqual(teamA.points, 7, 'a: 2 placement + 5 win, duration 0');
  assert.strictEqual(teamB.points, 1, 'b outlived one team');
  assert.strictEqual(teamC.points, 0);
  assert.deepStrictEqual(teamA.participants, ['a0', 'a1']);

  // event counters and the roster lock
  assert.strictEqual(after.ongoingGameCount, 0);
  assert.strictEqual(after.completedGameCount, 1);
  assert.deepStrictEqual(after.arenaPlaying, []);
  assert.deepStrictEqual(after.replays, ['replay-ta']);

  // every participant got the shared team points and a tagged record
  for (const [name, points] of [['a0', 7], ['a1', 7], ['b0', 1], ['b1', 1],
      ['c0', 0], ['c1', 0]]) {
    const doc = store.dataAt(`events/evtW/players/${name}`);
    assert.strictEqual(doc.points, points, `${name} shared team points`);
    assert.strictEqual(doc.record.length, 1);
    assert.strictEqual(doc.record[0].teamId,
        `team_${name[0]}`, `${name} record carries its team id`);
    assert.ok(store.dataAt(`events/evtW/records/replay-ta_${name}`),
        `${name} record doc written`);
  }

  // retry safety: replaying the same write does not double-apply
  const snap2 = await gameRef.get();
  await HANDLERS[handler].onWrite(
      {before: {exists: true}, after: snap2}, {params: {}});
  const again = store.dataAt('events/evtW');
  assert.strictEqual(again.completedGameCount, 1, 'counters unchanged');
  assert.strictEqual(
      again.arenaTeams.find(t => t.id === 'team_a').points, 7,
      'team points not double-applied');
  assert.strictEqual(store.dataAt('events/evtW/players/a0').points, 7,
      'player points not double-applied');
  console.log('  result writer passed');
}

async function testTwoTeamArenaWriter() {
  const handler = 'events/{eventId}/games/{gameId}';
  const store = new FakeFirestore();
  global.__testFirestore = store;
  stubAxios();

  const event = teamArenaEvent('evt2', {
    arenaTeams: [
      team('team_a', 'A0', ['A0', 'A1'], {name: 'A Team'}),
      team('team_b', 'B0', ['B0', 'B1'], {name: 'B Team'}),
    ],
    arenaPlaying: EARLY_USERNAMES.slice(),
    arenaParticipants: EARLY_USERNAMES.slice(),
    arenaMatchNumber: 1,
    ongoingGameCount: 1,
  });
  seedEvent(store, event, [
    player('A0', {
      points: 4,
      currentStreak: 2,
      record: [
        {name: 'A0', kills: 0, rank: 1, points: 2, lastTurn: 10,
          tilesAfterFirstRound: 1, streak: false, teamCount: 2,
          started: 100, finished: 200, replayId: 'w1'},
        {name: 'A0', kills: 0, rank: 1, points: 2, lastTurn: 10,
          tilesAfterFirstRound: 1, streak: false, teamCount: 2,
          started: 300, finished: 400, replayId: 'w2'},
      ],
    }),
    player('A1', {
      points: 4,
      currentStreak: 2,
      record: [
        {name: 'A1', kills: 0, rank: 1, points: 2, lastTurn: 10,
          tilesAfterFirstRound: 1, streak: false, teamCount: 2,
          started: 100, finished: 200, replayId: 'w1'},
        {name: 'A1', kills: 0, rank: 1, points: 2, lastTurn: 10,
          tilesAfterFirstRound: 1, streak: false, teamCount: 2,
          started: 300, finished: 400, replayId: 'w2'},
      ],
    }),
    player('B0'), player('B1'),
  ]);
  store.docs.set('events/evt2/games/game_1', {
    players: EARLY_USERNAMES.slice(),
    arenaTeams: clone(EARLY_GAME_TEAMS),
    lobby: 'event_team_evt2_1',
    started: 1000000,
    status: GameStatus.STARTED,
    timesChecked: 0,
    options: {speed: '1x'},
    server: 'na',
  });
  store.docs.set('events/evt2/redirect/game_1', {
    players: EARLY_USERNAMES.slice(),
    arenaTeams: clone(EARLY_GAME_TEAMS),
    gameId: 'game_1', lobby: 'event_team_evt2_1', started: 1000000,
  });

  replayListResponse = [{
    id: 'replay-early', started: 2000000,
    ranking: EARLY_USERNAMES.map(name => ({name})),
  }];

  const gameRef = store.doc('events/evt2/games/game_1');
  await HANDLERS[handler].onWrite(
      {before: {exists: false}, after: await gameRef.get()}, {params: {}});

  const game = store.dataAt('events/evt2/games/game_1');
  assert.strictEqual(game.status, GameStatus.FINISHED);
  const outcomeA = game.replay.teamOutcomes.find(o => o.id === 'team_a');
  assert.strictEqual(outcomeA.winner, true, 'real team outcome wins for A');
  assert.strictEqual(game.replay.scores[0].name, 'B0',
      'the losing dead killer still tops the individual leaderboard');
  const scoredA0 = game.replay.scores.find(s => s.name === 'A0');
  assert.strictEqual(scoredA0.rank, 1,
      'earlier-dead teammate shares the win');
  assert.strictEqual(scoredA0.points, 4,
      'replay detail carries the personal streak award');
  assert.strictEqual(scoredA0.streak, true);
  assert.strictEqual(scoredA0.teamCount, 2);
  const scoredA1 = game.replay.scores.find(s => s.name === 'A1');
  assert.strictEqual(scoredA1.points, 4,
      'both partners earn the doubled award together');
  assert.strictEqual(scoredA1.streak, true);

  const after = store.dataAt('events/evt2');
  const teamA = after.arenaTeams.find(t => t.id === 'team_a');
  const teamB = after.arenaTeams.find(t => t.id === 'team_b');
  assert.strictEqual(teamA.points, 4,
      'standing team gains the shared streak award once');
  assert.strictEqual(teamA.wins, 1);
  assert.strictEqual(teamB.points, 0);

  const a0 = store.dataAt('events/evt2/players/A0');
  assert.strictEqual(a0.points, 8, '2 + 2 + a doubled 4');
  assert.strictEqual(a0.currentStreak, 3);
  const latest = a0.record.find(r => r.replayId === 'replay-early');
  assert.strictEqual(latest.points, 4);
  assert.strictEqual(latest.streak, true);
  assert.strictEqual(latest.teamCount, 2);
  assert.strictEqual(latest.teamId, 'team_a');
  assert.strictEqual(latest.finished, 2000000 + 5 * 1000,
      'an early-dead teammate keeps its real death finish');

  const a1 = store.dataAt('events/evt2/players/A1');
  assert.strictEqual(a1.points, 8);
  assert.strictEqual(a1.currentStreak, 3);
  assert.strictEqual(
      a1.record.find(r => r.replayId === 'replay-early').points, 4);
  for (const name of ['B0', 'B1']) {
    const loser = store.dataAt(`events/evt2/players/${name}`);
    assert.strictEqual(loser.points, 0);
    assert.strictEqual(loser.currentStreak, 0);
    assert.strictEqual(loser.record[0].teamCount, 2);
  }

  const recordDoc = store.dataAt('events/evt2/records/replay-early_A0');
  assert.strictEqual(recordDoc.points, 4);
  assert.strictEqual(recordDoc.streak, true);
  console.log('  two-team writer passed');
}

async function testRandomPartnersWriter() {
  const handler = 'events/{eventId}/games/{gameId}';
  const store = new FakeFirestore();
  global.__testFirestore = store;
  stubAxios();

  const event = teamArenaEvent('evtR', {
    doublesPairingStrategy: RANDOM,
    arenaPlaying: EARLY_USERNAMES.slice(),
    arenaParticipants: EARLY_USERNAMES.slice(),
    arenaMatchNumber: 1,
    ongoingGameCount: 1,
  });
  seedEvent(store, event, [
    player('A0', {
      points: 4,
      currentStreak: 2,
      record: [
        {name: 'A0', kills: 0, rank: 1, points: 2, lastTurn: 10,
          tilesAfterFirstRound: 1, streak: false, teamCount: 2,
          started: 100, finished: 200, replayId: 'w1'},
        {name: 'A0', kills: 0, rank: 1, points: 2, lastTurn: 10,
          tilesAfterFirstRound: 1, streak: false, teamCount: 2,
          started: 300, finished: 400, replayId: 'w2'},
      ],
    }),
    player('A1'), player('B0'), player('B1'),
  ]);
  store.docs.set('events/evtR/games/game_1', {
    players: EARLY_USERNAMES.slice(),
    arenaTeams: clone(EARLY_GAME_TEAMS),
    lobby: 'event_team_evtR_1',
    started: 1000000,
    status: GameStatus.STARTED,
    timesChecked: 0,
    options: {speed: '1x'},
    server: 'na',
  });
  store.docs.set('events/evtR/redirect/game_1', {
    players: EARLY_USERNAMES.slice(),
    arenaTeams: clone(EARLY_GAME_TEAMS),
    gameId: 'game_1', lobby: 'event_team_evtR_1', started: 1000000,
  });

  replayListResponse = [{
    id: 'replay-early', started: 2000000,
    ranking: EARLY_USERNAMES.map(name => ({name})),
  }];

  const gameRef = store.doc('events/evtR/games/game_1');
  await HANDLERS[handler].onWrite(
      {before: {exists: false}, after: await gameRef.get()}, {params: {}});

  const after = store.dataAt('events/evtR');
  assert.ok(!after.arenaTeams || after.arenaTeams.length === 0,
      'random-partner games have no standing teams');
  const game = store.dataAt('events/evtR/games/game_1');
  const scoredA0 = game.replay.scores.find(s => s.name === 'A0');
  const scoredA1 = game.replay.scores.find(s => s.name === 'A1');
  assert.strictEqual(scoredA0.points, 4,
      'A0 streaks on its own history even with a fresh partner');
  assert.strictEqual(scoredA0.streak, true);
  assert.strictEqual(scoredA1.points, 2, 'fresh partner earns the base');
  assert.strictEqual(scoredA1.streak, false);

  const a0 = store.dataAt('events/evtR/players/A0');
  assert.strictEqual(a0.points, 8);
  assert.strictEqual(a0.currentStreak, 3);
  const a1 = store.dataAt('events/evtR/players/A1');
  assert.strictEqual(a1.points, 2);
  assert.strictEqual(a1.currentStreak, 1);
  console.log('  random-partner writer passed');
}

async function testWriterTimeout() {
  const handler = 'events/{eventId}/games/{gameId}';
  const store = new FakeFirestore();
  global.__testFirestore = store;
  stubAxios();
  replayListResponse = [];

  // the replay deadline is event.endTime + 20 minutes: a game still
  // inside the grace window keeps looking rather than being cancelled
  const seedGame = (endTime) => {
    const event = teamArenaEvent('evtT', {
      endTime,
      arenaPlaying: ['a0', 'a1', 'b0', 'b1'],
      ongoingGameCount: 1,
      arenaMatchNumber: 1,
    });
    seedEvent(store, event, [player('a0'), player('a1'), player('b0'),
        player('b1')]);
    store.docs.set('events/evtT/games/game_1', {
      players: ['a0', 'a1', 'b0', 'b1'],
      arenaTeams: [
        {id: 'ta', name: 'A', players: ['a0', 'a1']},
        {id: 'tb', name: 'B', players: ['b0', 'b1']},
      ],
      started: 1000, status: GameStatus.STARTED, timesChecked: 0,
    });
    store.docs.set('events/evtT/redirect/game_1', {
      players: ['a0', 'a1', 'b0', 'b1'],
      gameId: 'game_1', lobby: 'event_team_evtT_1', started: 1000,
    });
  };

  // inside the grace window: the trigger reschedules instead of cancelling.
  // stub setTimeout so the 10-second retry interval runs immediately
  seedGame(Date.now() - 60000);  // ended a minute ago, grace still open
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => { fn(); return 0; };
  try {
    const snap = await store.doc('events/evtT/games/game_1').get();
    await HANDLERS[handler].onWrite(
        {before: {exists: true}, after: snap}, {params: {}});
  } finally {
    global.setTimeout = realSetTimeout;
  }
  let game = store.dataAt('events/evtT/games/game_1');
  assert.strictEqual(game.status, GameStatus.STARTED,
      'game inside the grace window is not cancelled');
  assert.strictEqual(store.dataAt('events/evtT').ongoingGameCount, 1);
  assert.strictEqual(game.timesChecked, 1, 'retry counter incremented');

  // at the deadline: the game is cancelled once, players unlocked, and the
  // pending redirect deleted in the same transaction
  seedGame(Date.now() - 21 * 60 * 1000);
  const snap = await store.doc('events/evtT/games/game_1').get();
  await HANDLERS[handler].onWrite(
      {before: {exists: true}, after: snap}, {params: {}});

  const after = store.dataAt('events/evtT');
  game = store.dataAt('events/evtT/games/game_1');
  assert.strictEqual(game.status, GameStatus.CANCELLED,
      'deadline cancels the game rather than deleting it');
  assert.deepStrictEqual(after.arenaPlaying, [],
      'cancelled game releases its players');
  assert.strictEqual(after.ongoingGameCount, 0, 'counter decremented once');
  assert.ok(!store.dataAt('events/evtT/redirect/game_1'),
      'pending redirect deleted so a stale ack cannot launch it');

  // a stale trigger on a cancelled game does nothing: no second decrement,
  // no replay processing
  replayListResponse = [{
    id: 'replay-ta', started: 2000000,
    ranking: ['a0', 'a1', 'b0', 'b1'].map(name => ({name})),
  }];
  const snap2 = await store.doc('events/evtT/games/game_1').get();
  await HANDLERS[handler].onWrite(
      {before: {exists: true}, after: snap2}, {params: {}});
  assert.strictEqual(store.dataAt('events/evtT').ongoingGameCount, 0,
      'cancelled game never decrements again');
  assert.strictEqual(
      store.dataAt('events/evtT/games/game_1').status, GameStatus.CANCELLED,
      'a stale trigger cannot score a cancelled game');

  // concurrent cancel attempts only resolve once
  const store2 = new FakeFirestore();
  global.__testFirestore = store2;
  const event2 = teamArenaEvent('evtC', {
    endTime: Date.now() - 30 * 60 * 1000,
    arenaPlaying: ['x0', 'x1'],
    ongoingGameCount: 1,
    arenaMatchNumber: 1,
  });
  seedEvent(store2, event2, [player('x0'), player('x1')]);
  store2.docs.set('events/evtC/games/game_1', {
    players: ['x0', 'x1'],
    arenaTeams: [{id: 'tx', name: 'X', players: ['x0', 'x1']}],
    started: 1000, status: GameStatus.STARTED, timesChecked: 0,
  });
  const c1 = await store2.doc('events/evtC/games/game_1').get();
  const c2 = await store2.doc('events/evtC/games/game_1').get();
  await Promise.all([
    HANDLERS[handler].onWrite({before: {exists: true}, after: c1},
        {params: {}}),
    HANDLERS[handler].onWrite({before: {exists: true}, after: c2},
        {params: {}}),
  ]);
  assert.strictEqual(store2.dataAt('events/evtC').ongoingGameCount, 0,
      'concurrent cancels decrement exactly once');
  console.log('  writer timeout passed');
}

async function testConcurrentCandidateClaim() {
  const handler = 'events/{eventId}/games/{gameId}';
  const store = new FakeFirestore();
  global.__testFirestore = store;
  stubAxios();

  const event = teamArenaEvent('evtCC', {
    arenaTeams: [
      team('team_a', 'a0', ['a0', 'a1'], {name: 'A Team'}),
      team('team_b', 'b0', ['b0', 'b1'], {name: 'B Team'}),
      team('team_c', 'c0', ['c0', 'c1'], {name: 'C Team'}),
    ],
    arenaPlaying: TA_USERNAMES.slice(),
    arenaParticipants: TA_USERNAMES.slice(),
    arenaMatchNumber: 1,
    ongoingGameCount: 1,
    playersPerGame: 6,
  });
  seedEvent(store, event, TA_USERNAMES.map(name => player(name)));
  store.docs.set('events/evtCC/games/game_1', {
    players: TA_USERNAMES.slice(),
    arenaTeams: clone(TA_GAME_TEAMS),
    eventTeam: TeamArena.storeLobby({
      version: 1, teamSize: 2, gameSize: 6,
      teams: [['a0', 'a1'], ['b0', 'b1'], ['c0', 'c1']],
    }),
    lobby: 'event_team_evtCC_1',
    started: 1000000,
    status: GameStatus.STARTED,
    timesChecked: 0,
  });

  // two candidates carry the exact dispatched roster; the first is
  // claimed by a different game between the metadata fetch and the commit
  // transaction, so the loop must move on to the second
  replayListResponse = [
    {id: 'replay-claimed', started: 2000000,
        ranking: TA_USERNAMES.map(name => ({name}))},
    {id: 'replay-ta', started: 2000000,
        ranking: TA_USERNAMES.map(name => ({name}))},
  ];
  onReplayFetch = id => {
    if (id === 'replay-claimed') {
      const eventDoc = store.dataAt('events/evtCC');
      store.docs.set('events/evtCC', {
        ...eventDoc, replays: [...(eventDoc.replays || []), 'replay-claimed'],
      });
    }
  };

  const snap = await store.doc('events/evtCC/games/game_1').get();
  await HANDLERS[handler].onWrite(
      {before: {exists: false}, after: snap}, {params: {}});

  const game = store.dataAt('events/evtCC/games/game_1');
  assert.strictEqual(game.status, GameStatus.FINISHED,
      'the loop moves past the claimed candidate');
  assert.strictEqual(game.replayId, 'replay-ta',
      'a later valid replay resolves the game');
  const after = store.dataAt('events/evtCC');
  assert.strictEqual(after.ongoingGameCount, 0);
  assert.deepStrictEqual(after.arenaPlaying, []);
  console.log('  concurrent candidate claim passed');
}

// minimal AngularFirestore surface for the real getRedirect projection:
// collection/doc/collection with a where-capable query ref and a
// snapshotChanges() that emits raw doc payloads through pipe()
function fakeAfsForRedirects(store) {
  const emit = docs => ({
    pipe: (...ops) => {
      const value = ops.reduce((v, op) => op(v), docs);
      return {
        subscribe(fn) {
          fn(value);
          return {unsubscribe() {}};
        },
      };
    },
  });
  return {
    collection: path => ({
      doc: id => ({
        collection: (sub, queryFn) => {
          const filters = [];
          const ref = {
            where(field, op, value) {
              filters.push([field, op, value]);
              return ref;
            },
          };
          if (queryFn) queryFn(ref);
          const prefix = `${path}/${id}/${sub}/`;
          return {
            doc: docId => store.doc(`${prefix}${docId}`),
            snapshotChanges: () => {
              const docs = [];
              for (const [p, data] of store.docs) {
                if (!p.startsWith(prefix) ||
                    p.slice(prefix.length).includes('/')) {
                  continue;
                }
                const ok = filters.every(([f, op, v]) =>
                    op === 'array-contains' ?
                        (data[f] || []).includes(v) : data[f] === v);
                if (ok) {
                  docs.push({payload: {doc: {
                      id: p.slice(prefix.length), data: () => data}}});
                }
              }
              return emit(docs);
            },
          };
        },
      }),
    }),
  };
}

async function testRedirectProjection() {
  const store = new FakeFirestore();
  global.__testFirestore = store;
  const event = teamArenaEvent('evtP', {
    options: {speed: '2x'},
    server: 'eu',
  });
  seedEvent(store, event, [player('a0')]);
  store.docs.set('events/evtP/redirect/game_1', {
    players: ['a0'],
    arenaTeams: [{id: 'ta', name: 'A', players: ['a0']}],
    eventTeam: TeamArena.storeLobby({version: 1, teamSize: 2, gameSize: 4,
        teams: [['a0'], ['b0']]}),
    gameId: 'game_1',
    lobby: 'event_team_evtP_1',
    started: 1,
    // dispatch-time snapshots; the event's own copies are mutated below
    options: {speed: '2x'},
    server: 'eu',
  });
  // editing the live event after dispatch must not leak into the lobby URL
  store.docs.set('events/evtP', {
    ...store.dataAt('events/evtP'),
    options: {speed: '4x'},
    server: 'na',
  });

  const utilStub = {
    showToast() {},
    getParamString: obj => '?' + Object.entries(obj)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'),
  };
  // constructor is (aff, afAuth, router, util): the afAuth stub never
  // emits so the cached name below stays the test's chosen user
  const generals = new GeneralsService(
      {}, {authState: {subscribe: () => {}}}, {}, utilStub);
  generals.name = 'a0';
  const eventService = new EventService(
      fakeAfsForRedirects(store), generals, {});
  const component = new ArenaQueueComponent(
      generals, eventService, {}, utilStub);
  component.event = store.dataAt('events/evtP');
  component.inEvent = true;
  component.status = EventStatus.ONGOING;
  component.ngOnChanges();
  await new Promise(resolve => setTimeout(resolve, 0));

  const url = decodeURIComponent(global.location.href);
  assert.ok(url.includes('event_team='), 'event_team in the lobby URL');
  assert.ok(url.includes('"teamSize":2') && url.includes('"gameSize":4'),
      'normalized contract serialized');
  assert.ok(url.includes('speed=2x'),
      'dispatch-time options snapshot reaches the URL');
  assert.ok(!url.includes('speed=4x'),
      'the post-dispatch event edit never reaches the URL');
  assert.ok(url.startsWith('https://eu.generals.io'),
      'dispatch-time server snapshot reaches the URL');
  console.log('  redirect projection passed');
}

async function testEventTrophies() {
  const generals = {name: 'alice'};

  // BYP: the top-ranked team carries a DQ'd participant, so the podium
  // drops to the next eligible team; a replacement who never played is
  // excluded while an archived earned participant still shows
  const byp = new EventTrophiesComponent(generals);
  byp.event = teamArenaEvent('evt-trophy', {
    arenaTeams: [
      team('ta', 'a0', ['a0', 'new1'],
          {points: 30, games: 2, wins: 2, participants: ['a0', 'a1']}),
      team('tb', 'b0', ['b0', 'b1'],
          {points: 10, games: 2, wins: 0, participants: ['b0', 'b1']}),
      // never played: no podium place
      team('tc', 'c0', ['c0', 'c1'], {points: 0, games: 0}),
    ],
  });
  byp.players = [
    player('a0', {points: 30, dq: true, record: [{replayId: 'r',
        teamId: 'ta', rank: 1}]}),
    player('a1', {points: 30, record: [{replayId: 'r', teamId: 'ta',
        rank: 1}]}),
    player('new1', {points: 0, record: []}),
    player('b0', {points: 10, record: [{replayId: 'r', teamId: 'tb'}]}),
    player('b1', {points: 10, record: [{replayId: 'r', teamId: 'tb'}]}),
    player('c0', {points: 0, record: []}),
  ];
  byp.status = EventStatus.FINISHED;
  assert.strictEqual(byp.first.name,
      "b0's Team (b0, b1)",
      'a DQ on the top team passes the trophy to the next eligible team');
  assert.strictEqual(byp.second, null,
      'only one eligible team, no silver');
  assert.deepStrictEqual(
      byp.arenaTeams.map(t => t.id), ['tb'], 'ineligible teams filtered');

  // an archived team (roster emptied by withdrawals) still presents its
  // earned historical participants
  const archived = new EventTrophiesComponent(generals);
  archived.event = teamArenaEvent('evt-arch', {
    arenaTeams: [
      team('ta', 'a0', [],
          {points: 20, games: 1, wins: 1, participants: ['a0', 'a1']}),
    ],
  });
  archived.players = [
    player('a0', {points: 20, record: [{replayId: 'r', teamId: 'ta',
        rank: 1}]}),
    player('a1', {points: 20, record: [{replayId: 'r', teamId: 'ta',
        rank: 1}]}),
  ];
  archived.status = EventStatus.FINISHED;
  assert.strictEqual(archived.first.name, "a0's Team (a0, a1)",
      'archived team presents its earned participants');

  // a BYP event where every team has zero games has no first place; it
  // does not fall back to an individual podium
  const unplayed = new EventTrophiesComponent(generals);
  unplayed.event = teamArenaEvent('evt-zero', {
    arenaTeams: [team('ta', 'a0', ['a0', 'a1'])],
  });
  unplayed.players = [player('a0', {points: 99, record: [{replayId: 'r'}]})];
  unplayed.status = EventStatus.FINISHED;
  assert.strictEqual(unplayed.first, null,
      'BYP with no played teams never shows an individual podium');

  // random partners: only participants with at least one record and no DQ
  // make the podium, ranked points/winrate/games/name
  const random = new EventTrophiesComponent(generals);
  random.event = teamArenaEvent('evt-rp', {
    doublesPairingStrategy: RANDOM,
    arenaParticipants: ['w', 'x', 'y', 'z'],
  });
  random.players = [
    player('w', {points: 9, record: [{replayId: 'r', rank: 1}]}),
    player('x', {points: 9, record: [{replayId: 'r'}]}),
    player('y', {points: 9, dq: true, record: [{replayId: 'r', rank: 1}]}),
    // high points but never participated: not on the podium
    player('q', {points: 50, record: [{replayId: 'r', rank: 1}]}),
    player('z', {points: 3, record: [{replayId: 'r'}]}),
  ];
  random.status = EventStatus.FINISHED;
  assert.strictEqual(random.first.name, 'w', 'random winner by win rate');
  assert.strictEqual(random.second.name, 'x',
      'record-less and DQ participants excluded');
  assert.strictEqual(random.third.name, 'z');
  assert.ok(!random.arenaPlayers.some(p => p.name === 'q'),
      'non-participants never reach the podium');
  console.log('  event trophies passed');
}

// the api module is compiled manually with esModuleInterop off so that
// `import * as express` binds the callable express factory the way the
// project's own functions tsconfig emits it
function loadApi() {
  // the secured api requires a configured key before module init
  process.env.API_KEYS = 'test-api-key';
  const ts = require('typescript');
  const fs = require('fs');
  const path = require('path');
  const Module = require('module');
  const file = path.resolve(
      __dirname, '../functions/src/https/api/api.ts');
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2017,
      esModuleInterop: false,
    },
  }).outputText;
  const mod = new Module(file, module);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.dirname(file));
  mod._compile(js, file);
  return mod.exports.api;
}

function fakeApiResponse() {
  const headers = {};
  const res = {
    statusCode: 200, headersSent: false, finished: false,
    _body: '', _ev: {},
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    getHeaders() { return headers; },
    removeHeader(k) { delete headers[k.toLowerCase()]; },
    writeHead(c, h) {
      res.statusCode = c;
      Object.assign(headers, h || {});
      return res;
    },
    write(c) { res._body += c; return true; },
    end(c) {
      if (c) res._body += c;
      res.finished = true;
      (res._ev.finish || []).forEach(f => f());
    },
    flushHeaders() {},
    on(e, f) { (res._ev[e] = res._ev[e] || []).push(f); return res; },
    once(e, f) { return res.on(e, f); },
    emit(e, ...a) { (res._ev[e] || []).forEach(f => f(...a)); return true; },
  };
  return res;
}

async function callApi(api, path, options = {}) {
  const headers = {
    authorization: options.key === null ? undefined :
        `Bearer ${options.key === undefined ? 'test-api-key' : options.key}`,
    'content-type': 'application/json',
  };
  const req = {
    url: path, method: options.method || 'GET', headers,
    httpVersion: '1.1', httpVersionMajor: 1, httpVersionMinor: 1,
    socket: {remoteAddress: '127.0.0.1'},
    connection: {remoteAddress: '127.0.0.1'},
    get: name => headers[name.toLowerCase()],
    body: options.body,
  };
  const res = fakeApiResponse();
  api(req, res);
  await new Promise(resolve => setTimeout(resolve, 50));
  return res;
}

async function testLobbyApi() {
  const api = loadApi();
  const store = new FakeFirestore();
  global.__testFirestore = store;

  // a team arena redirect returns the immutable contract and dispatch-time
  // options/server, never the event's post-dispatch copies
  const event = teamArenaEvent('evtA', {
    options: {speed: '4x'}, server: 'na',
  });
  seedEvent(store, event, [player('a0')]);
  store.docs.set('events/evtA/redirect/game_1', {
    players: ['a0'],
    eventTeam: TeamArena.storeLobby({version: 1, teamSize: 2, gameSize: 4,
        teams: [['a0'], ['b0']]}),
    arenaTeams: [{id: 'ta', name: 'A', players: ['a0']}],
    gameId: 'game_1',
    lobby: 'event_team_evtA_1',
    started: 1,
    options: {speed: '2x'},
    server: 'eu',
  });
  let res = await callApi(api, '/v1/events/evtA/lobby/a0');
  assert.strictEqual(res.statusCode, 200, `api error: ${res._body}`);
  const payload = JSON.parse(res._body);
  assert.strictEqual(payload.lobby, 'event_team_evtA_1');
  assert.deepStrictEqual(payload.options, {speed: '2x'},
      'dispatch options snapshot, not the live event options');
  assert.strictEqual(payload.server, 'eu', 'dispatch server snapshot');
  assert.strictEqual(payload.players, 4, 'nominal game size');
  assert.strictEqual(payload.eventTeam.gameSize, 4,
      'normalized contract echoed back');
  assert.deepStrictEqual(
      store.dataAt('events/evtA/redirect/game_1').players, [],
      'acknowledgement consumed the redirect');

  // a malformed roster is never acknowledged: the redirect survives for
  // diagnosis instead of being consumed into a broken join
  const bad = teamArenaEvent('evtB');
  seedEvent(store, bad, [player('a0')]);
  store.docs.set('events/evtB/redirect/game_1', {
    players: ['a0'],
    eventTeam: TeamArena.storeLobby({version: 1, teamSize: 2, gameSize: 8,
        teams: [['a0'], ['b0'], ['c0'], ['d0']]}),
    lobby: 'event_team_evtB_1',
    started: 1,
  });
  res = await callApi(api, '/v1/events/evtB/lobby/a0');
  assert.strictEqual(res.statusCode, 500,
      'a contract that disagrees with the event is rejected');
  assert.deepStrictEqual(
      store.dataAt('events/evtB/redirect/game_1').players, ['a0'],
      'malformed redirect is not consumed');

  // a legacy redirect keeps the exact old response shape (query a user
  // not still pending on the malformed redirect above)
  store.docs.set('events/evtB/redirect/game_2', {
    players: ['b0'], lobby: 'event_evtB_2', started: 1,
  });
  res = await callApi(api, '/v1/events/evtB/lobby/b0');
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(res._body), {lobby: 'event_evtB_2'},
      'legacy responses stay {lobby}');
  console.log('  lobby api passed');
}

// the reserved-room bootstrap endpoint is exercised against the REAL
// express app and requireApiKey middleware, with a game produced by the
// real matchmaker — nothing about the route logic is re-implemented here
async function testTeamArenaLobbyApi() {
  const api = loadApi();
  const store = new FakeFirestore();
  global.__testFirestore = store;

  seedEvent(store, teamArenaEvent('evtL'), [
    player('a0'), player('a1'), player('b0'), player('b1'),
  ]);
  store.docs.set('events/evtL', {
    ...store.dataAt('events/evtL'),
    arenaTeams: [
      team('ta', 'a0', ['a0', 'a1']),
      team('tb', 'b0', ['b0', 'b1']),
    ],
  });
  readyAll(store, 'evtL', ['a0', 'a1', 'b0', 'b1']);
  await dispatch(store, 'evtL');
  const game = store.dataAt('events/evtL/games/game_1');
  assert.ok(game && game.status === GameStatus.STARTED,
      'matchmaker produced a STARTED dispatch');
  const lobby = game.lobby;

  const post = (body, key) =>
      callApi(api, '/v1/events/evtL/team-arena/lobby',
          {method: 'POST', body, key});

  // no and wrong API keys are rejected by the real middleware
  let res = await post({lobby, username: 'a0'}, null);
  assert.strictEqual(res.statusCode, 401);
  res = await post({lobby, username: 'a0'}, 'wrong-key');
  assert.strictEqual(res.statusCode, 401);

  // the happy path returns exactly the immutable snapshot
  res = await post({lobby, username: 'a0'});
  assert.strictEqual(res.statusCode, 200, `api error: ${res._body}`);
  const payload = JSON.parse(res._body);
  assert.strictEqual(payload.lobby, lobby);
  assert.strictEqual(payload.eventTeam.gameSize, 4);
  assert.deepStrictEqual(payload.server, game.server);
  assert.deepStrictEqual(payload.options, game.options);

  // every member of every dispatched team passes
  res = await post({lobby, username: 'b1'});
  assert.strictEqual(res.statusCode, 200);

  // a registered player who is not on the roster is refused
  res = await post({lobby, username: 'c0'});
  assert.strictEqual(res.statusCode, 403);

  // malformed bodies: wrong event id in lobby, extra keys, missing fields
  res = await post({lobby: 'event_team_other_1', username: 'a0'});
  assert.strictEqual(res.statusCode, 400);
  res = await post({lobby, username: 'a0', eventTeam: {teams: [['c0']]}});
  assert.strictEqual(res.statusCode, 400);
  res = await post({lobby});
  assert.strictEqual(res.statusCode, 400);
  res = await post({lobby: 'event_evtL_1', username: 'a0'});
  assert.strictEqual(res.statusCode, 400);

  // a non-STARTED game is not a dispatch
  const g2 = {...game, status: GameStatus.CANCELLED};
  store.docs.set('events/evtL/games/game_1', g2);
  res = await post({lobby, username: 'a0'});
  assert.strictEqual(res.statusCode, 403, 'CANCELLED is not dispatchable');
  store.docs.set('events/evtL/games/game_1',
      {...game, status: GameStatus.FINISHED});
  res = await post({lobby, username: 'a0'});
  assert.strictEqual(res.statusCode, 403, 'FINISHED is not dispatchable');
  store.docs.set('events/evtL/games/game_1', game);

  // a roster that disagrees with the contract fails closed
  store.docs.set('events/evtL/games/game_1',
      {...game, players: ['a0', 'a1', 'b0', 'zz']});
  res = await post({lobby, username: 'a0'});
  assert.strictEqual(res.statusCode, 403, 'roster mismatch rejected');
  store.docs.set('events/evtL/games/game_1',
      {...game, options: null});
  res = await post({lobby, username: 'a0'});
  assert.strictEqual(res.statusCode, 403, 'missing options snapshot');
  store.docs.set('events/evtL/games/game_1',
      {...game, server: 'not-a-server'});
  res = await post({lobby, username: 'a0'});
  assert.strictEqual(res.statusCode, 403, 'invalid server rejected');
  store.docs.set('events/evtL/games/game_1', game);

  // short-handed dispatch: a 3-of-4 roster still proves correctly
  const short = new FakeFirestore();
  global.__testFirestore = short;
  seedEvent(short, teamArenaEvent('evtS', {teamSize: 4,
      playersPerGame: 8}), [
    player('a0'), player('a1'), player('a2'), player('a3'),
    player('b0'), player('b1'), player('b2'),
  ]);
  short.docs.set('events/evtS', {
    ...short.dataAt('events/evtS'),
    arenaTeams: [
      team('ta', 'a0', ['a0', 'a1', 'a2', 'a3'],
          {allowShortHanded: true}),
      team('tb', 'b0', ['b0', 'b1', 'b2'],
          {allowShortHanded: true}),
    ],
  });
  readyAll(short, 'evtS', ['a0', 'a1', 'a2', 'a3', 'b0', 'b1', 'b2']);
  await dispatch(short, 'evtS');
  const shortGame = short.dataAt('events/evtS/games/game_1');
  assert.ok(shortGame, 'short-handed game dispatched');
  res = await callApi(api, '/v1/events/evtS/team-arena/lobby', {
    method: 'POST',
    body: {lobby: shortGame.lobby, username: 'b2'},
  });
  assert.strictEqual(res.statusCode, 200,
      'short-handed roster proves: ' + res._body);
  res = await callApi(api, '/v1/events/evtS/team-arena/lobby', {
    method: 'POST',
    body: {lobby: shortGame.lobby, username: 'c0'},
  });
  assert.strictEqual(res.statusCode, 403);
  console.log('  team arena lobby api passed');
}

async function testRedirectNoop() {
  const handler = 'events/{eventId}/redirect/{redirectId}';
  assert.ok(HANDLERS[handler]?.onCreate, 'redirect onCreate registered');

  const store = new FakeFirestore();
  global.__testFirestore = store;
  seedEvent(store, teamArenaEvent('evtR'), []);

  // a team arena redirect carries the pre-created gameId: the trigger must
  // not create a second game doc
  await HANDLERS[handler].onCreate({
    data: () => ({
      players: ['a0', 'a1'], started: 1, gameId: 'game_1',
      lobby: 'event_team_evtR_1',
    }),
  }, {params: {eventId: 'evtR'}});
  const games = await store.collection('events/evtR/games').get();
  assert.strictEqual(games.docs.length, 0, 'no duplicate game created');

  // a legacy redirect without gameId still spawns its game
  await HANDLERS[handler].onCreate({
    data: () => ({players: ['x0'], started: 1, lobby: 'event_evtR_9'}),
  }, {params: {eventId: 'evtR'}});
  const games2 = await store.collection('events/evtR/games').get();
  assert.strictEqual(games2.docs.length, 1, 'legacy path unchanged');
  console.log('  redirect noop passed');
}

async function testWithdrawPreservesHistory() {
  const store = new FakeFirestore();
  global.__testFirestore = store;
  const event = teamArenaEvent('evtW2', {
    arenaTeams: [
      team('ta', 'a0', ['a0', 'a1'],
          {points: 12, games: 2, wins: 1, participants: ['a0', 'a1']}),
    ],
  });
  seedEvent(store, event, [player('a0', {points: 12,
      record: [{replayId: 'r1', points: 6, teamId: 'ta'}]}),
      player('a1', {points: 12, record: [{replayId: 'r1', points: 6,
          teamId: 'ta'}]}),
      player('ghost')]);

  // a scored player's withdrawal keeps the registration doc flagged
  // withdrawn: their points, records, and the team's history survive
  await makeService(store, 'a1').withdrawPlayer('evtW2', 'a1');
  let after = store.dataAt('events/evtW2');
  let ta = after.arenaTeams.find(t => t.id === 'ta');
  assert.deepStrictEqual(ta.members, ['a0']);
  assert.strictEqual(ta.points, 12, 'team totals preserved on withdrawal');
  assert.strictEqual(ta.games, 2);
  const a1 = store.dataAt('events/evtW2/players/a1');
  assert.ok(a1, 'scored registration doc kept');
  assert.strictEqual(a1.withdrawn, true);
  assert.strictEqual(a1.points, 12, 'points never reset by withdrawal');

  // withdrawn players cannot ready up or mutate teams
  await expectReject(
      makeService(store, 'a1').setReady('evtW2', true),
      'not registered', 'withdrawn ready');
  await expectReject(
      makeService(store, 'a1').createTeam('evtW2', 'Rejects'),
      'not registered', 'withdrawn createTeam');

  // an explicit rejoin clears the flag and keeps every bit of history
  const eventService = makeEventService(store, 'a1');
  await eventService.addPlayer('evtW2', 'a1');
  const rejoined = store.dataAt('events/evtW2/players/a1');
  assert.strictEqual(rejoined.withdrawn, false);
  assert.strictEqual(rejoined.points, 12, 'rejoin preserves points');
  assert.strictEqual(rejoined.record.length, 1);

  // an unscored withdrawal deletes the registration outright
  await makeService(store, 'ghost').withdrawPlayer('evtW2', 'ghost');
  assert.ok(!store.dataAt('events/evtW2/players/ghost'),
      'never-scored registration removed');

  // the last member leaving a never-played team removes it; an emptied
  // team with history stays as an archive
  await makeService(store, 'a0').withdrawPlayer('evtW2', 'a0');
  after = store.dataAt('events/evtW2');
  ta = after.arenaTeams.find(t => t.id === 'ta');
  assert.ok(ta, 'emptied team with history is archived');
  assert.deepStrictEqual(ta.members, []);
  assert.strictEqual(ta.points, 12, 'archived totals survive');
  console.log('  withdrawal preserves history passed');
}

async function testFillAndMutationGuards() {
  const store = new FakeFirestore();
  seedEvent(store, teamArenaEvent('evt-guards'), [
    player('a0'), player('a1'), player('b0'), player('b1'), player('fill'),
  ]);
  store.docs.set('events/evt-guards', {
    ...store.dataAt('events/evt-guards'),
    arenaTeams: [
      team('ta', 'a0', ['a0'], {acceptFill: true}),
      team('tb', 'b0', ['b0'], {acceptFill: true}),
    ],
  });

  // a fully-queued (freshly ready) team is not a fill target; the join
  // succeeds on the idle team instead
  readyAll(store, 'evt-guards', ['a0']);
  await makeService(store, 'fill').joinRandomTeam('evt-guards');
  let teams = store.dataAt('events/evt-guards').arenaTeams;
  assert.ok(!teams.find(t => t.id === 'ta').members.includes('fill'),
      'queued team not a fill target');
  assert.ok(teams.find(t => t.id === 'tb').members.includes('fill'),
      'idle team took the fill');
  await makeService(store, 'fill').leaveTeam('evt-guards');

  // a team with a member in a live game is not a fill target either; with
  // tb busy the only eligible team is ta (readiness cleared above)
  const playing = store.dataAt('events/evt-guards');
  store.docs.set('events/evt-guards',
      {...playing, arenaPlaying: ['b0'], arenaReady: {}});
  await makeService(store, 'fill').joinRandomTeam('evt-guards');
  teams = store.dataAt('events/evt-guards').arenaTeams;
  assert.ok(teams.find(t => t.id === 'ta').members.includes('fill'),
      'fill joins the idle team');
  assert.ok(!teams.find(t => t.id === 'tb').members.includes('fill'),
      'playing team not a fill target');
  store.docs.set('events/evt-guards', {
    ...store.dataAt('events/evt-guards'), arenaPlaying: [],
  });
  await makeService(store, 'fill').leaveTeam('evt-guards');

  // acceptPlayer on a player who is already on a team rejects even with a
  // stale pending request
  const stale = store.dataAt('events/evt-guards');
  stale.arenaTeams.find(t => t.id === 'ta').requests.push('b0');
  store.docs.set('events/evt-guards', stale);
  await expectReject(
      makeService(store, 'a0').acceptPlayer('evt-guards', 'b0'),
      'already on a team', 'stale request cannot poach');

  // no mutations after the event ends or is finalized
  const done = new FakeFirestore();
  seedEvent(done, teamArenaEvent('evt-done', {
    endTime: Date.now() - 60000,
    arenaTeams: [team('td', 'd0', ['d0'])],
    winners: ['d0'],
  }), [player('d0'), player('d1')]);
  await expectReject(
      makeService(done, 'd1').createTeam('evt-done', 'Late'),
      /finalized|ended/, 'createTeam after finalize');
  await expectReject(
      makeService(done, 'd0').leaveTeam('evt-done'),
      /finalized|ended/, 'leaveTeam after finalize');
  await expectReject(
      makeService(done, 'd0').setTeamOptions('evt-done', {acceptFill: true}),
      /finalized|ended/, 'options after finalize');
  console.log('  fill and mutation guards passed');
}

async function testFinalize() {
  const handler = 'events/{eventId}/games/{gameId}';

  // BYP: the top team wins; winners are the members/participants who
  // earned a record for that team specifically
  const store = new FakeFirestore();
  seedEvent(store, teamArenaEvent('evt-fin', {
    endTime: Date.now() - 60000,
    arenaTeams: [
      team('ta', 'a0', ['a0', 'a1', 'fill'],
          {points: 20, games: 1, wins: 1, participants: ['a0', 'a1']}),
      team('tb', 'b0', ['b0', 'b1'], {points: 5, games: 1}),
    ],
    arenaParticipants: ['a0', 'a1', 'b0', 'b1'],
  }), [
    player('a0', {points: 20, record: [{replayId: 'r', rank: 1,
        teamId: 'ta'}]}),
    player('a1', {points: 20, record: [{replayId: 'r', rank: 1,
        teamId: 'ta'}]}),
    // a fill who never played for team a cannot share its win
    player('fill', {points: 0}),
    player('b0', {points: 5, record: [{replayId: 'r', teamId: 'tb'}]}),
    player('b1', {points: 5, record: [{replayId: 'r', teamId: 'tb'}]}),
  ]);
  await makeService(store, 'Lazerpent').finalize('evt-fin');
  assert.deepStrictEqual(
      store.dataAt('events/evt-fin').winners.sort(), ['a0', 'a1'],
      'BYP winners are the earned participants, not unplayed fills');

  // random partners: exactly one individual winner by
  // points/winrate/games/name
  const rand = new FakeFirestore();
  seedEvent(rand, teamArenaEvent('evt-rfin', {
    doublesPairingStrategy: RANDOM, endTime: Date.now() - 60000,
    arenaParticipants: ['p0', 'p1', 'p2'],
  }), [
    player('p0', {points: 9, record: [{replayId: 'r', rank: 1}]}),
    player('p1', {points: 9, record: [{replayId: 'r'}]}),
    player('p2', {points: 9, record: [{replayId: 'r'}]}),
  ]);
  await makeService(rand, 'Lazerpent').finalize('evt-rfin');
  assert.deepStrictEqual(rand.dataAt('events/evt-rfin').winners, ['p0'],
      'exactly one individual winner in random partners');

  // a DQ'd participant disqualifies their whole fixed team; the next
  // ranked eligible team wins instead
  const dq = new FakeFirestore();
  seedEvent(dq, teamArenaEvent('evt-dq', {
    endTime: Date.now() - 60000,
    arenaTeams: [
      team('ta', 'a0', ['a0', 'a1'],
          {points: 99, games: 1, wins: 1, participants: ['a0', 'a1']}),
      team('tb', 'b0', ['b0', 'b1'],
          {points: 1, games: 1, participants: ['b0', 'b1']}),
    ],
  }), [
    player('a0', {points: 99, dq: true, record: [{replayId: 'r', rank: 1,
        teamId: 'ta'}]}),
    player('a1', {points: 99, record: [{replayId: 'r', teamId: 'ta'}]}),
    player('b0', {points: 1, record: [{replayId: 'r', teamId: 'tb'}]}),
    player('b1', {points: 1, record: [{replayId: 'r', teamId: 'tb'}]}),
  ]);
  await makeService(dq, 'Lazerpent').finalize('evt-dq');
  assert.deepStrictEqual(
      dq.dataAt('events/evt-dq').winners.sort(), ['b0', 'b1'],
      'a DQ on the top team passes the win to the next eligible team');

  // refuses while running or while games are in flight
  const early = new FakeFirestore();
  seedEvent(early, teamArenaEvent('evt-early'), [player('e0')]);
  await expectReject(
      makeService(early, 'Lazerpent').finalize('evt-early'),
      'running', 'finalize before end');
  const inflight = new FakeFirestore();
  seedEvent(inflight, teamArenaEvent('evt-flight', {
    endTime: Date.now() - 60000, ongoingGameCount: 1,
  }), [player('e0')]);
  await expectReject(
      makeService(inflight, 'Lazerpent').finalize('evt-flight'),
      'in progress', 'finalize with games in flight');

  // an empty event has no winner
  const empty = new FakeFirestore();
  seedEvent(empty, teamArenaEvent('evt-empty', {
    endTime: Date.now() - 60000,
  }), []);
  await makeService(empty, 'Lazerpent').finalize('evt-empty');
  assert.deepStrictEqual(empty.dataAt('events/evt-empty').winners, [],
      'empty event has no winner');

  // non-admins cannot finalize
  const notAdmin = new FakeFirestore();
  seedEvent(notAdmin, teamArenaEvent('evt-na', {
    endTime: Date.now() - 60000,
  }), [player('e0')]);
  await expectReject(
      makeService(notAdmin, 'e0').finalize('evt-na'),
      'organizer', 'non-admin finalize');
  console.log('  finalize passed');
}

async function testUpdateEventLock() {
  const store = new FakeFirestore();
  global.__testFirestore = store;
  const event = teamArenaEvent('evt-lock', {
    arenaTeams: [team('ta', 'a0', ['a0', 'a1'])],
  });
  seedEvent(store, event, [player('a0'), player('a1')]);
  const service = makeEventService(store, 'Lazerpent');

  // a live team arena rejects structural changes
  await expectReject(
      service.updateEvent('evt-lock', {teamSize: 3, playersPerGame: 6}),
      'structure', 'teamSize change on a live arena');
  await expectReject(
      service.updateEvent('evt-lock', {format: 'Double Elimination'}),
      'structure', 'format change on a live arena');
  await expectReject(
      service.updateEvent('evt-lock', {type: 'FFA'}),
      'structure', 'type change on a live arena');
  await expectReject(
      service.updateEvent('evt-lock',
          {doublesPairingStrategy: RANDOM}),
      'structure', 'mode change on a live arena');

  // non-structural edits still work
  await service.updateEvent('evt-lock', {name: 'Renamed'});
  assert.strictEqual(store.dataAt('events/evt-lock').name, 'Renamed');
  // identical structural values are not a change
  await service.updateEvent('evt-lock', {teamSize: 2, playersPerGame: 4});
  console.log('  updateEvent lock passed');
}

async function testQueueOrder() {
  const store = new FakeFirestore();
  seedEvent(store, teamArenaEvent('evt-order'), [
    player('a0'), player('a1'), player('b0'), player('b1'),
    player('c0'), player('c1'),
  ]);
  store.docs.set('events/evt-order', {
    ...store.dataAt('events/evt-order'),
    arenaTeams: [
      team('ta', 'a0', ['a0', 'a1']),
      team('tb', 'b0', ['b0', 'b1']),
      team('tc', 'c0', ['c0', 'c1']),
    ],
  });

  // a and b ready first, then c; heartbeats refresh freshness but the
  // queue position is fixed at the first fresh confirmation
  const now = Date.now();
  readyAll(store, 'evt-order', ['a0', 'a1'], now - 8000);
  readyAll(store, 'evt-order', ['b0', 'b1'], now - 7000);
  readyAll(store, 'evt-order', ['c0', 'c1'], now - 6000);
  heartbeat(store, 'evt-order', ['a0', 'a1', 'b0', 'b1']);

  await dispatch(store, 'evt-order');
  const game = store.dataAt('events/evt-order/games/game_1');
  assert.deepStrictEqual(game.players.sort(), ['a0', 'a1', 'b0', 'b1'],
      'heartbeats cannot push queued teams behind later arrivals');
  const event = store.dataAt('events/evt-order');
  assert.ok(Number.isFinite(event.arenaReady.c0) &&
      Number.isFinite(event.arenaReady.c1), 'team c stays queued');
  assert.deepStrictEqual(event.arenaPlaying.sort(),
      ['a0', 'a1', 'b0', 'b1']);
  console.log('  queue order passed');
}

// class-level coverage for the readiness-renewal lifecycle: the real
// component runs against fake services and a captured timer so the 30s
// interval never actually waits
async function testArenaQueueComponent() {
  const intervals = [];
  const realSetInterval = global.setInterval;
  const realClearInterval = global.clearInterval;
  global.setInterval = (fn, ms) => {
    const timer = {fn, ms, cleared: false};
    intervals.push(timer);
    return timer;
  };
  global.clearInterval = timer => {
    if (timer) timer.cleared = true;
  };
  try {
    const readyCalls = [];
    let readyError = null;
    const nameChangedSubs = [];
    const generals = {
      name: 'alice',
      nameChanged$: {
        subscribe(fn) {
          const sub = {fn, unsubscribed: false,
              unsubscribe() { this.unsubscribed = true; }};
          nameChangedSubs.push(sub);
          return sub;
        },
      },
      loginFromEvent() {},
      joinLobby() {},
    };
    const teamArena = {
      setReady(eventId, ready) {
        readyCalls.push([eventId, ready]);
        return readyError ? Promise.reject(readyError) :
            Promise.resolve();
      },
    };
    const eventService = {
      addPlayer() { return Promise.resolve(); },
      getRedirect() { return {subscribe() { return {unsubscribe() {}}; }}; },
      clearRedirect() { return Promise.resolve(); },
    };
    const util = {toasts: [], showToast(m) { this.toasts.push(m); }};
    const component = new ArenaQueueComponent(
        generals, eventService, teamArena, util);
    assert.strictEqual(nameChangedSubs.length, 1,
        'name change subscription created');

    const setEvent = (arenaReady) => {
      component.event = teamArenaEvent('evt-q', {arenaReady});
      component.inEvent = true;
      component.status = EventStatus.ONGOING;
      component.ngOnChanges();
    };

    // ready -> exactly one renewal timer; re-syncs while the same context
    // stays ready do not stack timers
    setEvent({alice: Date.now()});
    assert.strictEqual(intervals.length, 1, 'one timer for ready');
    component.ngOnChanges();
    assert.strictEqual(intervals.length, 1,
        'same context does not stack timers');

    // unready stops the timer; the first ready after an unready must start
    // a new one (context equality alone is not enough)
    setEvent({});
    assert.ok(intervals[0].cleared, 'unready cleared the timer');
    setEvent({alice: Date.now()});
    assert.strictEqual(intervals.length, 2, 'new timer after re-ready');

    // a renewal tick confirms the caller's own name and event only
    intervals[1].fn();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepStrictEqual(readyCalls, [['evt-q', true]],
        'renewal renews the caller only');

    // a fresh Firestore snapshot replaces the event object; the timer must
    // keep running because the context is the id+name, not object identity
    component.event = teamArenaEvent('evt-q', {arenaReady: {alice: Date.now()}});
    component.ngOnChanges();
    intervals[1].fn();
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(readyCalls.length, 2,
        'snapshot replacement does not stop renewal');
    assert.ok(!intervals[1].cleared, 'timer survives new event objects');

    // an in-flight renewal makes the next tick skip a beat, not stop the
    // timer; later ticks keep renewing once it settles
    const resolvers = [];
    let pendingCalls = 0;
    teamArena.setReady = () => {
      pendingCalls++;
      return new Promise(resolve => resolvers.push(resolve));
    };
    intervals[1].fn();
    intervals[1].fn();
    assert.strictEqual(pendingCalls, 1,
        'overlapping ticks do not double-renew');
    assert.ok(!intervals[1].cleared, 'overlap skips, never stops');
    resolvers[0]();
    await Promise.resolve();
    await Promise.resolve();
    intervals[1].fn();
    assert.strictEqual(pendingCalls, 2, 'renewals continue after overlap');
    resolvers[1]();
    await Promise.resolve();
    await Promise.resolve();

    // a renewal failure stops the loop, latches the context, and surfaces
    // the error; unrelated snapshots must not re-arm it
    teamArena.setReady = (eventId, ready) => {
      readyCalls.push([eventId, ready]);
      return Promise.reject(new Error('expired'));
    };
    intervals[1].fn();
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(component.error.includes('expired'), 'failure reported');
    assert.ok(intervals[1].cleared, 'failed renewal stops the timer');
    component.event = teamArenaEvent('evt-q', {arenaReady: {alice: Date.now()}});
    component.ngOnChanges();
    assert.strictEqual(intervals.length, 2,
        'a latched failure does not re-arm on snapshots');

    // an explicit retry clears the latch and re-arms
    component.readyFailed = null;
    component.syncReadyRenewal();
    assert.strictEqual(intervals.length, 3, 'user retry re-arms renewal');

    // context change (different identity) stops the old timer and does not
    // renew under the previous name
    const old = intervals[2];
    generals.name = 'bob';
    component.event = teamArenaEvent('evt-q', {arenaReady: {bob: Date.now()}});
    component.ngOnChanges();
    assert.ok(old.cleared, 'identity change clears the old timer');
    old.fn();
    await Promise.resolve();
    assert.strictEqual(readyCalls.filter(c => c[0] === 'evt-q').length, 3,
        'a late tick under an old identity never renews');

    // a renewal promise settling under a changed context cannot record its
    // failure on the new context
    component.error = null;
    // the stale tick above stopped the live timer; re-sync re-arms bob's
    component.ngOnChanges();
    const bobsTimer = intervals[intervals.length - 1];
    let settleStale;
    teamArena.setReady = () => new Promise((_, reject) => {
      settleStale = reject;
    });
    bobsTimer.fn();
    generals.name = 'carol';
    component.event = teamArenaEvent('evt-q',
        {arenaReady: {carol: Date.now()}});
    component.ngOnChanges();
    settleStale(new Error('stale failure'));
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(component.error, null,
        'a stale promise cannot poison the new context');

    // destroy stops everything and unsubscribes the name listener
    component.ngOnDestroy();
    assert.ok(intervals.every(t => t.cleared), 'destroy clears all timers');
    assert.ok(nameChangedSubs[0].unsubscribed, 'nameChanged$ unsubscribed');
  } finally {
    global.setInterval = realSetInterval;
    global.clearInterval = realClearInterval;
  }
  console.log('  arena queue component passed');
}

async function testFakes() {
  const store = new FakeFirestore();
  store.docs.set('c/a', {x: 1, y: 2});
  store.docs.set('c/b', {x: 1, y: 1});
  store.docs.set('c/c', {x: 0, y: 9});
  const ordered = await store.collection('c')
      .orderBy('x', 'asc').orderBy('y', 'desc').get();
  // x ascending puts c first; the x=1 tie breaks on y descending (2 > 1)
  assert.deepStrictEqual(ordered.docs.map(d => d.id), ['c', 'a', 'b'],
      'orderBy is lexicographic: first field primary, later break ties');
  const added = await store.collection('c').add({x: 5});
  assert.ok(added.id, 'add returns a ref');
  assert.ok(store.dataAt(`c/${added.id}`), 'add persisted before resolve');
  console.log('  fakes passed');
}

// -------------------------------------------------------------- runner --

async function main() {
  console.log('team arena tests');

  testDetectionAndConfig();
  testNormalizeLobby();
  testAssertReplayTeams();
  testScoring();
  testTeamOutcomeScoring();
  await testTeamLifecycle();
  await testReadiness();
  await testBypDispatch();
  await testShortHanded();
  await testRandomPartners();
  await testConcurrentDispatch();
  await testTeamArenaWriter();
  await testTwoTeamArenaWriter();
  await testRandomPartnersWriter();
  await testWriterTimeout();
  await testConcurrentCandidateClaim();
  await testRedirectProjection();
  await testEventTrophies();
  await testLobbyApi();
  await testTeamArenaLobbyApi();
  await testRedirectNoop();
  await testWithdrawPreservesHistory();
  await testFillAndMutationGuards();
  await testFinalize();
  await testUpdateEventLock();
  await testQueueOrder();
  await testArenaQueueComponent();
  await testFakes();

  console.log('All team arena tests passed!');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
