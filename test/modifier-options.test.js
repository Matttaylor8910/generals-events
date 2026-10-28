'use strict';

// Modifier/game-options regression suite. Runs entirely offline:
//  - event options normalization/validation contracts,
//  - create/edit event form -> persisted options,
//  - lobby URL serialization -> URLSearchParams round trip,
//  - the three real Firestore onWrite result handlers exercised through
//    captured trigger registrations, an explicit FakeFirestore, and a
//    stubbed axios whose .gior response is a locally compressed replay
//    fixture built in the same field order the decoder consumes.
// These are documented mock tests: they prove the code paths execute and
// that modifier/clock mismatches produce no result writes; they do not
// prove real Firestore security or concurrency.

require('./ts-register');

global.localStorage = {
  _data: {},
  getItem(key) {
    return this._data[key] === undefined ? null : this._data[key];
  },
  setItem(key, value) {
    this._data[key] = String(value);
  },
  removeItem(key) {
    delete this._data[key];
  },
};

const assert = require('assert');
const path = require('path');
const LZString = require('lz-string');
const axios = require('axios');
// functions code resolves axios through functions/node_modules — stub that
// instance too or replay/simulator requests escape to the real network
const functionsAxios = require(require.resolve('axios', {
  paths: [path.resolve(__dirname, '../functions')] }));

const { FakeFirestore } = require('./fakes');
const functionsStub = require('firebase-functions');
const EventGameOptions = require('../functions/src/util/EventGameOptions');
const {
  MODIFIER_INDEXES, normalizeModifierIds, normalizeEventGameOptions,
  validateEventGameOptions,
} = require('../game-options');
const {
  EventType, EventFormat, GameSpeed, MatchStatus, Visibility,
} = require('../types');
const { CreateEventPage } = require(
  '../src/app/pages/home/create-event/create-event.page');
const { GeneralsService } = require('../src/app/services/generals.service');
const { UtilService } = require('../src/app/services/util.service');

// the handlers register their triggers on require; the stub captures them
// under __handlers keyed by document path
global.__testFirestore = new FakeFirestore();
require('../functions/src/events/games/onWrite.ts');
require('../functions/src/events/matches/onWrite.ts');
require('../functions/src/events/dyp-matches/onWrite.ts');
const { recordSanityCheck } = require(
  '../functions/src/events/players/onUpdate');
const HANDLERS = functionsStub.__handlers;

// ----------------------------------------------------- replay fixtures ---

// sequential field order consumed by
// functions/src/util/ReplayDeserializer.js; afk entries serialize as
// [playerIndex, turn] pairs and moves as [index, start, end, is50, turn]
function makeReplayFields(overrides = {}) {
  const fields = [
    19,                 //  0 version (REPLAY_VERSION_20, zero-based wire 19)
    'fixture',          //  1 id
    3,                  //  2 mapWidth
    3,                  //  3 mapHeight
    ['P0', 'P1'],       //  4 usernames
    [0, 0],             //  5 stars
    [],                 //  6 cities
    [],                 //  7 cityArmies
    [0, 8],             //  8 generals
    [],                 //  9 mountains
    [],                 // 10 moves
    [[1, 5]],           // 11 afks: P1 surrenders on turn 5, P0 wins
    null,               // 12 teams
    null,               // 13 map
    [],                 // 14 neutrals
    [],                 // 15 neutralArmies
    [],                 // 16 swamps
    [],                 // 17 chat
    [1, 2],             // 18 playerColors
    [],                 // 19 lights
    [1, 0.4, 0.5, 0.1, -1, -1, 0, 0, 0], // 20 options
    null,               // 21 modifiers
    [],                 // 22 observatories
    [],                 // 23 lookouts
    [],                 // 24 deserts
    [0, 0],             // 25 player_transforms
    null,               // 26 pings
    null,               // 27 generalTrades
    null,               // 28 tunnels
    null,               // 29 tunnelLimits
    null,               // 30 chessClockTimingsByMove
    null,               // 31 stronghold_density
    null,               // 32 stronghold_strength_min
    null,               // 33 stronghold_strength_max
    null,               // 34 strongholds
    null,               // 35 strongholdStrengths
    null,               // 36 chessClockMoveExecutionTimestamps
    null,               // 37 modifier_options
    null,               // 38 chessClockElapsed
  ];
  const data = fields.slice();
  data[0] = overrides.version !== undefined ? overrides.version : 19;
  data[1] = overrides.id !== undefined ? overrides.id : 'fixture';
  data[2] = overrides.mapWidth !== undefined ? overrides.mapWidth : 3;
  data[3] = overrides.mapHeight !== undefined ? overrides.mapHeight : 3;
  data[4] = overrides.usernames || ['P0', 'P1'];
  data[8] = overrides.generals || [0, 8];
  data[10] = overrides.moves || [];
  data[11] = overrides.afks !== undefined ? overrides.afks : [[1, 5]];
  data[12] = overrides.teams !== undefined ? overrides.teams : null;
  data[21] = overrides.modifiers !== undefined ? overrides.modifiers : null;
  data[28] = overrides.tunnels !== undefined ? overrides.tunnels : null;
  data[29] = overrides.tunnelLimits !== undefined
      ? overrides.tunnelLimits
      : null;
  data[34] = overrides.strongholds !== undefined
      ? overrides.strongholds
      : null;
  data[35] = overrides.strongholdStrengths !== undefined
      ? overrides.strongholdStrengths
      : null;
  data[36] = overrides.execTimestamps !== undefined
      ? overrides.execTimestamps
      : null;
  data[37] = overrides.modifier_options !== undefined
      ? overrides.modifier_options
      : null;
  data[38] = overrides.chessClockElapsed !== undefined
      ? overrides.chessClockElapsed
      : null;
  return data[0] === 18 ? data.slice(0, 36) : data;
}

function compressReplay(fields) {
  return Buffer.from(
    LZString.compressToUint8Array(JSON.stringify(fields)));
}

// handler-only synthetic fixtures reused across handler tests; they are
// built field-by-field to match the deserializer order (NOT produced by a
// live game — the live-game equivalent lives in the root suite). P1
// surrenders so P0 deterministically wins with a surrender kill credit.
const CLOCK_OPTIONS = {
  StartingClock: 20, ClockIncrement: 0, DontLimitMoveSpeed: true,
};
const LEGACY_CLOCK_OPTIONS = {
  StartingClock: 10, ClockIncrement: 5, DontLimitMoveSpeed: false,
};

const PLAIN_REPLAY = compressReplay(makeReplayFields({
  id: 'replay-plain',
  modifiers: [9, 10],
}));

// a completed game has a finite death offset for every player: the live
// endgame cleanup kills the survivors too, so the winner's offset equals
// the final game time
const CLOCK_ELAPSED = {
  turns: [0, 400, 800, 1200, 1600, 2000],
  players: [2000, 1800],
  duration: 2000,
};

const EXACT_CLOCK_REPLAY = compressReplay(makeReplayFields({
  id: 'replay-clock',
  modifiers: [11],
  modifier_options: { ChessClock: CLOCK_OPTIONS },
  execTimestamps: [0, 0.4, 0.8, 1.2, 1.6, 2.0],
  chessClockElapsed: CLOCK_ELAPSED,
}));

const LEGACY_CLOCK_REPLAY = compressReplay(makeReplayFields({
  id: 'replay-legacy-clock',
  version: 18,
  modifiers: [11],
}));

// a v20 (wire 19) clock replay whose elapsed metadata is still in-progress shaped:
// duration null and a surviving player — scoring must refuse it
const INCOMPLETE_CLOCK_REPLAY = compressReplay(makeReplayFields({
  id: 'replay-incomplete-clock',
  modifiers: [11],
  modifier_options: { ChessClock: CLOCK_OPTIONS },
  execTimestamps: [0, 0.4, 0.8, 1.2, 1.6, 2.0],
  chessClockElapsed: {
    turns: [0, 400, 800, 1200, 1600, 2000],
    players: [null, 1800],
    duration: null,
  },
}));

// valid 2v2 match fixtures: four usernames on real two-player teams. Both
// B-team members surrender so team A deterministically wins.
const MATCH_USERNAMES = ['A0', 'A1', 'B0', 'B1'];
const MATCH_TEAMS = [1, 1, 2, 2];
const MATCH_AFKS = [[2, 5], [3, 5]];
const MATCH_CLOCK_ELAPSED = {
  turns: [0, 400, 800, 1200, 1600, 2000],
  players: [2000, 2000, 1800, 1600],  // winners die in endgame cleanup
  duration: 2000,
};

const MATCH_PLAIN_REPLAY = compressReplay(makeReplayFields({
  id: 'replay-match-plain',
  usernames: MATCH_USERNAMES,
  generals: [0, 3, 5, 8],
  afks: MATCH_AFKS,
  teams: MATCH_TEAMS,
  modifiers: [9, 10],
}));

const MATCH_EXACT_CLOCK_REPLAY = compressReplay(makeReplayFields({
  id: 'replay-match-clock',
  usernames: MATCH_USERNAMES,
  generals: [0, 3, 5, 8],
  afks: MATCH_AFKS,
  teams: MATCH_TEAMS,
  modifiers: [11],
  modifier_options: { ChessClock: CLOCK_OPTIONS },
  execTimestamps: [0, 0.4, 0.8, 1.2, 1.6, 2.0],
  chessClockElapsed: MATCH_CLOCK_ELAPSED,
}));

const MATCH_LEGACY_CLOCK_REPLAY = compressReplay(makeReplayFields({
  id: 'replay-match-legacy-clock',
  version: 18,
  usernames: MATCH_USERNAMES,
  generals: [0, 3, 5, 8],
  afks: MATCH_AFKS,
  teams: MATCH_TEAMS,
  modifiers: [11],
}));

const ADV_USERNAMES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const ADV_REPLAY = compressReplay(makeReplayFields({
  id: 'replay-adv',
  mapWidth: 4,
  mapHeight: 4,
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
  modifiers: [9, 10],
}));

const EARLY_REPLAY_2 = compressReplay(makeReplayFields({
  id: 'replay-early2',
  mapWidth: 4,
  mapHeight: 4,
  usernames: MATCH_USERNAMES,
  generals: [0, 15, 1, 8],
  moves: [
    [0, 0, 4, 0, 4], [0, 0, 4, 0, 6], [0, 0, 4, 0, 8],
    [2, 1, 0, 0, 10],
  ],
  afks: [[2, 20], [3, 20]],
  teams: [1, 1, 2, 2],
  modifiers: [9, 10],
}));

const EARLY_REPLAY = compressReplay(makeReplayFields({
  id: 'replay-early',
  mapWidth: 4,
  mapHeight: 4,
  usernames: MATCH_USERNAMES,
  generals: [0, 15, 1, 8],
  moves: [
    [0, 0, 4, 0, 4], [0, 0, 4, 0, 6], [0, 0, 4, 0, 8],
    [2, 1, 0, 0, 10],
  ],
  afks: [[2, 20], [3, 20]],
  teams: [1, 1, 2, 2],
  modifiers: [9, 10],
}));

// --------------------------------------------------- axios interception ---

let getCalls = [];
let replayListResponse = [];

function stubAxios() {
  const fakeGet = url => {
    getCalls.push(url);
    if (url.endsWith('.gior')) {
      const id = url.slice(url.lastIndexOf('/') + 1, -'.gior'.length);
      const buffers = {
        'replay-plain': PLAIN_REPLAY,
        'replay-clock': EXACT_CLOCK_REPLAY,
        'replay-legacy-clock': LEGACY_CLOCK_REPLAY,
        'replay-incomplete-clock': INCOMPLETE_CLOCK_REPLAY,
        'replay-match-plain': MATCH_PLAIN_REPLAY,
        'replay-match-clock': MATCH_EXACT_CLOCK_REPLAY,
        'replay-match-legacy-clock': MATCH_LEGACY_CLOCK_REPLAY,
        'replay-adv': ADV_REPLAY,
        'replay-early': EARLY_REPLAY,
        'replay-early2': EARLY_REPLAY_2,
      };
      if (!buffers[id]) {
        return Promise.reject(new Error(`unstubbed replay ${id}`));
      }
      return Promise.resolve({ data: buffers[id] });
    }
    if (url.includes('replaysForUsername')) {
      return Promise.resolve({ data: replayListResponse });
    }
    return Promise.resolve({ data: [] });
  };
  axios.get = fakeGet;
  axios.default.get = fakeGet;
  functionsAxios.get = fakeGet;
  functionsAxios.default.get = fakeGet;
}

// ---------------------------------------------------------- test parts ---

function testOptionContracts() {
  // every registered id survives normalization individually (the full set
  // is itself an exclusion combo), and compatible sets survive together
  for (let id = 0; id <= 11; id++) {
    assert.deepStrictEqual(normalizeModifierIds([id]), [id],
      `modifier id ${id} accepted`);
  }
  assert.deepStrictEqual(normalizeModifierIds([0, 1, 4, 5, 7, 9, 10, 11]),
    [0, 1, 4, 5, 7, 9, 10, 11], 'compatible subset accepted');
  assert.deepStrictEqual(normalizeModifierIds('9,10,11'), [9, 10, 11]);
  assert.deepStrictEqual(normalizeModifierIds(['9', '10']), [9, 10]);
  assert.deepStrictEqual(normalizeModifierIds(null), []);
  assert.deepStrictEqual(normalizeModifierIds(undefined), []);

  // unknown/fractional/non-integer ids reject instead of stripping
  for (const bad of [[12], [-1], [1.5], ['x'], [999], 'not-an-id']) {
    assert.throws(() => normalizeModifierIds(bad), /modifier/i,
      `bad modifiers ${JSON.stringify(bad)} rejected`);
  }

  // exclusion combos reject
  for (const combo of [[2, 3], [3, 6], [3, 8]]) {
    assert.throws(() => normalizeModifierIds(combo), /excludes/i,
      `excluded combo ${combo} rejected`);
  }

  // validateEventGameOptions reports errors without throwing
  assert.strictEqual(validateEventGameOptions({ modifiers: [0, 1] }).valid, true);
  assert.strictEqual(validateEventGameOptions({ modifiers: [3, 8] }).valid,
    false);
  assert.strictEqual(validateEventGameOptions({
    modifiers: [11],
    modifier_options: { ChessClock: { StartingClock: 0 } },
  }).valid, false, 'StartingClock below minimum invalid');

  // ChessClock option normalization: strings coerce, zero/false preserved
  const clock = EventGameOptions.normalizeChessClockOptions(
    { StartingClock: '25', ClockIncrement: '0', DontLimitMoveSpeed: false });
  assert.deepStrictEqual(clock,
    { StartingClock: 25, ClockIncrement: 0, DontLimitMoveSpeed: false });
  assert.throws(() => EventGameOptions.normalizeChessClockOptions(
    { StartingClock: Infinity }), /StartingClock/i);
  assert.throws(() => EventGameOptions.normalizeChessClockOptions(
    { DontLimitMoveSpeed: 'yes' }), /DontLimitMoveSpeed/i);

  // strict numeric parsing: partial strings, arrays, objects, booleans and
  // blank strings reject; decimal strings and zero survive
  for (const bad of ['5junk', ['5'], { v: 5 }, true, '   ']) {
    assert.throws(() => EventGameOptions.normalizeChessClockOptions(
      { StartingClock: bad }), /StartingClock/i,
    `StartingClock must reject ${JSON.stringify(bad)}`);
    assert.throws(() => EventGameOptions.normalizeChessClockOptions(
      { ClockIncrement: bad }), /ClockIncrement/i,
    `ClockIncrement must reject ${JSON.stringify(bad)}`);
  }
  const decimal = EventGameOptions.normalizeChessClockOptions(
    { StartingClock: '2.5', ClockIncrement: 0, DontLimitMoveSpeed: false });
  assert.strictEqual(decimal.StartingClock, 2.5,
    'decimal string form must survive');
  assert.strictEqual(decimal.ClockIncrement, 0, 'zero increment preserved');

  // unrelated options survive normalization; unknown modifier option keys
  // reject rather than persisting a wrong configuration
  const normalized = normalizeEventGameOptions({
    city_fairness: 0.5,
    modifiers: '9,11',
    modifier_options: { ChessClock: { StartingClock: 30 } },
  });
  assert.strictEqual(normalized.city_fairness, 0.5);
  assert.deepStrictEqual(normalized.modifiers, [9, 11]);
  assert.deepStrictEqual(normalized.modifier_options,
    { ChessClock: { StartingClock: 30, ClockIncrement: 5,
      DontLimitMoveSpeed: false } });
  assert.throws(() => normalizeEventGameOptions({
    modifier_options: { UnknownMod: { x: 1 } },
  }), /modifier option/i, 'unknown modifier option key rejected');
  console.log('  option contracts passed');
}

function testReplayMatchContracts() {
  const replay = { modifiers: [9, 10], modifier_options: null };
  // exact set match passes
  EventGameOptions.assertReplayMatchesExpectedOptions(
    replay, { modifiers: [10, 9] });
  // wrong set rejects
  assert.throws(() => EventGameOptions.assertReplayMatchesExpectedOptions(
    replay, { modifiers: [9] }), /do not match/);
  assert.throws(() => EventGameOptions.assertReplayMatchesExpectedOptions(
    replay, { modifiers: null }), /do not match/);
  // absent modifiers field keeps legacy unspecified behavior
  EventGameOptions.assertReplayMatchesExpectedOptions(replay, {});
  // unknown ids in the replay fail closed even without expected options
  assert.throws(() => EventGameOptions.assertReplayMatchesExpectedOptions(
    { modifiers: [99] }, null), /modifier/i);

  // clock config comparison uses effective defaults
  const clockReplay = {
    modifiers: [11],
    modifier_options: { ChessClock: { StartingClock: 20, ClockIncrement: 0 } },
  };
  EventGameOptions.assertReplayMatchesExpectedOptions(
    clockReplay, { modifiers: [11], modifier_options: { ChessClock: {
      StartingClock: 20, ClockIncrement: 0, DontLimitMoveSpeed: false } } });
  assert.throws(() => EventGameOptions.assertReplayMatchesExpectedOptions(
    clockReplay, { modifiers: [11], modifier_options: { ChessClock: {
      StartingClock: 21 } } }), /ChessClock/);
  assert.throws(() => EventGameOptions.assertReplayMatchesExpectedOptions(
    clockReplay, { modifiers: [11], modifier_options: { ChessClock: {
      ClockIncrement: 1 } } }), /ChessClock/);
  console.log('  replay match contracts passed');
}

function makeCreatePage() {
  const created = [];
  const updated = [];
  const dismissed = [];
  const eventService = {
    createEvent: async data => {
      created.push(data);
      return 'new-id';
    },
    updateEvent: async (id, data) => {
      updated.push({ id, data });
    },
    getEvent: () => ({ pipe: () => ({ subscribe: () => {} }) }),
  };
  const modal = { dismiss: () => dismissed.push(true) };
  const nav = { get: () => null };
  const page = new CreateEventPage(eventService, modal, nav);
  page.date = '2030-01-01';
  page.time = '12:00:00';
  page.visibility = Visibility.PUBLIC;
  page.type = EventType.FFA;
  page.format = EventFormat.ARENA;
  page.duration = 60;
  page.speed = GameSpeed.SPEED_1X;
  return { page, created, updated, dismissed };
}

async function testCreateEventModifiers() {
  // create with all newer modifiers + clock options + tunnel/stronghold
  {
    const { page, created } = makeCreatePage();
    page.modifiers = [9, 10, 11];
    page.chessClockStarting = 30;
    page.chessClockIncrement = 2.5;
    page.chessClockDontLimit = true;
    page.tunnels = 0.5;
    page.tunnelMin = 15;
    page.tunnelMax = 40;
    page.strongholds = 0.25;
    page.strongholdMin = 8;
    page.strongholdMax = 20;
    await page.create();
    assert.strictEqual(created.length, 1, 'event created');
    const options = created[0].options;
    assert.deepStrictEqual(options.modifiers, [9, 10, 11],
      'numeric modifier ids persisted');
    assert.deepStrictEqual(options.modifier_options, { ChessClock: {
      StartingClock: 30, ClockIncrement: 2.5, DontLimitMoveSpeed: true } },
    'clock options persisted');
    assert.strictEqual(options.tunnels, 0.5);
    assert.strictEqual(options.tunnel_min, 15);
    assert.strictEqual(options.tunnel_max, 40);
    assert.strictEqual(options.strongholds, 0.25);
    assert.strictEqual(options.stronghold_min, 8);
    assert.strictEqual(options.stronghold_max, 20);
  }

  // zero increment / false flag / zero tunnels must not be dropped
  {
    const { page, created } = makeCreatePage();
    page.modifiers = [11];
    page.chessClockStarting = 1;
    page.chessClockIncrement = 0;
    page.chessClockDontLimit = false;
    await page.create();
    assert.strictEqual(created.length, 1);
    const options = created[0].options;
    assert.deepStrictEqual(options.modifier_options, { ChessClock: {
      StartingClock: 1, ClockIncrement: 0, DontLimitMoveSpeed: false } },
    'zero increment and false flag preserved');
    assert.strictEqual(options.tunnels, 0);
  }

  // invalid modifier combo refuses to persist
  {
    const { page, created, dismissed } = makeCreatePage();
    page.modifiers = [3, 8];
    await page.create();
    assert.strictEqual(created.length, 0, 'excluded combo not persisted');
    assert.strictEqual(dismissed.length, 0);
  }

  // a malformed DontLimitMoveSpeed value invalidates the form instead of
  // being silently coerced to false
  {
    const { page, created } = makeCreatePage();
    page.modifiers = [11];
    page.chessClockStarting = 30;
    page.chessClockDontLimit = 'yes';
    assert.strictEqual(page.gameOptionsValid, false,
      'non-boolean DontLimitMoveSpeed must invalidate the form');
    assert.strictEqual(page.invalid, true);
    await page.create();
    assert.strictEqual(created.length, 0,
      'malformed DontLimitMoveSpeed must not persist');
  }

  // malformed clock numbers (partial strings) refuse to persist
  {
    const { page, created } = makeCreatePage();
    page.modifiers = [11];
    page.chessClockStarting = '5junk';
    assert.strictEqual(page.gameOptionsValid, false);
    await page.create();
    assert.strictEqual(created.length, 0,
      'partial-string clock value must not persist');
  }
  console.log('  create-event modifiers passed');
}

async function testEditEventModifiers() {
  const { page, updated } = makeCreatePage();
  page.isEditMode = true;
  page.eventId = 'evt9';
  page.event = {
    name: 'edit me',
    type: EventType.FFA,
    format: EventFormat.ARENA,
    visibility: Visibility.PUBLIC,
    startTime: new Date('2030-06-01T12:00:00').getTime(),
    endTime: new Date('2030-06-01T13:00:00').getTime(),
    options: {
      modifiers: '9,11',   // legacy comma-string storage
      modifier_options: { ChessClock: { StartingClock: 45 } },
      speed: GameSpeed.SPEED_1X,
      unrelated_future_option: 'keep-me',
    },
  };
  page.loadEventData();

  // legacy string modifiers normalize to numeric ids for the form
  assert.deepStrictEqual(page.modifiers, [9, 11]);
  assert.strictEqual(page.chessClockStarting, 45);
  assert.strictEqual(page.chessClockIncrement, 5,
    'missing increment falls back to the default for editing');
  assert.strictEqual(page.chessClockSelected, true);

  await page.create();
  assert.strictEqual(updated.length, 1);
  const options = updated[0].data.options;
  assert.deepStrictEqual(options.modifiers, [9, 11]);
  assert.strictEqual(options.unrelated_future_option, 'keep-me',
    'unrelated stored option survives the edit merge');
  assert.deepStrictEqual(options.modifier_options.ChessClock,
    { StartingClock: 45, ClockIncrement: 5, DontLimitMoveSpeed: false });

  // removing ChessClock from the selection drops its stored options
  {
    const { page: p2, updated: u2 } = makeCreatePage();
    p2.isEditMode = true;
    p2.eventId = 'evt10';
    p2.event = {
      type: EventType.FFA,
      format: EventFormat.ARENA,
      visibility: Visibility.PUBLIC,
      startTime: new Date('2030-06-01T12:00:00').getTime(),
      endTime: new Date('2030-06-01T13:00:00').getTime(),
      options: {
        modifiers: [11],
        modifier_options: { ChessClock: { StartingClock: 45 } },
      },
    };
    p2.loadEventData();
    p2.modifiers = [9];
    await p2.create();
    assert.strictEqual(u2.length, 1);
    assert.deepStrictEqual(u2[0].data.options.modifiers, [9]);
    assert.strictEqual(u2[0].data.options.modifier_options, undefined,
      'ChessClock options dropped when the modifier is unselected');
  }
  console.log('  edit-event modifiers passed');
}

function testLobbyUrlModifiers() {
  const opened = [];
  const priorWindow = global.window;
  const priorLocation = global.location;
  const setLocation = (href, hostname, port) => {
    const location = { href, hostname, port };
    global.location = location;
    global.window = {
      open: url => opened.push(url), addEventListener() {}, location };
  };
  setLocation('https://events.generals.io/', 'events.generals.io', '');

  try {
    const util = new UtilService();
    const generals = new GeneralsService(
      { httpsCallable: () => ({ toPromise: async () => [] }) },
      { authState: { subscribe: () => {} } },
      { navigate: () => {} },
      util);

    const event = {
      id: 'evt1',
      type: EventType.FFA,
      server: 'na',
      options: {
        modifiers: [9, 11],
        modifier_options: { ChessClock: {
          StartingClock: 30, ClockIncrement: 0, DontLimitMoveSpeed: true } },
      },
    };

    generals.joinLobby('event_arena', event, true);
    const url = opened[0];
    const params = new URLSearchParams(url.split('?')[1]);
    assert.strictEqual(params.get('modifiers'), '9,11',
      `modifiers serialize comma-delimited: ${url}`);
    const parsedOptions = JSON.parse(params.get('modifier_options'));
    assert.deepStrictEqual(parsedOptions, { ChessClock: {
      StartingClock: 30, ClockIncrement: 0, DontLimitMoveSpeed: true } },
    'modifier_options serialize as JSON preserving 0/false');
    assert.strictEqual(params.get('eventId'), 'evt1');
    assert.strictEqual(params.get('eventDevPort'), null,
      `production joins omit eventDevPort: ${url}`);

    for (const devPort of ['8100', '4200']) {
      setLocation(`http://localhost:${devPort}/`, 'localhost', devPort);
      generals.joinLobby('event_arena', event, true);
      const devUrl = opened[opened.length - 1];
      const devParams = new URLSearchParams(devUrl.split('?')[1]);
      assert.strictEqual(devParams.get('eventDevPort'), devPort,
        `accepted dev port is forwarded: ${devUrl}`);
    }
    setLocation('http://127.0.0.1:8100/', '127.0.0.1', '8100');
    generals.joinLobby('event_arena', event, true);
    const loopbackUrl = opened[opened.length - 1];
    assert.strictEqual(
      new URLSearchParams(loopbackUrl.split('?')[1]).get('eventDevPort'),
      '8100', `loopback dev port is forwarded: ${loopbackUrl}`);
    setLocation('http://localhost:3000/', 'localhost', '3000');
    generals.joinLobby('event_arena', event, true);
    const otherPortUrl = opened[opened.length - 1];
    assert.strictEqual(
      new URLSearchParams(otherPortUrl.split('?')[1]).get('eventDevPort'),
      null, `unlisted dev port is omitted: ${otherPortUrl}`);

    // malformed stored modifier config throws rather than silently emitting a
    // wrong lobby URL
    const badEvent = { ...event, options: { modifiers: 'bogus' } };
    assert.throws(() => generals.joinLobby('event_arena', badEvent, true),
      /modifier/i);
  } finally {
    if (priorWindow === undefined) {
      delete global.window;
    } else {
      global.window = priorWindow;
    }
    if (priorLocation === undefined) {
      delete global.location;
    } else {
      global.location = priorLocation;
    }
  }
  console.log('  lobby url modifiers passed');
}

// -------------------------------------------------- backend integration ---

function seedArena(db, options) {
  db.doc('events/arena1').set({
    type: EventType.FFA,
    server: 'na',
    options,
    endTime: Infinity,
    replays: [],
    ongoingGameCount: 1,
    completedGameCount: 0,
  });
  db.doc('events/arena1/games/g1').set({
    replayId: 'replay-clock',
    started: 1000000,
    players: ['P0', 'P1'],
    timesChecked: 0,
  });
  db.doc('events/arena1/players/P0').set(
    { name: 'P0', points: 0, currentStreak: 0 });
  db.doc('events/arena1/players/P1').set(
    { name: 'P1', points: 0, currentStreak: 0 });
}

// seeds a REAL 2v2 roster: two-player teams A and B with a player document
// for each of the four participants
function seedMatchEvent(db, prefix, matchCollection, options) {
  const event = {
    type: EventType.TWO_VS_TWO,
    server: 'na',
    options,
    endTime: Infinity,
    replays: [],
    completedGameCount: 0,
  };
  db.doc(`events/${prefix}`).set(event);
  db.doc(`events/${prefix}/${matchCollection}/m1`).set({
    status: MatchStatus.READY,
    players: MATCH_USERNAMES,
    started: 1000,
    number: '5',
    teams: [
      { name: 'A', players: ['A0', 'A1'] },
      { name: 'B', players: ['B0', 'B1'] },
    ],
  });
  for (const name of MATCH_USERNAMES) {
    db.doc(`events/${prefix}/players/${name}`).set({ name, points: 0 });
  }
}

// clears the write journal left behind by .set() seeding so assertions
// only count writes performed by the handler itself
function resetWriteJournal(db) {
  db.invocations.length = 0;
  db.completedWrites.length = 0;
}

async function invokeHandler(path, afterRef, beforeExists = true) {
  const before = beforeExists ? await afterRef.get() : { exists: false };
  const after = await afterRef.get();
  return HANDLERS[path].onWrite({ before, after }, { params: {} });
}

async function testArenaWriter() {
  const handler = 'events/{eventId}/games/{gameId}';
  assert.ok(HANDLERS[handler] && HANDLERS[handler].onWrite,
    'games onWrite handler registered');

  // valid exact-clock replay: full write path persists elapsed/finished
  {
    const db = new FakeFirestore();
    global.__testFirestore = db;
    getCalls = [];
    stubAxios();
    seedArena(db, {
      modifiers: [11],
      modifier_options: { ChessClock: CLOCK_OPTIONS },
    });
    const gameRef = db.doc('events/arena1/games/g1');
    await invokeHandler(handler, gameRef);

    const event = db.dataAt('events/arena1');
    assert.deepStrictEqual(event.replays, ['replay-clock'],
      'replay tracked on the event');
    assert.strictEqual(event.completedGameCount, 1);
    assert.strictEqual(event.ongoingGameCount, 0);

    const game = db.dataAt('events/arena1/games/g1');
    assert.strictEqual(game.elapsedMs, 2000, 'exact duration persisted');
    assert.strictEqual(game.finished, 1000000 + 2000,
      'finished is started + exact elapsed, not turn-derived');
    assert.strictEqual(game.replay.scores[0].name, 'P0');
    assert.strictEqual(game.replay.scores[0].elapsedMs, 2000,
      'winner cleanup death offset is the final game time');
    assert.strictEqual(game.replay.scores[1].elapsedMs, 1800,
      'loser records the death offset');

    const winner = db.dataAt('events/arena1/players/P0');
    assert.ok(winner.record.length === 1, 'winner record appended');
    assert.strictEqual(winner.record[0].finished, 1000000 + 2000);
    assert.ok(winner.points > 0);
    const loser = db.dataAt('events/arena1/players/P1');
    assert.strictEqual(loser.record[0].finished, 1000000 + 1800,
      'loser finished at the death offset');
    assert.ok(db.dataAt('events/arena1/records/replay-clock_P0'),
      'record document written');
    assert.strictEqual(getCalls.filter(u => u.endsWith('.gior')).length, 1,
      'only the local replay read hit the network');
  }

  // legacy clock replay without elapsed metadata: finished stays unknown
  {
    const db = new FakeFirestore();
    global.__testFirestore = db;
    getCalls = [];
    stubAxios();
    seedArena(db, {
      modifiers: [11],
      modifier_options: { ChessClock: LEGACY_CLOCK_OPTIONS },
    });
    db.doc('events/arena1/games/g1').set({
      replayId: 'replay-legacy-clock',
      started: 1000000,
      players: ['P0', 'P1'],
    });
    const gameRef = db.doc('events/arena1/games/g1');
    await invokeHandler(handler, gameRef);
    const game = db.dataAt('events/arena1/games/g1');
    assert.strictEqual(game.finished, null,
      'legacy clock replay leaves finished unknown');
    assert.strictEqual(game.elapsedMs, null,
      'legacy clock replay reports explicitly unknown elapsed');
    const loser = db.dataAt('events/arena1/players/P1');
    assert.strictEqual(loser.record[0].finished, null,
      'per-player finish also unknown for legacy clocks');
  }

  // non-clock replay: fixed-speed finished time, no elapsed fields
  {
    const db = new FakeFirestore();
    global.__testFirestore = db;
    getCalls = [];
    stubAxios();
    seedArena(db, { modifiers: [9, 10] });
    db.doc('events/arena1/games/g1').set({
      replayId: 'replay-plain',
      started: 1000000,
      players: ['P0', 'P1'],
    });
    const gameRef = db.doc('events/arena1/games/g1');
    await invokeHandler(handler, gameRef);
    const game = db.dataAt('events/arena1/games/g1');
    assert.ok(Number.isFinite(game.finished) && game.finished > 1000000,
      'non-clock replay uses the fixed-speed finish estimate');
    assert.strictEqual(game.elapsedMs, undefined,
      'no elapsed field emitted for non-clock replays');
  }
  console.log('  arena writer passed');
}

// shared per-fixture expectations for both match writers
const MATCH_FIXTURES = [
  {
    label: 'plain modifiers',
    replayId: 'replay-match-plain',
    eventOptions: { modifiers: [9, 10] },
    assertMatchReplay(matchReplay) {
      assert.ok(Number.isFinite(matchReplay.finished),
        'plain replay finished via fixed-speed estimate');
      assert.strictEqual(matchReplay.elapsedMs, undefined,
        'no elapsed field for non-clock replays');
    },
    assertPlayerFinished(record) {
      assert.ok(Number.isFinite(record.finished),
        'plain replay player finish is finite');
    },
  },
  {
    label: 'exact clock',
    replayId: 'replay-match-clock',
    eventOptions: { modifiers: [11], modifier_options: {
      ChessClock: CLOCK_OPTIONS } },
    assertMatchReplay(matchReplay) {
      assert.strictEqual(matchReplay.elapsedMs, 2000,
        'exact duration persisted');
      assert.strictEqual(matchReplay.finished, 5000 + 2000,
        'finished is started + exact elapsed');
      assert.strictEqual(matchReplay.replay.scores[0].elapsedMs, 2000);
    },
    assertPlayerFinished(record, name) {
      const offset = { A0: 2000, A1: 2000, B0: 1800, B1: 1600 }[name];
      assert.strictEqual(record.finished, 5000 + offset,
        `${name} finished at started + its death offset`);
    },
  },
  {
    label: 'legacy clock',
    replayId: 'replay-match-legacy-clock',
    eventOptions: { modifiers: [11], modifier_options: {
      ChessClock: LEGACY_CLOCK_OPTIONS } },
    assertMatchReplay(matchReplay) {
      assert.strictEqual(matchReplay.finished, null,
        'legacy clock replay leaves finished unknown');
      assert.strictEqual(matchReplay.elapsedMs, null,
        'legacy clock replay reports explicitly unknown elapsed');
    },
    assertPlayerFinished(record) {
      assert.strictEqual(record.finished, null,
        'legacy clock player finish also unknown');
    },
  },
];

async function runMatchWriterFixtures(prefix, collection, handlerPath,
  resultsKey) {
  for (const fixture of MATCH_FIXTURES) {
    const db = new FakeFirestore();
    global.__testFirestore = db;
    getCalls = [];
    replayListResponse = [
      { id: fixture.replayId, started: 5000, ranking: [0, 1, 2, 3] },
    ];
    stubAxios();
    seedMatchEvent(db, prefix, collection, fixture.eventOptions);

    const matchRef = db.doc(`events/${prefix}/${collection}/m1`);
    await invokeHandler(handlerPath, matchRef);

    const event = db.dataAt(`events/${prefix}`);
    assert.deepStrictEqual(event.replays, [fixture.replayId],
      `${fixture.label}: replay tracked`);
    assert.strictEqual(event.completedGameCount, 1);
    const results = resultsKey === 'bracket'
        ? event.bracket.results
        : event.results;
    assert.strictEqual(results['5'].team1Score, 1,
      `${fixture.label}: winning team counter incremented`);

    const match = db.dataAt(`events/${prefix}/${collection}/m1`);
    assert.strictEqual(match.replays.length, 1);
    const matchReplay = match.replays[0];
    assert.strictEqual(matchReplay.replayId, fixture.replayId);
    assert.strictEqual(matchReplay.replay.scores[0].name, 'A0',
      `${fixture.label}: team-A member tops the scores`);
    fixture.assertMatchReplay(matchReplay);

    for (const name of ['A0', 'A1']) {
      const player = db.dataAt(`events/${prefix}/players/${name}`);
      assert.strictEqual(player.record.length, 1);
      assert.strictEqual(player.record[0].rank, 1,
        `${fixture.label}: winning team member ${name} ranked first`);
      fixture.assertPlayerFinished(player.record[0], name);
    }
    for (const name of ['B0', 'B1']) {
      const player = db.dataAt(`events/${prefix}/players/${name}`);
      assert.strictEqual(player.record[0].rank, 2,
        `${fixture.label}: losing team member ${name} ranked second`);
      fixture.assertPlayerFinished(player.record[0], name);
    }

    assert.strictEqual(
      getCalls.filter(u => u.includes('replaysForUsername')).length, 4,
      `${fixture.label}: one replay list read per roster player`);
    assert.strictEqual(getCalls.filter(u => u.endsWith('.gior')).length, 1,
      `${fixture.label}: single replay payload read`);
  }
}

async function testBracketWriter() {
  const handler = 'events/{eventId}/matches/{matchId}';
  assert.ok(HANDLERS[handler] && HANDLERS[handler].onWrite,
    'matches onWrite handler registered');
  await runMatchWriterFixtures('br1', 'matches', handler, 'bracket');
  console.log('  bracket writer passed');
}

async function testDypWriter() {
  const handler = 'events/{eventId}/dyp-matches/{matchId}';
  assert.ok(HANDLERS[handler] && HANDLERS[handler].onWrite,
    'dyp-matches onWrite handler registered');
  await runMatchWriterFixtures('dyp1', 'dyp-matches', handler, 'results');
  console.log('  dyp writer passed');
}

const priorWin = (name, replayId, teamId, finished) => ({
  name, kills: 0, rank: 1, points: 2, lastTurn: 10,
  tilesAfterFirstRound: 1, streak: false, teamCount: 2, teamId,
  started: finished - 1000, finished, replayId,
});

function seedDypMatch(db, eventId, matchId, teams, options) {
  db.doc(`events/${eventId}`).set({
    type: EventType.TWO_VS_TWO,
    server: 'na',
    options,
    endTime: Infinity,
    replays: [],
    completedGameCount: 0,
    results: {},
  });
  const players = teams.flat();
  db.doc(`events/${eventId}/dyp-matches/${matchId}`).set({
    number: '7',
    teams: teams.map(team => ({ players: team.slice(), score: 0 })),
    status: MatchStatus.READY,
    players: players.slice(),
    started: 1000,
    timesChecked: 1000,
    replays: [],
  });
  for (const name of players) {
    db.doc(`events/${eventId}/players/${name}`).set(
      { name, points: 0, record: [] });
  }
}

async function testDypTeamOutcomes() {
  const handler = 'events/{eventId}/dyp-matches/{matchId}';
  const db = new FakeFirestore();
  global.__testFirestore = db;
  getCalls = [];
  replayListResponse = [
    { id: 'replay-adv', started: 5000, ranking: [0, 1, 2, 3, 4, 5] },
  ];
  stubAxios();
  seedDypMatch(db, 'dyp3', 'm7',
    [['A1', 'A2'], ['B1', 'B2'], ['C1', 'C2']], { modifiers: [9, 10] });
  await invokeHandler(handler, db.doc('events/dyp3/dyp-matches/m7'));

  const event = db.dataAt('events/dyp3');
  assert.strictEqual(event.results['7'].team3Score, 1,
    'winning team C increments its game win count');
  assert.strictEqual(event.results['7'].team1Score, undefined);
  assert.strictEqual(event.results['7'].team2Score, undefined);

  const match = db.dataAt('events/dyp3/dyp-matches/m7');
  const detail = match.replays[0].replay;
  assert.ok(detail.teams && detail.teamOutcomes,
    'scored team outcomes persisted in replay detail');
  assert.strictEqual(detail.scores[0].name, 'C1');
  assert.strictEqual(detail.teams.find(t => t.id === '2').rank, 1);
  assert.strictEqual(detail.teams.find(t => t.id === '1').rank, 2,
    'team B outlived team A despite the individual order');
  assert.strictEqual(detail.teams.find(t => t.id === '0').rank, 3);

  for (const [name, rank, points] of [
    ['A1', 3, 1], ['A2', 3, 1], ['B1', 2, 1], ['B2', 2, 1],
    ['C1', 1, 10], ['C2', 1, 10]]) {
    const record = db.dataAt(`events/dyp3/players/${name}`).record[0];
    assert.strictEqual(record.rank, rank, `${name} shared team rank`);
    assert.strictEqual(record.points, points, `${name} shared team base`);
    assert.strictEqual(record.teamCount, 3);
  }
  console.log('  dyp team outcomes passed');
}

async function testDypTeamPartitionRejects() {
  const handler = 'events/{eventId}/dyp-matches/{matchId}';
  const db = new FakeFirestore();
  global.__testFirestore = db;
  getCalls = [];
  replayListResponse = [
    { id: 'replay-adv', started: 5000, ranking: [0, 1, 2, 3, 4, 5] },
  ];
  stubAxios();
  seedDypMatch(db, 'dyp3', 'm7',
    [['A1', 'B1'], ['A2', 'B2'], ['C1', 'C2']], { modifiers: [9, 10] });
  resetWriteJournal(db);
  await invokeHandler(handler, db.doc('events/dyp3/dyp-matches/m7'));
  assert.strictEqual(db.invocations.length, 0,
    'a mismatched team partition writes nothing');
  assert.strictEqual(getCalls.filter(u => u.endsWith('.gior')).length, 1,
    'only the replay read happened');
  console.log('  dyp team partition rejects passed');
}

async function testBracketTeamOutcomes() {
  const handler = 'events/{eventId}/matches/{matchId}';
  const db = new FakeFirestore();
  global.__testFirestore = db;
  getCalls = [];
  replayListResponse = [
    { id: 'replay-early', started: 5000, ranking: [0, 1, 2, 3] },
  ];
  stubAxios();
  seedMatchEvent(db, 'br2', 'matches', { modifiers: [9, 10] });
  await invokeHandler(handler, db.doc('events/br2/matches/m1'));

  const event = db.dataAt('events/br2');
  assert.strictEqual(event.bracket.results['5'].team1Score, 1,
    'the real winning team increments the series score');
  assert.strictEqual(event.bracket.results['5'].team2Score, undefined);

  const match = db.dataAt('events/br2/matches/m1');
  const detail = match.replays[0].replay;
  assert.strictEqual(detail.scores[0].name, 'B0',
    'a dead killer on the losing team tops the individual list');
  assert.ok(detail.teams && detail.teamOutcomes,
    'scored team outcomes persisted in replay detail');

  const a0 = db.dataAt('events/br2/players/A0').record[0];
  assert.strictEqual(a0.rank, 1);
  assert.strictEqual(a0.points, 2);
  assert.strictEqual(a0.teamCount, 2);
  assert.strictEqual(a0.finished, 5000 + 5 * 1000,
    'the early-dead teammate keeps its real death finish');
  const a1 = db.dataAt('events/br2/players/A1').record[0];
  assert.strictEqual(a1.rank, 1);
  assert.strictEqual(a1.points, 2);
  for (const name of ['B0', 'B1']) {
    const loser = db.dataAt(`events/br2/players/${name}`).record[0];
    assert.strictEqual(loser.rank, 2);
    assert.strictEqual(loser.points, 0);
  }
  console.log('  bracket team outcomes passed');
}

async function testSinglesMatchPaths() {
  for (const [prefix, collection, handlerPath, resultsKey] of [
    ['s1', 'matches', 'events/{eventId}/matches/{matchId}', 'bracket'],
    ['s2', 'dyp-matches',
      'events/{eventId}/dyp-matches/{matchId}', 'results']]) {
    const db = new FakeFirestore();
    global.__testFirestore = db;
    getCalls = [];
    replayListResponse = [
      { id: 'replay-plain', started: 5000, ranking: [0, 1] },
    ];
    stubAxios();
    seedMatchEvent(db, prefix, collection, { modifiers: [9, 10] });
    db.doc(`events/${prefix}/${collection}/m1`).update({
      teams: [{ players: ['P0'] }, { players: ['P1'] }],
      players: ['P0', 'P1'],
    });
    db.doc(`events/${prefix}/players/P0`).set(
      { name: 'P0', points: 0, record: [] });
    db.doc(`events/${prefix}/players/P1`).set(
      { name: 'P1', points: 0, record: [] });
    await invokeHandler(handlerPath,
      db.doc(`events/${prefix}/${collection}/m1`));
    const event = db.dataAt(`events/${prefix}`);
    const results = resultsKey === 'bracket'
        ? event.bracket.results
        : event.results;
    assert.strictEqual(results['5'].team1Score, 1,
      `${collection} singles still increments the winner`);
    const match = db.dataAt(`events/${prefix}/${collection}/m1`);
    assert.strictEqual(match.replays[0].replay.scores[0].name, 'P0');
    assert.strictEqual(match.replays[0].replay.teams, undefined,
      `${collection} singles persist no team detail`);
  }
  console.log('  singles match paths passed');
}

async function testDypTeamStreaks() {
  const handler = 'events/{eventId}/dyp-matches/{matchId}';
  const db = new FakeFirestore();
  global.__testFirestore = db;
  getCalls = [];
  replayListResponse = [
    { id: 'replay-early', started: 5000, ranking: [0, 1, 2, 3] },
  ];
  stubAxios();
  seedDypMatch(db, 'dyp2', 'm7',
    [['A0', 'A1'], ['B0', 'B1']], { modifiers: [9, 10] });
  db.doc('events/dyp2/players/A0').set({
    name: 'A0', points: 4, currentStreak: 2,
    record: [
      priorWin('A0', 'w1', 'ax', 200),
      priorWin('A0', 'w2', 'ay', 400),
    ],
  });
  db.doc('events/dyp2/players/B0').set({
    name: 'B0', points: 2, currentStreak: 1,
    record: [priorWin('B0', 'b1', 'bw', 200)],
  });
  await invokeHandler(handler, db.doc('events/dyp2/dyp-matches/m7'));

  const event = db.dataAt('events/dyp2');
  assert.strictEqual(event.results['7'].team1Score, 1);

  const a0 = db.dataAt('events/dyp2/players/A0');
  assert.strictEqual(a0.points, 8, '2 + 2 + a doubled 4');
  assert.strictEqual(a0.currentStreak, 3);
  const a0Latest = a0.record.find(r => r.replayId === 'replay-early');
  assert.strictEqual(a0Latest.points, 4);
  assert.strictEqual(a0Latest.streak, true);
  assert.strictEqual(a0Latest.teamCount, 2);
  assert.strictEqual(a0Latest.finished, 5000 + 5 * 1000);
  const a1 = db.dataAt('events/dyp2/players/A1');
  assert.strictEqual(a1.points, 2);
  assert.strictEqual(a1.currentStreak, 1);
  assert.strictEqual(a1.record[0].points, 2);
  const b0 = db.dataAt('events/dyp2/players/B0');
  assert.strictEqual(b0.points, 2, 'loser keeps only the prior win');
  assert.strictEqual(b0.currentStreak, 0, 'loss resets the streak');
  const b1 = db.dataAt('events/dyp2/players/B1');
  assert.strictEqual(b1.points, 0);
  assert.strictEqual(b1.currentStreak, 0);

  const detail = db.dataAt('events/dyp2/dyp-matches/m7').replays[0].replay;
  const byName = new Map(detail.scores.map(s => [s.name, s]));
  assert.strictEqual(byName.get('A0').points, 4,
    'replay detail carries the personal award');
  assert.strictEqual(byName.get('A0').streak, true);
  assert.strictEqual(byName.get('A1').points, 2);
  assert.strictEqual(byName.get('A0').teamCount, 2);
  console.log('  dyp team streaks passed');
}

async function testBracketTeamStreaks() {
  const handler = 'events/{eventId}/matches/{matchId}';
  const db = new FakeFirestore();
  global.__testFirestore = db;
  getCalls = [];
  replayListResponse = [
    { id: 'replay-early', started: 5000, ranking: [0, 1, 2, 3] },
  ];
  stubAxios();
  seedMatchEvent(db, 'br3', 'matches', { modifiers: [9, 10] });
  db.doc('events/br3/players/A0').set({
    name: 'A0', points: 4, currentStreak: 2,
    record: [
      priorWin('A0', 'w1', 'ax', 200),
      priorWin('A0', 'w2', 'ay', 400),
    ],
  });
  db.doc('events/br3/players/B0').set({
    name: 'B0', points: 2, currentStreak: 1,
    record: [priorWin('B0', 'b1', 'bw', 200)],
  });
  await invokeHandler(handler, db.doc('events/br3/matches/m1'));

  const event = db.dataAt('events/br3');
  assert.strictEqual(event.bracket.results['5'].team1Score, 1);

  const a0 = db.dataAt('events/br3/players/A0');
  assert.strictEqual(a0.points, 8, '2 + 2 + a doubled 4');
  assert.strictEqual(a0.currentStreak, 3);
  const a0Latest = a0.record.find(r => r.replayId === 'replay-early');
  assert.strictEqual(a0Latest.points, 4);
  assert.strictEqual(a0Latest.streak, true);
  assert.strictEqual(a0Latest.teamCount, 2);
  assert.strictEqual(a0Latest.finished, 5000 + 5 * 1000);
  const a1 = db.dataAt('events/br3/players/A1');
  assert.strictEqual(a1.points, 2);
  assert.strictEqual(a1.currentStreak, 1);
  const b0 = db.dataAt('events/br3/players/B0');
  assert.strictEqual(b0.points, 2, 'loser keeps only the prior win');
  assert.strictEqual(b0.currentStreak, 0, 'loss resets the streak');
  const b1 = db.dataAt('events/br3/players/B1');
  assert.strictEqual(b1.points, 0);
  assert.strictEqual(b1.currentStreak, 0);

  const detail = db.dataAt('events/br3/matches/m1').replays[0].replay;
  const byName = new Map(detail.scores.map(s => [s.name, s]));
  assert.strictEqual(byName.get('A0').points, 4,
    'replay detail carries the personal award');
  assert.strictEqual(byName.get('A0').streak, true);
  assert.strictEqual(byName.get('A1').points, 2);
  assert.strictEqual(byName.get('A0').teamCount, 2);
  console.log('  bracket team streaks passed');
}

async function testTeamMatchIdempotency() {
  for (const [prefix, collection, matchId, number, handlerPath, resultsKey] of [
    ['dupd', 'dyp-matches', 'm7', '7',
      'events/{eventId}/dyp-matches/{matchId}', 'results'],
    ['dupb', 'matches', 'm1', '5',
      'events/{eventId}/matches/{matchId}', 'bracket']]) {
    const db = new FakeFirestore();
    global.__testFirestore = db;
    getCalls = [];
    replayListResponse = [
      { id: 'replay-early', started: 5000, ranking: [0, 1, 2, 3] },
    ];
    stubAxios();
    if (collection === 'dyp-matches') {
      seedDypMatch(db, prefix, matchId,
        [['A0', 'A1'], ['B0', 'B1']], { modifiers: [9, 10] });
    } else {
      seedMatchEvent(db, prefix, collection, { modifiers: [9, 10] });
    }
    db.doc(`events/${prefix}/players/A0`).set({
      name: 'A0', points: 4, currentStreak: 2,
      record: [
        priorWin('A0', 'w1', 'ax', 200),
        priorWin('A0', 'w2', 'ay', 400),
      ],
    });
    const matchRef = db.doc(`events/${prefix}/${collection}/${matchId}`);
    await Promise.all([
      invokeHandler(handlerPath, matchRef),
      invokeHandler(handlerPath, matchRef),
    ]);
    const event = db.dataAt(`events/${prefix}`);
    const results = resultsKey === 'bracket'
        ? event.bracket.results
        : event.results;
    assert.strictEqual(results[number].team1Score, 1,
      `${collection} counts one series win for a duplicate delivery`);
    assert.strictEqual(
      (event.replays || []).filter(id => id === 'replay-early').length,
      1, `${collection} tracks the replay once`);
    const match = db.dataAt(`events/${prefix}/${collection}/${matchId}`);
    assert.strictEqual(match.replays.length, 1);
    const a0 = db.dataAt(`events/${prefix}/players/A0`);
    assert.strictEqual(a0.points, 8,
      `${collection} duplicate delivery does not double-award`);
    assert.strictEqual(a0.currentStreak, 3);
    assert.strictEqual(
      a0.record.filter(r => r.replayId === 'replay-early').length, 1);
  }
  console.log('  team match idempotency passed');
}

async function testTeamMatchDistinctResults() {
  for (const [prefix, collection, matchId, number, handlerPath, resultsKey] of [
    ['seqd', 'dyp-matches', 'm7', '7',
      'events/{eventId}/dyp-matches/{matchId}', 'results'],
    ['seqb', 'matches', 'm1', '5',
      'events/{eventId}/matches/{matchId}', 'bracket']]) {
    const db = new FakeFirestore();
    global.__testFirestore = db;
    getCalls = [];
    replayListResponse = [
      { id: 'replay-early', started: 5000, ranking: [0, 1, 2, 3] },
      { id: 'replay-early2', started: 6000, ranking: [0, 1, 2, 3] },
    ];
    stubAxios();
    if (collection === 'dyp-matches') {
      seedDypMatch(db, prefix, matchId,
        [['A0', 'A1'], ['B0', 'B1']], { modifiers: [9, 10] });
    } else {
      seedMatchEvent(db, prefix, collection, { modifiers: [9, 10] });
    }
    db.doc(`events/${prefix}/players/A0`).set({
      name: 'A0', points: 4, currentStreak: 2,
      record: [
        priorWin('A0', 'w1', 'ax', 200),
        priorWin('A0', 'w2', 'ay', 400),
      ],
    });
    const matchRef = db.doc(`events/${prefix}/${collection}/${matchId}`);
    await invokeHandler(handlerPath, matchRef);
    await invokeHandler(handlerPath, matchRef);
    const event = db.dataAt(`events/${prefix}`);
    const results = resultsKey === 'bracket'
        ? event.bracket.results
        : event.results;
    assert.strictEqual(results[number].team1Score, 2,
      `${collection} counts both distinct completed games`);
    const match = db.dataAt(`events/${prefix}/${collection}/${matchId}`);
    assert.strictEqual(match.replays.length, 2);
    const a0 = db.dataAt(`events/${prefix}/players/A0`);
    assert.strictEqual(a0.record.length, 4,
      `${collection} preserves both records`);
    assert.ok(a0.record.some(r => r.replayId === 'replay-early'));
    assert.ok(a0.record.some(r => r.replayId === 'replay-early2'));
    assert.strictEqual(a0.points, 12, `${collection} 2 + 2 + 4 + 4`);
    assert.strictEqual(a0.currentStreak, 4,
      `${collection} streak normalizes across both wins`);
  }
  console.log('  team match distinct results passed');
}

async function testTeamMatchRetry() {
  for (const [prefix, collection, matchId, number, handlerPath, resultsKey] of [
    ['retd', 'dyp-matches', 'm7', '7',
      'events/{eventId}/dyp-matches/{matchId}', 'results'],
    ['retb', 'matches', 'm1', '5',
      'events/{eventId}/matches/{matchId}', 'bracket']]) {
    const db = new FakeFirestore();
    global.__testFirestore = db;
    getCalls = [];
    replayListResponse = [
      { id: 'replay-early', started: 5000, ranking: [0, 1, 2, 3] },
    ];
    stubAxios();
    if (collection === 'dyp-matches') {
      seedDypMatch(db, prefix, matchId,
        [['A0', 'A1'], ['B0', 'B1']], { modifiers: [9, 10] });
    } else {
      seedMatchEvent(db, prefix, collection, { modifiers: [9, 10] });
    }
    db.doc(`events/${prefix}/players/A0`).set({
      name: 'A0', points: 4, currentStreak: 2,
      record: [
        priorWin('A0', 'w1', 'ax', 200),
        priorWin('A0', 'w2', 'ay', 400),
      ],
    });
    const realRunTransaction = db.runTransaction.bind(db);
    db.runTransaction = async fn => {
      const discarded = {
        get: ref => ref.get(),
        set: () => {}, update: () => {}, delete: () => {},
      };
      await fn(discarded);
      return realRunTransaction(fn);
    };
    await invokeHandler(handlerPath,
      db.doc(`events/${prefix}/${collection}/${matchId}`));
    const a0 = db.dataAt(`events/${prefix}/players/A0`);
    const latest = a0.record.find(r => r.replayId === 'replay-early');
    assert.strictEqual(latest.finished, 5000 + 5 * 1000,
      `${collection} retry keeps the real death finish`);
    assert.strictEqual(latest.points, 4);
    assert.strictEqual(
      a0.record.filter(r => r.replayId === 'replay-early').length, 1);
    const event = db.dataAt(`events/${prefix}`);
    const results = resultsKey === 'bracket'
        ? event.bracket.results
        : event.results;
    assert.strictEqual(results[number].team1Score, 1);
  }
  console.log('  team match retry passed');
}

async function testPlayerUpdateNormalization() {
  const handler = 'events/{eventId}/players/{playerId}';
  const db = new FakeFirestore();
  global.__testFirestore = db;
  getCalls = [];
  stubAxios();
  const baseGet = functionsAxios.get;
  const starsGet = url => url.includes('starsAndRanks')
      ? Promise.resolve({ data: { stars: { duel: 7 } } })
      : baseGet(url);
  axios.get = starsGet;
  axios.default.get = starsGet;
  functionsAxios.get = starsGet;
  functionsAxios.default.get = starsGet;

  db.doc('events/up1').set({
    type: EventType.BIG_TEAM,
    format: EventFormat.ARENA,
    server: 'na',
  });
  const threeWins = [
    priorWin('A0', 'w1', 'ax', 200),
    priorWin('A0', 'w2', 'ay', 400),
    { name: 'A0', kills: 0, rank: 1, points: 4, lastTurn: 10,
      tilesAfterFirstRound: 1, streak: true, teamCount: 2, teamId: 'az',
      started: 500, finished: 600, replayId: 'w3' },
  ];
  db.doc('events/up1/players/A0').set({
    name: 'A0', points: 8, currentStreak: 3, record: threeWins,
  });
  const staleA0 = {
    id: 'A0',
    exists: true,
    ref: db.doc('events/up1/players/A0'),
    data: () => ({
      name: 'A0', points: 4, currentStreak: 2,
      record: threeWins.slice(0, 2).map(r => ({ ...r })),
    }),
  };
  const params = { params: { eventId: 'up1', playerId: 'A0' } };
  await HANDLERS[handler].onUpdate({ before: { exists: true }, after: staleA0 },
    params);
  let player = db.dataAt('events/up1/players/A0');
  assert.strictEqual(player.record.length, 3,
    'the current record survives a stale trigger snapshot');
  assert.strictEqual(player.points, 8);
  assert.strictEqual(player.currentStreak, 3);
  assert.strictEqual(player.stats.totalGames, 3);
  assert.strictEqual(typeof player.stats.currentStars, 'number');

  await HANDLERS[handler].onUpdate({ before: { exists: true }, after: staleA0 },
    params);
  player = db.dataAt('events/up1/players/A0');
  assert.strictEqual(player.record.length, 3,
    'a repeated stale delivery stays idempotent');
  assert.strictEqual(player.points, 8);
  assert.strictEqual(player.currentStreak, 3);

  const overlapping = [
    { name: 'C0', kills: 0, rank: 2, points: 0, lastTurn: 10,
      tilesAfterFirstRound: 1, streak: false, teamCount: 2,
      started: 100, finished: 500, replayId: 'o1' },
    { name: 'C0', kills: 0, rank: 2, points: 0, lastTurn: 10,
      tilesAfterFirstRound: 1, streak: false, teamCount: 2,
      started: 200, finished: 600, replayId: 'o2' },
  ];
  db.doc('events/up1/players/C0').set({
    name: 'C0', points: 0, currentStreak: 0, dq: false,
    record: overlapping.map(r => ({ ...r })),
  });
  const staleC0 = {
    id: 'C0',
    exists: true,
    ref: db.doc('events/up1/players/C0'),
    data: () => ({ name: 'C0', dq: false,
      record: overlapping.map(r => ({ ...r })) }),
  };
  const paramsC = { params: { eventId: 'up1', playerId: 'C0' } };
  await HANDLERS[handler].onUpdate({ before: { exists: true }, after: staleC0 },
    paramsC);
  assert.strictEqual(db.dataAt('events/up1/players/C0').dq, true);
  const messageCount = () => [...db.docs.keys()]
    .filter(k => k.startsWith('events/up1/messages/')).length;
  assert.strictEqual(messageCount(), 1,
    'the dq transition posts exactly one message');
  await HANDLERS[handler].onUpdate({ before: { exists: true }, after: staleC0 },
    paramsC);
  assert.strictEqual(messageCount(), 1,
    'a repeated delivery does not repost the dq message');
  assert.strictEqual(db.dataAt('events/up1/players/C0').dq, true,
    'a stale snapshot never clears a current dq');
  console.log('  player update normalization passed');
}

function testTeamRecordStreaks() {
  const arena = {
    type: EventType.BIG_TEAM,
    format: EventFormat.ARENA,
    teamSize: 2,
    playersPerGame: 4,
    doublesPairingStrategy: 'Bring Your Partner',
  };
  const teamRec = (replayId, finished, rank, points, extra = {}) => ({
    name: 'A', kills: 0, rank, points, lastTurn: 10,
    tilesAfterFirstRound: 1, streak: false,
    started: finished - 1000, finished, replayId,
    teamCount: 2, ...extra,
  });

  {
    const record = [
      teamRec('ab', 1000, 1, 2, { teamId: 'ab' }),
      teamRec('ac', 2000, 1, 2, { teamId: 'ac' }),
      teamRec('ad', 3000, 1, 2, { teamId: 'ad' }),
    ];
    const r = recordSanityCheck(record, arena);
    assert.deepStrictEqual(r.record.map(g => g.points), [2, 2, 4]);
    assert.deepStrictEqual(r.record.map(g => g.streak),
      [false, false, true]);
    assert.strictEqual(r.currentStreak, 3);
    assert.strictEqual(r.points, 8);

    const d = recordSanityCheck(
      [teamRec('ad', 3000, 1, 2, { name: 'D' })], arena);
    assert.deepStrictEqual(d.record.map(g => g.points), [2]);
    assert.strictEqual(d.currentStreak, 1);
    const b = recordSanityCheck(
      [teamRec('ab', 1000, 1, 2, { name: 'B' })], arena);
    assert.strictEqual(b.currentStreak, 1);

    const again = recordSanityCheck(r.record, arena);
    assert.deepStrictEqual(again.record.map(g => g.points), [2, 2, 4]);
    assert.strictEqual(again.currentStreak, 3);
  }

  {
    const record = [
      teamRec('w1', 1000, 1, 2),
      teamRec('w2', 2000, 1, 2),
      teamRec('l1', 3000, 3, 0),
      teamRec('w3', 4000, 1, 2),
    ];
    const r = recordSanityCheck(record, arena);
    assert.deepStrictEqual(r.record.map(g => g.points), [2, 2, 0, 2]);
    assert.strictEqual(r.currentStreak, 1);
  }

  {
    const record = [1, 2, 3].map(i =>
      teamRec('t' + i, i * 1000, 1, 10, { teamCount: 3 }));
    const r = recordSanityCheck(record, arena);
    assert.deepStrictEqual(r.record.map(g => g.points), [10, 10, 10]);
    assert.deepStrictEqual(r.record.map(g => g.streak),
      [false, false, false]);
  }

  {
    const record = [
      teamRec('w3', 3000, 1, 2),
      teamRec('w1', 1000, 1, 2),
      teamRec('w2', 2000, 1, 2),
    ];
    const r = recordSanityCheck(record, arena);
    assert.deepStrictEqual(r.record.map(g => g.points), [2, 2, 4]);
    assert.strictEqual(r.currentStreak, 3);
  }

  {
    const legacy = [1, 2, 3].map(i =>
      teamRec('l' + i, i * 1000, 1, 2, { teamCount: undefined }));
    const r = recordSanityCheck(legacy, arena);
    assert.deepStrictEqual(r.record.map(g => g.points), [2, 2, 2]);
    const r2 = recordSanityCheck([1, 2, 3].map(i =>
      teamRec('o' + i, i * 1000, 1, 2, { teamCount: undefined })),
    { type: EventType.ONE_VS_ONE });
    assert.deepStrictEqual(r2.record.map(g => g.points), [2, 2, 4]);
  }
  console.log('  team record streaks passed');
}


async function testMismatchRejects() {
  // every writer must refuse a replay whose decoded modifier set or
  // ChessClock config does not match the event options, before any write
  const clockExpected = {
    modifiers: [11],
    modifier_options: { ChessClock: CLOCK_OPTIONS },
  };
  const cases = [
    {
      label: 'event expects no modifiers, replay has modifiers',
      eventOptions: { modifiers: [] },
      replayId: 'replay-plain',
    },
    {
      label: 'event expects modifiers, replay modifier set differs',
      eventOptions: { modifiers: [9] },
      replayId: 'replay-plain',
    },
    {
      label: 'wrong ClockIncrement',
      eventOptions: { modifiers: [11], modifier_options: { ChessClock: {
        ...CLOCK_OPTIONS, ClockIncrement: 5 } } },
      replayId: 'replay-clock',
    },
    {
      label: 'wrong StartingClock',
      eventOptions: { modifiers: [11], modifier_options: { ChessClock: {
        ...CLOCK_OPTIONS, StartingClock: 10 } } },
      replayId: 'replay-clock',
    },
    {
      label: 'wrong DontLimitMoveSpeed',
      eventOptions: { modifiers: [11], modifier_options: { ChessClock: {
        ...CLOCK_OPTIONS, DontLimitMoveSpeed: false } } },
      replayId: 'replay-clock',
    },
    {
      label: 'unmodified replay against clock event',
      eventOptions: clockExpected,
      replayId: 'replay-plain',
    },
    {
      label: 'in-progress clock replay with partial elapsed metadata',
      eventOptions: clockExpected,
      replayId: 'replay-incomplete-clock',
    },
  ];

  for (const { label, eventOptions, replayId } of cases) {
    // arena games writer
    {
      const db = new FakeFirestore();
      global.__testFirestore = db;
      getCalls = [];
      stubAxios();
      seedArena(db, eventOptions);
      db.doc('events/arena1/games/g1').set({
        replayId, started: 1000000, players: ['P0', 'P1'],
        timesChecked: 1000,
      });
      resetWriteJournal(db);
      await invokeHandler('events/{eventId}/games/{gameId}',
        db.doc('events/arena1/games/g1'));
      assert.strictEqual(db.invocations.length, 0,
        `arena/${label}: no writes after mismatch`);
      assert.strictEqual(
        getCalls.filter(u => u.endsWith('.gior')).length, 1,
        `arena/${label}: only the stubbed replay read happened`);
    }

    // bracket matches writer
    {
      const db = new FakeFirestore();
      global.__testFirestore = db;
      getCalls = [];
      replayListResponse = [
        { id: replayId, started: 5000, ranking: [0, 1, 2, 3] },
      ];
      stubAxios();
      seedMatchEvent(db, 'br1', 'matches', eventOptions);
      db.doc('events/br1/matches/m1').update({ timesChecked: 1000 });
      resetWriteJournal(db);
      await invokeHandler('events/{eventId}/matches/{matchId}',
        db.doc('events/br1/matches/m1'));
      assert.strictEqual(db.invocations.length, 0,
        `bracket/${label}: no writes after mismatch`);
      assert.strictEqual(
        getCalls.filter(u => u.endsWith('.gior')).length, 1,
        `bracket/${label}: only the stubbed replay read happened`);
    }

    // dynamic DYP writer
    {
      const db = new FakeFirestore();
      global.__testFirestore = db;
      getCalls = [];
      replayListResponse = [
        { id: replayId, started: 5000, ranking: [0, 1, 2, 3] },
      ];
      stubAxios();
      seedMatchEvent(db, 'dyp1', 'dyp-matches', eventOptions);
      db.doc('events/dyp1/dyp-matches/m1').update({ timesChecked: 1000 });
      resetWriteJournal(db);
      await invokeHandler('events/{eventId}/dyp-matches/{matchId}',
        db.doc('events/dyp1/dyp-matches/m1'));
      assert.strictEqual(db.invocations.length, 0,
        `dyp/${label}: no writes after mismatch`);
      assert.strictEqual(
        getCalls.filter(u => u.endsWith('.gior')).length, 1,
        `dyp/${label}: only the stubbed replay read happened`);
    }
  }
  console.log('  mismatch rejects passed');
}

// ------------------------------------------------------------------ run ---

function testRecordSanity() {
  const rec = (replayId, started, finished, rank = 1, points = 10) => ({
    name: 'player1',
    kills: 1,
    rank,
    points,
    lastTurn: 50,
    tilesAfterFirstRound: 1,
    streak: false,
    started,
    finished,
    replayId,
  });
  const ffa = { type: EventType.FFA };

  // ambiguous case: a legacy Chess Clock record with an unknown finish
  // followed by a game that started later cannot be proven to overlap —
  // the unknown finish never closes an interval
  {
    const record = [
      rec('legacy-clock', 1000, null),
      rec('later-game', 2000, 4000),
    ];
    const result = recordSanityCheck(record, ffa);
    assert.strictEqual(result.dq, false,
      'unknown finish must never end an interval');
  }

  // unambiguous case: a game that provably started while a known-finish
  // game was still running overlaps regardless of the unknown-finish
  // record's own unknown end
  {
    const record = [
      rec('known-long', 500, 4000),
      rec('legacy-clock', 1000, null),
    ];
    const result = recordSanityCheck(record, ffa);
    assert.strictEqual(result.dq, true,
      'a start inside a known interval is unambiguous overlap');
  }

  // an unknown-finish record sorted between two known-overlapping games
  // by finish time must not mask their overlap (start-ordered scan)
  {
    const record = [
      rec('known-a', 0, 3000),
      rec('unknown-middle', 3500, null),
      rec('known-b', 2000, 4000),
    ];
    const result = recordSanityCheck(record, ffa);
    assert.strictEqual(result.dq, true,
      'unknown-finish records must not mask a known overlap');
  }

  // undefined finish (malformed/older records) never ends an interval
  {
    const record = [
      rec('missing-finish', 1000, undefined),
      rec('later-game', 2000, 4000),
    ];
    const result = recordSanityCheck(record, ffa);
    assert.strictEqual(result.dq, false,
      'undefined finish must never trigger an overlap DQ');
  }

  // a non-finite finish value is guarded, not compared
  {
    const record = [
      rec('nan-finish', 1000, NaN),
      rec('later-game', 2000, 4000),
    ];
    const result = recordSanityCheck(record, ffa);
    assert.strictEqual(result.dq, false,
      'NaN finish must never trigger an overlap DQ');
  }

  // a known finish that actually overlaps the next game still DQs
  {
    const record = [
      rec('long-game', 1000, 3000),
      rec('overlap', 2000, 4000),
    ];
    const result = recordSanityCheck(record, ffa);
    assert.strictEqual(result.dq, true,
      'finite overlap must still disqualify');
  }
  console.log('  record sanity passed');
}

async function main() {
  console.log('modifier-options regression tests');
  testOptionContracts();
  testReplayMatchContracts();
  await testCreateEventModifiers();
  await testEditEventModifiers();
  testLobbyUrlModifiers();
  await testArenaWriter();
  await testBracketWriter();
  await testDypWriter();
  await testDypTeamOutcomes();
  await testDypTeamPartitionRejects();
  await testBracketTeamOutcomes();
  await testSinglesMatchPaths();
  await testDypTeamStreaks();
  await testBracketTeamStreaks();
  await testTeamMatchIdempotency();
  await testTeamMatchDistinctResults();
  await testTeamMatchRetry();
  await testPlayerUpdateNormalization();
  await testMismatchRejects();
  testRecordSanity();
  testTeamRecordStreaks();
  console.log('all modifier-options tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
