'use strict';

// Offline tournament hardening regression suite. Runs with plain node plus
// the TypeScript require hook in ./ts-register.js; Firestore and browser
// dependencies are faked, so no network or real database is ever touched.
//
//   npm run test:tournaments
//
// When project dependencies are not installed, point NODE_PATH at a
// node_modules directory containing typescript.

require('./ts-register');
const assert = require('assert');
const {FakeFirestore} = require('./fakes');

// browser globals a couple of modules touch at load or call time
global.localStorage = {
  getItem: () => null,
  setItem() {},
  removeItem() {},
};
global.window = {open() {}, addEventListener() {}};
global.location = {href: ''};
global.document = {getElementById: () => null};

const {
  canonicalTeamMembers,
  getConfirmedBigTeams,
  isValidTeamMembers,
  isValidTeamSize,
  teamIdentity,
} = require('../teams');
const {
  DoublesPairingStrategy,
  EventFormat,
  EventStatus,
  EventType,
  MatchStatus,
  MatchTeamStatus,
  PartnerStatus,
} = require('../types');
const {getRounds} = require(
    '../src/app/components/dynamic-dyp-event/rounds-creator');
const {getShuffledBracket} = require(
    '../src/app/components/bracket-event/bracket-creator');
const {handleDoubleElimEventUpdate} = require(
    '../functions/src/events/doubleElim');
const {handleDynamicDYPUpdate} = require(
    '../functions/src/events/dynamicDYP');
const {EventService} = require('../src/app/services/event.service');
const {GeneralsService} = require('../src/app/services/generals.service');
const {UtilService} = require('../src/app/services/util.service');
const {ChoosePartnersComponent} = require(
    '../src/app/components/choose-partners/choose-partners.component');
const {BracketEventComponent} = require(
    '../src/app/components/bracket-event/bracket-event.component');
const {BracketStatusComponent} = require(
    '../src/app/components/bracket-status/bracket-status.component');
const {CreateEventPage} = require(
    '../src/app/pages/home/create-event/create-event.page');

// ---------------------------------------------------------------- helpers

const WINNING_SETS = {winners: 1, losers: 1, semifinals: 1, finals: 1};

function player(name, extra = {}) {
  return {
    name,
    dq: false,
    rank: 0,
    points: 0,
    currentStreak: 0,
    record: [],
    ...extra,
  };
}

// a fully consistent set of member docs for a canonical roster
function teamDocs(members, captain, teamName = '') {
  const canonical = canonicalTeamMembers(members);
  return members.map(name => player(name, {
    teamCaptain: captain,
    teamMembers: canonical.slice(),
    teamName,
  }));
}

function deEvent(overrides = {}) {
  return {
    id: 'evt1',
    name: 'test event',
    type: EventType.ONE_VS_ONE,
    format: EventFormat.DOUBLE_ELIM,
    checkInTime: 0,
    checkedInPlayers: [],
    winningSets: {...WINNING_SETS},
    doublesPairingStrategy: DoublesPairingStrategy.BRING_YOUR_PARTNER,
    replays: [],
    ...overrides,
  };
}

function bigTeamEvent(overrides = {}) {
  return deEvent({
    type: EventType.BIG_TEAM,
    teamSize: 3,
    playersPerGame: 6,
    ...overrides,
  });
}

function seedEvent(store, event, players) {
  store.docs.set(`events/${event.id}`, clone(event));
  for (const p of players || []) {
    store.docs.set(`events/${event.id}/players/${p.name}`, clone(p));
  }
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

const {teamArenaAction} =
    require('../functions/src/https/callable/team-arena');
const {teamBracketAction} =
    require('../functions/src/https/callable/team-bracket');
const {TeamArenaService} =
    require('../src/app/services/team-arena.service');
const {TeamBracketService} =
    require('../src/app/services/team-bracket.service');
function callableStore(store, caller, handler) {
  return {httpsCallable: () => data =>
      ({toPromise: () => handler(data, {auth: {uid: caller}})})};
}
function makeService(store, caller) {
  global.__testFirestore = store;
  if (!store.dataAt('generals.io/admins')) {
    store.docs.set('generals.io/admins', {names: ['Lazerpent']});
  }
  // the fake satisfies the afs collection/doc interface used by legacy paths
  return new EventService(store, {name: caller},
      new TeamArenaService(callableStore(store, caller, teamArenaAction)),
      new TeamBracketService(callableStore(store, caller, teamBracketAction)));
}

// drive a whole team through the real invite -> accept lifecycle
async function formTeam(store, eventId, captain, members, teamName) {
  const cap = makeService(store, captain);
  for (const member of members) {
    if (member === captain) continue;
    await cap.sendBigTeamInvite(eventId, member);
    await makeService(store, member)
        .acceptBigTeamInvite(eventId, captain);
  }
  if (teamName) {
    await cap.setTeamName(eventId, members, teamName);
  }
}

function makeSnapshot(store, event) {
  return {data: () => event, ref: store.doc(`events/${event.id}`)};
}

async function expectReject(promise, match, label) {
  try {
    await promise;
  } catch (e) {
    if (match && !String(e.message).includes(match)) {
      assert.fail(`${label}: rejected with unexpected error: ${e.message}`);
    }
    return e;
  }
  assert.fail(`${label}: expected rejection`);
}

function members(...names) {
  return names.map(name => player(name));
}

// ------------------------------------------------ getConfirmedBigTeams ---

function testGetConfirmedBigTeams() {
  const roster = ['alice', 'bob', 'carol'];
  const docs = teamDocs(roster, 'alice', 'Team Win');
  const event = bigTeamEvent({checkedInPlayers: roster.slice()});

  // a fully consistent team confirms exactly once
  let teams = getConfirmedBigTeams(event, docs);
  assert.strictEqual(teams.length, 1, 'one confirmed team');
  assert.deepStrictEqual(teams[0].players, roster.slice().sort());
  assert.strictEqual(teams[0].name, 'Team Win', 'name from captain');
  assert.strictEqual(teams[0].placeholder, 'alice and bob and carol');

  // unnamed team falls back to the member list
  teams = getConfirmedBigTeams(event, teamDocs(roster, 'alice'));
  assert.strictEqual(teams[0].name, 'alice and bob and carol');

  // inputs are not mutated: docs keep their unsorted roster order
  const messy = [player('dave', {
    teamCaptain: 'dave',
    teamMembers: ['fred', 'dave', 'erin'],
  }), player('erin', {
    teamCaptain: 'dave',
    teamMembers: ['fred', 'dave', 'erin'],
  }), player('fred', {
    teamCaptain: 'dave',
    teamMembers: ['fred', 'dave', 'erin'],
  })];
  const before = messy.map(p => p.teamMembers.join(','));
  getConfirmedBigTeams(bigTeamEvent({
    checkedInPlayers: ['dave', 'erin', 'fred'],
  }), messy);
  assert.deepStrictEqual(messy.map(p => p.teamMembers.join(',')), before,
      'roster order never mutated');

  // wrong size, duplicates, empty names
  assert.strictEqual(getConfirmedBigTeams(event,
      teamDocs(['alice', 'bob'], 'alice')).length, 0, 'under-sized roster');
  const dup = player('alice', {
    teamCaptain: 'alice',
    teamMembers: ['alice', 'alice', 'bob'],
  });
  assert.strictEqual(getConfirmedBigTeams(event, [dup]).length, 0,
      'duplicate members rejected');
  const empty = player('alice', {
    teamCaptain: 'alice',
    teamMembers: ['alice', '', 'bob'],
  });
  assert.strictEqual(getConfirmedBigTeams(event, [empty]).length, 0,
      'empty member names rejected');
  const notAMember = player('zed', {
    teamCaptain: 'zed',
    teamMembers: canonicalTeamMembers(roster),
  });
  assert.strictEqual(getConfirmedBigTeams(event, docs.concat([notAMember]))
      .length, 1, 'doc claiming a foreign roster adds nothing');

  // member not registered / not checked in / dq
  assert.strictEqual(getConfirmedBigTeams(event, docs.slice(0, 2)).length, 0,
      'unregistered member kills the team');
  assert.strictEqual(getConfirmedBigTeams(
      bigTeamEvent({checkedInPlayers: ['alice', 'bob']}), docs).length, 0,
      'unchecked-in member kills the team');
  const dqed = teamDocs(roster, 'alice');
  dqed[1].dq = true;
  assert.strictEqual(getConfirmedBigTeams(event, dqed).length, 0,
      'dq member kills the team');

  // non-reciprocal rosters
  const inconsistent = teamDocs(roster, 'alice');
  inconsistent[1].teamMembers = ['alice', 'bob', 'zed'];
  assert.strictEqual(getConfirmedBigTeams(event, inconsistent).length, 0,
      'mismatched rosters are not confirmed');
  const wrongCaptain = teamDocs(roster, 'alice');
  wrongCaptain[1].teamCaptain = 'bob';
  assert.strictEqual(getConfirmedBigTeams(event, wrongCaptain).length, 0,
      'mismatched captains are not confirmed');
  const outsiderCaptain = teamDocs(roster, 'alice');
  outsiderCaptain.forEach(p => {
    p.teamCaptain = 'zed';
  });
  assert.strictEqual(getConfirmedBigTeams(event, outsiderCaptain).length, 0,
      'captain must be a member');

  // overlapping claims: only the fully consistent roster survives
  const overlap = docs.concat([
    player('zed', {
      teamCaptain: 'zed',
      teamMembers: canonicalTeamMembers(['carol', 'yara', 'zed']),
    }),
    player('yara', {
      teamCaptain: 'zed',
      teamMembers: canonicalTeamMembers(['carol', 'yara', 'zed']),
    }),
  ]);
  const overlapEvent = bigTeamEvent({
    checkedInPlayers: ['alice', 'bob', 'carol', 'yara', 'zed'],
  });
  teams = getConfirmedBigTeams(overlapEvent, overlap);
  assert.strictEqual(teams.length, 1,
      'overlap leaves only the reciprocally consistent team');
  assert.deepStrictEqual(teams[0].players, roster.slice().sort());

  // invalid team sizes can never confirm
  for (const teamSize of [0, 1, 9, 2.5, NaN, Infinity, -3]) {
    const bad = teamDocs(roster, 'alice');
    assert.strictEqual(
        getConfirmedBigTeams(bigTeamEvent({
          teamSize,
          checkedInPlayers: roster.slice(),
        }), bad).length,
        0, `teamSize ${teamSize} rejected`);
  }
  assert.ok(isValidTeamSize(2) && isValidTeamSize(8));
  assert.ok(!isValidTeamSize(1) && !isValidTeamSize(9) &&
      !isValidTeamSize(2.5) && !isValidTeamSize(NaN));
  assert.strictEqual(teamIdentity(['b', 'a']), '["a","b"]');

  // malformed teamMembers metadata never throws and never confirms
  for (const bad of ['alice', 7, {name: 'a'}, [1, 2, 3], [{x: 1}], null]) {
    const malformed = teamDocs(roster, 'alice');
    malformed[1].teamMembers = bad;
    assert.doesNotThrow(() => getConfirmedBigTeams(event, malformed));
    assert.strictEqual(getConfirmedBigTeams(event, malformed).length, 0,
        `malformed teamMembers ${JSON.stringify(bad)} rejects`);
  }
  assert.ok(!isValidTeamMembers('alice') && !isValidTeamMembers([1]) &&
      !isValidTeamMembers([]) && !isValidTeamMembers(['a', 'a']) &&
      isValidTeamMembers(['a', 'b']));

  // duplicate player docs for the same name make every team containing
  // that name unconfirmable rather than last-one-wins
  {
    const duped = teamDocs(roster, 'alice')
        .concat([player('bob', {
          teamCaptain: 'zed',
          teamMembers: ['bob', 'zed'],
        })]);
    assert.strictEqual(getConfirmedBigTeams(event, duped).length, 0,
        'duplicate player docs reject the team');
  }
  console.log('  getConfirmedBigTeams passed');
}

// ------------------------------------------------------- rounds-creator --

function testRoundsValidation() {
  const roster = members('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l')
      .map(p => p.name);

  // invalid inputs return [] rather than malformed schedules
  const badInputs = [
    [roster, undefined, undefined, 1, 4],       // teamSize < 2
    [roster, undefined, undefined, 9, 18],      // teamSize > 8
    [roster, undefined, undefined, 2.5, 5],     // fractional teamSize
    [roster, undefined, undefined, NaN, 4],     // NaN teamSize
    [roster, undefined, undefined, 3, 7],       // non-multiple playersPerGame
    [roster, undefined, undefined, 3, 5],       // playersPerGame < 2*size
    [roster, undefined, undefined, 3, 18],      // playersPerGame > 16
    [roster, undefined, undefined, 3, 6.5],     // fractional playersPerGame
    [roster, undefined, undefined, Infinity, 8],// infinite teamSize
    [roster, undefined, 0, 3, 6],               // maxRounds 0
    [roster, undefined, 101, 3, 6],             // maxRounds > 100
    [roster, undefined, 2.5, 3, 6],             // fractional maxRounds
    [roster, undefined, NaN, 3, 6],             // NaN maxRounds
    [roster.concat(['a']), undefined, 5, 3, 6], // duplicate names
    [roster.concat(['']), undefined, 5, 3, 6],  // empty name
  ];
  for (const [players, oddManOut, maxRounds, teamSize, ppg] of badInputs) {
    assert.deepStrictEqual(
        getRounds(players, oddManOut, maxRounds, teamSize, ppg), [],
        `invalid inputs ${JSON.stringify([teamSize, ppg, maxRounds])} give []`);
  }

  // classic 2v2 path is unchanged and still works
  const classic = getRounds(members('a', 'b', 'c', 'd').map(p => p.name));
  assert.ok(classic.length > 0, 'classic rounds still generate');
  for (const round of classic) {
    for (const match of round.matches) {
      assert.strictEqual(match.teams.length, 2);
      for (const team of match.teams) {
        assert.strictEqual(team.players.length, 2);
      }
    }
  }
  console.log('  rounds-creator validation passed');
}

function countMatchesPerPlayer(rounds, players) {
  const counts = new Map(players.map(name => [name, 0]));
  for (const round of rounds) {
    for (const match of round.matches) {
      for (const team of match.teams) {
        for (const name of team.players) {
          counts.set(name, (counts.get(name) || 0) + 1);
        }
      }
    }
  }
  return counts;
}

function testGenericRounds() {
  // exact team and game sizes for 3v3, 4v4, 8v8 and multi-team matches
  const fixtures = [
    {n: 12, teamSize: 3, ppg: 6},
    {n: 16, teamSize: 4, ppg: 8},
    {n: 16, teamSize: 8, ppg: 16},
    {n: 32, teamSize: 8, ppg: 16},
    {n: 18, teamSize: 3, ppg: 9},   // three teams of three per match
    {n: 9, teamSize: 3, ppg: 9},
  ];

  for (const {n, teamSize, ppg} of fixtures) {
    const players = Array.from({length: n}, (_, i) => `p${i + 1}`);
    const input = players.slice();
    const rounds = getRounds(input, undefined, 10, teamSize, ppg);
    assert.ok(rounds.length > 0, `${teamSize}v${teamSize} n=${n} rounds`);
    assert.deepStrictEqual(input, players, 'input array not mutated');

    const numbers = new Set();
    for (const round of rounds) {
      const seenThisRound = new Set();
      for (const match of round.matches) {
        assert.strictEqual(match.teams.length, ppg / teamSize,
            'exact teams per match');
        assert.ok(!numbers.has(match.number), 'unique match numbers');
        numbers.add(match.number);
        for (const team of match.teams) {
          assert.strictEqual(team.players.length, teamSize,
              'exact team size');
          assert.strictEqual(new Set(team.players).size, teamSize,
              'no duplicated member in a team');
          for (const name of team.players) {
            assert.ok(!seenThisRound.has(name),
                `${name} appears twice in a round`);
            seenThisRound.add(name);
          }
        }
      }
    }

    // match numbers are sequential from 1
    assert.strictEqual(numbers.size, Math.max(...numbers),
        'sequential match numbers');

    // every entrant is counted and spread stays within one match
    const counts = countMatchesPerPlayer(rounds, players);
    const values = Array.from(counts.values());
    assert.strictEqual(counts.size, n, 'all entrants counted');
    assert.ok(Math.max(...values) - Math.min(...values) <= 1,
        `spread <= 1 for n=${n} ${teamSize}v${teamSize}`);
  }

  // spread assertions over repeated randomized shuffles (unseeded); these
  // fixtures were known to produce skew (4 vs 7, 6 vs 8) before the
  // player-level selection fix
  const spreadFixtures = [
    {n: 15, teamSize: 4, ppg: 8},
    {n: 14, teamSize: 3, ppg: 9},
    {n: 23, teamSize: 8, ppg: 16},
    {n: 15, teamSize: 4, ppg: 8, odd: 'p1'},
  ];
  for (const {n, teamSize, ppg, odd} of spreadFixtures) {
    for (let run = 0; run < 30; run++) {
      const players = Array.from({length: n}, (_, i) => `p${i + 1}`);
      const rounds = getRounds(players, odd, 10, teamSize, ppg);
      const counts = countMatchesPerPlayer(rounds, players);
      assert.strictEqual(counts.size, n, 'all entrants counted');
      const values = Array.from(counts.values());
      assert.ok(
          Math.max(...values) - Math.min(...values) <= 1,
          `n=${n} ${teamSize}v${teamSize} run ${run} spread ` +
          `${Math.min(...values)}..${Math.max(...values)}`);
      assert.strictEqual(rounds.length, 10, 'full round count');
    }
  }
  console.log('  generic rounds passed');
}

// ---------------------------------------------------- bracket creator ----

function testBracketCreator() {
  const two = [{name: 'a', players: ['a']}, {name: 'b', players: ['b']}];
  const event = deEvent();

  // reject invalid inputs
  assert.strictEqual(getShuffledBracket(event, []), null, '0 teams rejected');
  assert.strictEqual(getShuffledBracket(event, two.slice(0, 1)), null,
      '1 team rejected');
  assert.strictEqual(getShuffledBracket(event,
      [{name: 'a', players: ['a']}, {name: 'b', players: ['a', 'b']}]), null,
      'overlapping rosters rejected');
  assert.strictEqual(getShuffledBracket(event,
      [{name: 'a', players: ['a']}, {name: 'b', players: ['']}]), null,
      'empty member name rejected');
  assert.strictEqual(getShuffledBracket(event,
      [{name: 'a', players: []}, {name: 'b', players: ['b']}]), null,
      'empty roster rejected');
  for (const badSets of [
    {winners: 0, losers: 1, semifinals: 1, finals: 1},
    {winners: 1, losers: 1, semifinals: 1, finals: 1.5},
    {winners: NaN, losers: 1, semifinals: 1, finals: 1},
  ]) {
    assert.strictEqual(
        getShuffledBracket(deEvent({winningSets: badSets}), two), null,
        'invalid winningSets rejected');
  }

  // Big Team events require proper roster sizes
  const btEvent = bigTeamEvent();
  assert.strictEqual(getShuffledBracket(btEvent, [
    {players: ['a', 'b', 'c']}, {players: ['d', 'e', 'f']},
  ]) === null, false, 'proper 3v3 rosters accepted');
  assert.strictEqual(getShuffledBracket(btEvent, [
    {players: ['a', 'b']}, {players: ['d', 'e', 'f']},
  ]), null, 'short Big Team roster rejected');
  assert.strictEqual(getShuffledBracket(bigTeamEvent({teamSize: 4}),
      [{players: ['a', 'b', 'c']}, {players: ['d', 'e', 'f']}]), null,
      'wrong-size roster rejected');
  assert.strictEqual(getShuffledBracket(bigTeamEvent({teamSize: 9}), [
    {players: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']},
    {players: ['j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r']},
  ]), null, 'invalid teamSize 9 rejected even with matching rosters');

  // a two team event gets NO losers rounds: semifinal + finals only
  const bracket = getShuffledBracket(event, two);
  assert.ok(bracket, 'two team bracket created');
  assert.strictEqual(bracket.losers.length, 0, 'no losers rounds');
  assert.strictEqual(bracket.winners.length, 2, 'semifinal and finals');
  assert.strictEqual(bracket.winners[0].matches.length, 1);
  assert.strictEqual(bracket.winners[0].name, 'Semifinals');
  assert.strictEqual(bracket.winners[1].name, 'Finals');
  assert.ok(bracket.winners[1].matches[0].final);

  // match numbers are unique and sequential
  for (const n of [2, 3, 4, 5, 8]) {
    const teams = Array.from({length: n}, (_, i) => {
      return {name: `t${i}`, players: [`p${i}`]};
    });
    const b = getShuffledBracket(deEvent(), teams);
    assert.ok(b, `bracket for ${n} teams`);
    const numbers = [];
    for (const rounds of [b.winners, b.losers]) {
      for (const round of rounds) {
        for (const match of round.matches) {
          numbers.push(match.number);
        }
      }
    }
    assert.strictEqual(new Set(numbers).size, numbers.length,
        `unique match numbers for ${n} teams`);
    assert.strictEqual(Math.max(...numbers), numbers.length,
        `sequential match numbers for ${n} teams`);
  }

  // input teams are not mutated
  const originals = two.map(t => ({name: t.name, players: t.players.slice()}));
  getShuffledBracket(deEvent(), two);
  assert.deepStrictEqual(two, originals, 'teams input not mutated');
  console.log('  bracket-creator passed');
}

// -------------------------------------------- double elim progression ----

function readyMatches(bracket) {
  const ready = [];
  for (const rounds of [bracket.winners, bracket.losers]) {
    for (const round of rounds) {
      for (const match of round.matches) {
        if (match.status === MatchStatus.READY) {
          ready.push({match, round});
        }
      }
    }
  }
  return ready;
}

// drive a tournament to completion through the real backend crawl
async function simulateTournament(store, event, pickWinner) {
  const snap = makeSnapshot(store, event);
  const losses = new Map();
  const eventPath = `events/${event.id}`;

  let guard = 0;
  let lastReady = -1;
  while (!store.dataAt(eventPath).endTime) {
    assert.ok(guard++ < 400, 'tournament did not finish');
    const ready = readyMatches(event.bracket);

    // the handler also advances byes and marks new matches ready, so a round
    // with nothing ready can still make progress; only declare a stall when
    // a full iteration produced no ready matches twice in a row
    if (ready.length === 0 && lastReady === 0) {
      assert.fail('tournament stalled with no ready matches');
    }
    lastReady = ready.length;

    for (const {match, round} of ready) {
      const winnerIdx = pickWinner(match);
      const loser = match.teams[1 - winnerIdx];
      const key = JSON.stringify(loser.players);
      losses.set(key, (losses.get(key) || 0) + 1);
      event.bracket.results[String(match.number)] = winnerIdx === 0 ? {
        team1Score: round.winningSets,
        team2Score: 0,
      } : {
        team1Score: 0,
        team2Score: round.winningSets,
      };
    }

    await handleDoubleElimEventUpdate(snap);
  }

  return losses;
}

function assertBracketTournamentResult(
    store, event, teams, champion, losses) {
  const data = store.dataAt(`events/${event.id}`);
  assert.ok(data.endTime, 'endTime recorded');
  assert.deepStrictEqual(data.winners, champion.players,
      'champion recorded on the event');

  const championKey = JSON.stringify(champion.players);
  for (const team of teams) {
    const key = JSON.stringify(team.players);
    const actual = losses.get(key) || 0;
    if (key === championKey) {
      assert.ok(actual <= 1,
          `champion lost ${actual} times, expected at most 1`);
    } else {
      assert.strictEqual(actual, 2,
          `${key} lost ${actual} times, expected exactly 2`);
    }
  }

  // champion rank 1 and runner-up rank 2 writes all landed and were awaited
  const finalsRound = event.bracket.winners[event.bracket.winners.length - 1];
  const lastFinal = finalsRound.matches[finalsRound.matches.length - 1];
  const runnerUp = lastFinal.teams.find(team => {
    return JSON.stringify(team.players) !== championKey;
  });
  assert.ok(runnerUp, 'runner-up identified');
  for (const name of champion.players) {
    assert.strictEqual(
        store.dataAt(`events/${event.id}/players/${name}`).rank, 1,
        `champion ${name} rank 1`);
  }
  for (const name of runnerUp.players) {
    assert.strictEqual(
        store.dataAt(`events/${event.id}/players/${name}`).rank, 2,
        `runner-up ${name} rank 2`);
  }

  // the event doc update (with endTime) completed after the rank writes
  const playerCompletions = store.completionsFor('/players/');
  const eventCompletions = store.completionsFor(`events/${event.id}`);
  assert.ok(playerCompletions.length > 0, 'rank writes completed');
  assert.ok(eventCompletions.length > 0, 'event write completed');
  assert.ok(
      store.completedWrites.indexOf(eventCompletions[eventCompletions.length - 1]) >
      store.completedWrites.indexOf(playerCompletions[0]),
      'rank writes awaited before the event finished');

  // rosters are preserved through every advancement clone
  const rosterKeys = new Set(teams.map(team => JSON.stringify(team.players)));
  for (const rounds of [event.bracket.winners, event.bracket.losers]) {
    for (const round of rounds) {
      for (const match of round.matches) {
        for (const team of match.teams) {
          if (team.players?.length) {
            assert.ok(rosterKeys.has(JSON.stringify(team.players)),
                `roster preserved for ${JSON.stringify(team.players)}`);
          }
        }
      }
    }
  }

  return {runnerUp};
}

async function runBracketSuite(
    teamCount, {seeded = false, type = EventType.ONE_VS_ONE, teamSize = 1} = {},
    pickWinner) {
  const playersPerTeam = teamSize;
  const teams = [];
  const allPlayers = [];
  for (let t = 0; t < teamCount; t++) {
    const roster = [];
    for (let p = 0; p < playersPerTeam; p++) {
      roster.push(`t${t}p${p}`);
    }
    allPlayers.push(...roster);
    teams.push({name: `team${t}`, players: roster});
  }

  const event = deEvent({
    type,
    teamSize: type === EventType.BIG_TEAM ? teamSize : undefined,
    playersPerGame:
        type === EventType.BIG_TEAM ? teamSize * 2 : undefined,
    checkedInPlayers: allPlayers,
  });
  if (seeded) {
    event.tsp = {};
    allPlayers.forEach((name, i) => {
      event.tsp[name] = allPlayers.length - i;
    });
  }

  const bracket = getShuffledBracket(event, teams);
  assert.ok(bracket, `bracket generated for ${teamCount} teams`);
  event.bracket = bracket;

  const store = new FakeFirestore();
  store.delays.set('/players/', 5);  // make unawaited rank writes detectable
  seedEvent(store, event, allPlayers.map(name => player(name)));

  const alternate = pickWinner ?? (match => match.number % 2);
  const losses = await simulateTournament(store, event, alternate);

  // the champion is the only team that could have zero or one loss
  const championPlayers = store.dataAt(`events/${event.id}`).winners;
  const champion = teams.find(team => {
    return JSON.stringify(team.players) === JSON.stringify(championPlayers);
  });
  assert.ok(champion, 'champion is one of the input rosters');

  return assertBracketTournamentResult(store, event, teams, champion, losses);
}

async function testBracketProgression() {
  // 2, 3, 4, 5, 8 team events, seeded and unseeded, including byes
  for (const n of [2, 3, 4, 5, 8]) {
    await runBracketSuite(n, {seeded: false});
    await runBracketSuite(n, {seeded: true});
  }

  // Big Team rosters: 3v3 and 8v8
  await runBracketSuite(4, {type: EventType.BIG_TEAM, teamSize: 3});
  await runBracketSuite(3, {type: EventType.BIG_TEAM, teamSize: 8});

  // 2-team event: no losers rounds, semifinal loser routed to finals
  {
    const teams = [
      {name: 'A', players: ['a']},
      {name: 'B', players: ['b']},
    ];
    const event = deEvent({checkedInPlayers: ['a', 'b']});
    event.bracket = getShuffledBracket(event, teams);
    assert.strictEqual(event.bracket.losers.length, 0);

    const store = new FakeFirestore();
    store.delays.set('/players/', 5);
    seedEvent(store, event, members('a', 'b'));
    const snap = makeSnapshot(store, event);

    // semifinal: A wins -> B drops straight to the finals second slot
    const semi = event.bracket.winners[0].matches[0];
    assert.strictEqual(semi.teams.length, 2, 'both teams in the semifinal');
    await handleDoubleElimEventUpdate(snap);  // marks semifinal READY
    event.bracket.results['1'] = {team1Score: 1, team2Score: 0};
    await handleDoubleElimEventUpdate(snap);

    const finals = event.bracket.winners[1].matches[0];
    const semiWinner = semi.teams[0].players;
    const semiLoser = semi.teams[1].players;
    assert.deepStrictEqual(finals.teams[0].players, semiWinner,
        'winner to slot 0');
    assert.deepStrictEqual(finals.teams[1].players, semiLoser,
        'semifinal loser routed to the finals second slot');

    // the loser-seeded finalist wins the first final -> exactly one reset
    event.bracket.results['2'] = {team1Score: 0, team2Score: 1};
    await handleDoubleElimEventUpdate(snap);
    const finalsRound = event.bracket.winners[1];
    assert.strictEqual(finalsRound.matches.length, 2, 'one reset match');
    assert.strictEqual(finalsRound.matches[0].final, false);
    assert.strictEqual(finalsRound.matches[1].status, MatchStatus.READY);

    // the challenger wins the reset too -> event over, challenger champion
    event.bracket.results['3'] = {team1Score: 0, team2Score: 1};
    await handleDoubleElimEventUpdate(snap);
    const data = store.dataAt('events/evt1');
    assert.ok(data.endTime, 'event finished');
    assert.deepStrictEqual(data.winners, semiLoser);
    assert.strictEqual(finalsRound.matches.length, 2, 'no second reset');
    assert.strictEqual(
        store.dataAt(`events/evt1/players/${semiLoser[0]}`).rank, 1);
    assert.strictEqual(
        store.dataAt(`events/evt1/players/${semiWinner[0]}`).rank, 2);
  }

  // kings seat wins the final: no reset even when both finalists chose the
  // same team name (reset must compare the slot, not the name)
  {
    const teams = [
      {name: 'Same Name', players: ['x1']},
      {name: 'Same Name', players: ['x2']},
    ];
    const event = deEvent({checkedInPlayers: ['x1', 'x2']});
    event.bracket = getShuffledBracket(event, teams);
    const store = new FakeFirestore();
    seedEvent(store, event, members('x1', 'x2'));
    const snap = makeSnapshot(store, event);

    await handleDoubleElimEventUpdate(snap);
    event.bracket.results['1'] = {team1Score: 1, team2Score: 0};
    await handleDoubleElimEventUpdate(snap);

    // the kings seat (slot 0) wins the final: event must end, NOT reset
    event.bracket.results['2'] = {team1Score: 1, team2Score: 0};
    await handleDoubleElimEventUpdate(snap);
    const finalsRound = event.bracket.winners[1];
    assert.strictEqual(finalsRound.matches.length, 1,
        'same team names must not trigger a wrongful reset');
    assert.ok(store.dataAt('events/evt1').endTime, 'event finished');
  }
  console.log('  bracket progression passed');
}

// ---------------------------------------------------------- dynamicDYP ---

async function testDynamicDYP() {
  function dypEvent(results) {
    return {
      id: 'dyp1',
      endTime: undefined,
      results,
      rounds: [{
        name: 'Round 1',
        complete: false,
        matches: [{
          teams: [
            {players: ['a', 'b'], score: 0},
            {players: ['c', 'd'], score: 0},
          ],
          ready: ['a', 'b', 'c', 'd'],
          number: 1,
          status: MatchStatus.READY,
        }],
      }],
    };
  }

  // exactly 3 completes the match
  {
    const store = new FakeFirestore();
    const event = dypEvent({'1': {team1Score: 2, team2Score: 1}});
    store.docs.set('events/dyp1', {});  // the event doc exists in Firestore
    await handleDynamicDYPUpdate(makeSnapshot(store, event));
    assert.strictEqual(event.rounds[0].matches[0].status, MatchStatus.COMPLETE,
        'totalScore 3 completes');
    assert.ok(event.rounds[0].complete, 'round completed');
  }

  // an overcounted score can no longer stall the match forever
  {
    const store = new FakeFirestore();
    const event = dypEvent({'1': {team1Score: 3, team2Score: 1}});
    store.docs.set('events/dyp1', {});
    await handleDynamicDYPUpdate(makeSnapshot(store, event));
    assert.strictEqual(event.rounds[0].matches[0].status, MatchStatus.COMPLETE,
        'totalScore >= 3 completes');
  }

  // under 3 stays ready
  {
    const store = new FakeFirestore();
    const event = dypEvent({'1': {team1Score: 1, team2Score: 1}});
    store.docs.set('events/dyp1', {});
    await handleDynamicDYPUpdate(makeSnapshot(store, event));
    assert.strictEqual(event.rounds[0].matches[0].status, MatchStatus.READY,
        'totalScore 2 stays ready');
  }
  console.log('  dynamicDYP passed');
}

// --------------------------------------------------- event service ------

function seedBigTeam(store, eventOverrides = {}, docList = []) {
  const roster = ['amy', 'bob', 'cat', 'dan'];
  const event = bigTeamEvent({checkedInPlayers: roster.slice(), ...eventOverrides});
  const docs = docList.length ? docList : roster.map(name => player(name));
  seedEvent(store, event, docs);
  return {event, docs};
}

async function testSetBigTeam() {
  // happy path: the invite + accept lifecycle mirrors canonical roster
  // fields atomically to every member doc
  {
    const store = new FakeFirestore();
    const {event} = seedBigTeam(store);
    await formTeam(store, event.id, 'amy', ['amy', 'cat']);
    for (const name of ['amy', 'cat']) {
      const doc = store.dataAt(`events/${event.id}/players/${name}`);
      assert.strictEqual(doc.teamCaptain, 'amy');
      assert.deepStrictEqual(doc.teamMembers, ['amy', 'cat']);
    }
    assert.ok(!store.dataAt(`events/${event.id}/players/bob`).teamMembers,
        'unrelated docs untouched');
    assert.strictEqual(
        store.dataAt(`events/${event.id}/players/cat`).bigTeamInvites
            .length, 0, 'accepted invite cleared');
  }

  // grow-only: {amy,bob} -> {amy,bob,cat} through another round trip
  {
    const store = new FakeFirestore();
    const {event} = seedBigTeam(store, {}, teamDocs(['amy', 'bob'], 'amy')
        .concat(members('cat', 'dan')));
    const amy = makeService(store, 'amy');
    await amy.sendBigTeamInvite(event.id, 'cat');
    await makeService(store, 'cat').acceptBigTeamInvite(event.id, 'amy');
    assert.deepStrictEqual(
        store.dataAt(`events/${event.id}/players/cat`).teamMembers,
        ['amy', 'bob', 'cat']);

    // nobody can re-invite an assigned player
    await expectReject(
        makeService(store, 'dan').sendBigTeamInvite(event.id, 'cat'),
        'already on a team', 'assigned target');
    // and an uninvited player cannot conjure membership
    await expectReject(
        makeService(store, 'dan').acceptBigTeamInvite(event.id, 'amy'),
        'has not invited you', 'no invite, no join');
  }

  // a non-captain member cannot send invites
  {
    const store = new FakeFirestore();
    const {event} = seedBigTeam(store, {}, teamDocs(['amy', 'bob'], 'amy')
        .concat(members('cat')));
    await expectReject(
        makeService(store, 'bob').sendBigTeamInvite(event.id, 'cat'),
        'Only the team captain', 'member cannot invite');
  }

  // over teamSize: the last accept fails at capacity
  {
    const store = new FakeFirestore();
    const {event} = seedBigTeam(store);  // teamSize 3
    const amy = makeService(store, 'amy');
    await amy.sendBigTeamInvite(event.id, 'bob');
    await amy.sendBigTeamInvite(event.id, 'cat');
    await amy.sendBigTeamInvite(event.id, 'dan');
    await makeService(store, 'bob').acceptBigTeamInvite(event.id, 'amy');
    await makeService(store, 'cat').acceptBigTeamInvite(event.id, 'amy');
    await expectReject(
        makeService(store, 'dan').acceptBigTeamInvite(event.id, 'amy'),
        'limited to 3', 'last slot overflow');
    assert.ok(!store.dataAt(`events/${event.id}/players/dan`).teamMembers);
  }

  // unregistered/DQ targets reject; so do self-invites
  {
    const store = new FakeFirestore();
    const {event} = seedBigTeam(store);
    const amy = makeService(store, 'amy');
    await expectReject(amy.sendBigTeamInvite(event.id, 'nobody'),
        'not registered', 'unregistered target');
    store.docs.set(`events/${event.id}/players/dqone`,
        {...player('dqone'), dq: true});
    store.docs.set(`events/${event.id}`, {
      ...store.dataAt(`events/${event.id}`),
      checkedInPlayers: [...(store.dataAt(`events/${event.id}`)
          .checkedInPlayers || []), 'dqone'],
    });
    await expectReject(amy.sendBigTeamInvite(event.id, 'dqone'),
        'disqualified', 'DQ target');
    await expectReject(amy.sendBigTeamInvite(event.id, 'amy'),
        'yourself', 'self invite');
  }

  // captain transfer invalidates a stale invitation
  {
    const store = new FakeFirestore();
    const {event} = seedBigTeam(store, {}, teamDocs(['amy', 'bob'], 'amy')
        .concat(members('cat')));
    const amy = makeService(store, 'amy');
    await amy.sendBigTeamInvite(event.id, 'cat');
    // captain leaves; bob becomes captain - amy's invite is stale
    await amy.leaveBigTeam(event.id);
    await expectReject(
        makeService(store, 'cat').acceptBigTeamInvite(event.id, 'amy'),
        '', 'stale captain invite cannot complete');
    // bob can still invite cat onto the real captainship
    await makeService(store, 'bob').sendBigTeamInvite(event.id, 'cat');
    await makeService(store, 'cat').acceptBigTeamInvite(event.id, 'bob');
    assert.strictEqual(
        store.dataAt(`events/${event.id}/players/cat`).teamCaptain,
        'bob', 'new captain recruits correctly');
  }

  // decline removes only that invite; cancel removes only the caller's
  {
    const store = new FakeFirestore();
    const {event} = seedBigTeam(store);
    const amy = makeService(store, 'amy');
    const dan = makeService(store, 'dan');
    await amy.sendBigTeamInvite(event.id, 'cat');
    await dan.sendBigTeamInvite(event.id, 'cat');
    const cat = makeService(store, 'cat');
    await cat.declineBigTeamInvite(event.id, 'amy');
    assert.deepStrictEqual(
        store.dataAt(`events/${event.id}/players/cat`).bigTeamInvites,
        ['dan'], 'only the declined invite removed');
    await dan.cancelBigTeamInvite(event.id, 'cat');
    assert.deepStrictEqual(
        store.dataAt(`events/${event.id}/players/cat`).bigTeamInvites,
        [], 'caller can cancel their own invite');
  }
  console.log('  setBigTeam passed');
}

async function testLeaveBigTeam() {
  // self removal: remaining roster keeps the team, captaincy passes to
  // the first canonical member, mirrored on every doc
  {
    const store = new FakeFirestore();
    const {event} = seedBigTeam(store, {}, teamDocs(['amy', 'bob', 'cat'],
        'amy'));
    await makeService(store, 'amy').leaveBigTeam(event.id);
    assert.deepStrictEqual(
        store.dataAt(`events/${event.id}/players/bob`).teamMembers,
        ['bob', 'cat']);
    assert.strictEqual(
        store.dataAt(`events/${event.id}/players/bob`).teamCaptain,
        'bob', 'first canonical member takes the captaincy');
    assert.deepStrictEqual(
        store.dataAt(`events/${event.id}/players/cat`).teamCaptain,
        'bob');
    const amy = store.dataAt(`events/${event.id}/players/amy`);
    assert.deepStrictEqual(amy.teamMembers, [], 'leaver cleared');
  }

  // a lone remainder clears entirely
  {
    const store = new FakeFirestore();
    const {event} = seedBigTeam(store, {}, teamDocs(['amy'], 'amy')
        .concat(members('bob')));
    await makeService(store, 'amy').leaveBigTeam(event.id);
    assert.deepStrictEqual(
        store.dataAt(`events/${event.id}/players/amy`).teamMembers, []);
  }

  // withdraw removes the doc AND shrinks the roster atomically
  {
    const store = new FakeFirestore();
    const {event} = seedBigTeam(store, {}, teamDocs(['amy', 'bob'], 'amy')
        .concat(members('cat')));
    await makeService(store, 'amy').removePlayer(event.id, 'amy');
    assert.strictEqual(
        store.dataAt(`events/${event.id}/players/amy`), undefined,
        'registration deleted');
    // a lone remainder is not a team: every roster field clears
    const bobDoc = store.dataAt(`events/${event.id}/players/bob`);
    assert.deepStrictEqual(bobDoc.teamMembers, [],
        'lone remainder roster cleared');
    assert.strictEqual(bobDoc.teamCaptain, '', 'lone captain cleared');
    assert.strictEqual(bobDoc.teamName, '', 'lone name cleared');
    // non-members cannot withdraw somebody else
    await expectReject(
        makeService(store, 'cat').removePlayer(event.id, 'bob'),
        'only remove yourself', 'targeted withdraw denied');
    // an organizer can purge another registration
    await makeService(store, 'Lazerpent').removePlayer(event.id, 'bob');
    assert.strictEqual(
        store.dataAt(`events/${event.id}/players/bob`), undefined,
        'organizer purge allowed');
  }

  // leaving revokes ONLY the leaver's sent invitations, atomically with
  // the roster removal — a second inviter's pending invite survives
  {
    const store = new FakeFirestore();
    const {event} = seedBigTeam(store,
        {checkedInPlayers: ['amy', 'bob', 'cat', 'dan', 'zed']},
        teamDocs(['amy', 'zed'], 'amy').concat(members('cat', 'dan')));
    const amy = makeService(store, 'amy');
    const dan = makeService(store, 'dan');
    await amy.sendBigTeamInvite(event.id, 'cat');
    await dan.sendBigTeamInvite(event.id, 'cat');
    await amy.leaveBigTeam(event.id);
    assert.deepStrictEqual(
        store.dataAt(`events/${event.id}/players/cat`).bigTeamInvites,
        ['dan'], 'leaver invite revoked, other inviter preserved');
    // roster metadata cleared on the leaver
    const amyDoc = store.dataAt(`events/${event.id}/players/amy`);
    assert.deepStrictEqual(amyDoc.teamMembers, []);
    assert.strictEqual(amyDoc.teamCaptain, '');
    // a stale post-leave invite can never be accepted under the old
    // captain identity
    await expectReject(
        makeService(store, 'cat').acceptBigTeamInvite(event.id, 'amy'),
        '', 'stale invite rejected after leave');
    // zed becomes a lone remainder: every roster field clears
    const zedDoc = store.dataAt(`events/${event.id}/players/zed`);
    assert.deepStrictEqual(zedDoc.teamMembers, [],
        'lone remainder roster cleared');
    assert.strictEqual(zedDoc.teamCaptain, '', 'lone captain cleared');
    assert.strictEqual(zedDoc.teamName, '', 'lone name cleared');
  }

  // a leave on a started event changes NOTHING — invites and rosters
  // stay byte-identical
  {
    const store = new FakeFirestore();
    const {event} = seedBigTeam(store, {endTime: Date.now()},
        teamDocs(['amy', 'bob'], 'amy').concat(members('cat')));
    store.docs.set(`events/${event.id}/players/cat`, {
      ...store.dataAt(`events/${event.id}/players/cat`),
      bigTeamInvites: ['amy']});
    const before = JSON.stringify(store.dataAt(`events/${event.id}/players`));
    await expectReject(makeService(store, 'amy').leaveBigTeam(event.id),
        'started', 'leave on started event');
    assert.strictEqual(
        JSON.stringify(store.dataAt(`events/${event.id}/players`)), before,
        'no doc changed including pending invites');
    assert.deepStrictEqual(
        store.dataAt(`events/${event.id}/players/cat`).bigTeamInvites,
        ['amy'], 'invite untouched on failed leave');
  }

  // a malformed roster leave rejects with zero changes to invites either
  {
    const store = new FakeFirestore();
    const docs = teamDocs(['amy', 'bob'], 'amy').concat(members('cat'));
    docs[0].teamMembers = 'amy,bob';  // a string, not an array
    const {event} = seedBigTeam(store, {}, docs);
    store.docs.set(`events/${event.id}/players/cat`, {
      ...store.dataAt(`events/${event.id}/players/cat`),
      bigTeamInvites: ['amy']});
    await expectReject(makeService(store, 'amy').leaveBigTeam(event.id),
        'inconsistent', 'malformed roster leave');
    assert.deepStrictEqual(
        store.dataAt(`events/${event.id}/players/cat`).bigTeamInvites,
        ['amy'], 'invite untouched on malformed leave');
  }

  // sendInvite outgoing cap: the 16th distinct target rejects
  {
    const store = new FakeFirestore();
    const {event} = seedBigTeam(store);
    // seed the maximum pending outgoing invites for amy
    for (let i = 0; i < 16; i++) {
      const t = `t${i}`;
      store.docs.set(`events/${event.id}/players/${t}`,
          {...player(t), bigTeamInvites: ['amy']});
    }
    const amy = makeService(store, 'amy');
    await expectReject(amy.sendBigTeamInvite(event.id, 'bob'),
        'Cancel a pending invitation', 'outgoing cap reached');
    assert.ok(!store.dataAt(`events/${event.id}/players/bob`)
        .bigTeamInvites, 'no invite written over cap');
  }

  // an invite on an event with an invalid teamSize rejects before any
  // invitation logic
  {
    const store = new FakeFirestore();
    const {event} = seedBigTeam(store, {teamSize: 99});
    await expectReject(
        makeService(store, 'amy').sendBigTeamInvite(event.id, 'bob'),
        'invalid team size', 'bogus teamSize invite');
  }
  console.log('  leaveBigTeam passed');
}

async function testSetTeamName() {
  // big team names write to the caller's actual roster atomically
  {
    const store = new FakeFirestore();
    const {event} = seedBigTeam(store, {},
        teamDocs(['amy', 'bob', 'cat'], 'amy'));
    const service = makeService(store, 'amy');  // captain only
    await service.setTeamName(event.id, ['stale'], 'Champions');
    for (const name of ['amy', 'bob', 'cat']) {
      assert.strictEqual(
          store.dataAt(`events/${event.id}/players/${name}`).teamName,
          'Champions', 'name written to every member');
    }
  }

  // non-member and non-captain callers reject
  {
    const store = new FakeFirestore();
    const {event} = seedBigTeam(store, {},
        teamDocs(['amy', 'bob', 'cat'], 'amy').concat(members('dan')));
    await expectReject(
        makeService(store, 'dan').setTeamName(event.id, ['dan'], 'X'),
        'captain', 'non-member rename');
    await expectReject(
        makeService(store, 'bob').setTeamName(event.id, [], 'X'),
        'captain', 'non-captain member rename');
  }

  // inconsistent roster rejects
  {
    const store = new FakeFirestore();
    const docs = teamDocs(['amy', 'bob', 'cat'], 'amy');
    docs[2].teamMembers = ['cat', 'zed'];
    const {event} = seedBigTeam(store, {}, docs);
    const service = makeService(store, 'amy');
    await expectReject(service.setTeamName(event.id, [], 'X'),
        'inconsistent', 'inconsistent roster rename');
  }

  // a roster claim that does not include the caller is a fake claim
  {
    const store = new FakeFirestore();
    const docs = teamDocs(['amy', 'bob', 'cat'], 'amy').concat([
      player('dan', {
        teamCaptain: 'amy',
        teamMembers: ['amy', 'bob', 'cat'],  // dan is not in the roster
      }),
    ]);
    const {event} = seedBigTeam(store, {}, docs);
    const service = makeService(store, 'dan');
    await expectReject(service.setTeamName(event.id, [], 'X'),
        'captain', 'caller not in claimed roster rejects');
    assert.strictEqual(
        store.dataAt(`events/${event.id}/players/amy`).teamName, '',
        'no partial rename');
  }

  // malformed roster metadata on the caller's doc rejects
  {
    const store = new FakeFirestore();
    const docs = teamDocs(['amy', 'bob', 'cat'], 'amy');
    docs[1].teamMembers = 'amy,bob,cat';  // a string, not an array
    const {event} = seedBigTeam(store, {}, docs);
    const service = makeService(store, 'bob');
    await expectReject(service.setTeamName(event.id, [], 'X'),
        'captain', 'malformed caller roster rejects');
    assert.strictEqual(
        store.dataAt(`events/${event.id}/players/amy`).teamName, '',
        'no partial rename');
  }

  // renaming after the event started rejects
  {
    const store = new FakeFirestore();
    const {event} = seedBigTeam(store, {endTime: Date.now()},
        teamDocs(['amy', 'bob', 'cat'], 'amy'));
    const service = makeService(store, 'amy');
    await expectReject(service.setTeamName(event.id, [], 'X'),
        'already started', 'rename after start rejects');
    assert.strictEqual(
        store.dataAt(`events/${event.id}/players/amy`).teamName, '',
        'no write on started event');
  }

  // a malformed peer doc rejects with no partial writes
  {
    const store = new FakeFirestore();
    const docs = teamDocs(['amy', 'bob', 'cat'], 'amy');
    docs[2].teamMembers = [1, 2, 3];  // malformed peer roster
    const {event} = seedBigTeam(store, {}, docs);
    const service = makeService(store, 'amy');
    await expectReject(service.setTeamName(event.id, [], 'X'),
        'inconsistent', 'malformed peer rejects');
    assert.strictEqual(
        store.dataAt(`events/${event.id}/players/amy`).teamName, '',
        'no partial rename');
  }

  // legacy 2v2 path still writes to the supplied players
  {
    const store = new FakeFirestore();
    const event = deEvent({type: EventType.TWO_VS_TWO});
    seedEvent(store, event, members('amy', 'bob'));
    const service = makeService(store, 'amy');
    await service.setTeamName(event.id, ['amy', 'bob'], 'Duo');
    assert.strictEqual(
        store.dataAt(`events/${event.id}/players/amy`).teamName, 'Duo');
    assert.strictEqual(
        store.dataAt(`events/${event.id}/players/bob`).teamName, 'Duo');
  }
  console.log('  setTeamName passed');
}

// ------------------------------------------------- choose partners -------

function makeChoosePartners({event, players, me, status}) {
  const toasts = [];
  const calls = [];
  const eventService = {
    sendBigTeamInvite: (...args) => {
      calls.push(['sendBigTeamInvite', args]);
      return eventService._sendBigTeamInviteResult ?? Promise.resolve();
    },
    acceptBigTeamInvite: (...args) => {
      calls.push(['acceptBigTeamInvite', args]);
      return Promise.resolve();
    },
    declineBigTeamInvite: (...args) => {
      calls.push(['declineBigTeamInvite', args]);
      return Promise.resolve();
    },
    cancelBigTeamInvite: (...args) => {
      calls.push(['cancelBigTeamInvite', args]);
      return Promise.resolve();
    },
    leaveBigTeam: (...args) => {
      calls.push(['leaveBigTeam', args]);
      return eventService._leaveBigTeamResult ?? Promise.resolve();
    },
    setTeamName: (...args) => {
      calls.push(['setTeamName', args]);
      return Promise.resolve();
    },
    selectPartner: (...args) => {
      calls.push(['selectPartner', args]);
      return Promise.resolve();
    },
    clearPartner: (...args) => {
      calls.push(['clearPartner', args]);
      return Promise.resolve();
    },
    confirmPartner: () => Promise.resolve(),
  };
  const util = {
    showToast: msg => toasts.push(msg),
    promptForText: async () => null,
    confirm: async () => true,
  };
  const comp = new ChoosePartnersComponent({name: me}, eventService, util);
  comp.event = event;
  comp.players = players;
  comp.status = status ?? EventStatus.UPCOMING;
  comp.disqualified = false;
  return {comp, toasts, calls, eventService};
}

async function testChoosePartners() {
  const roster = ['amy', 'bob', 'cat'];
  const event = bigTeamEvent({
    checkedInPlayers: roster.concat(['dan']),
  });

  // confirmedTeams only lists fully consistent rosters
  {
    const docs = teamDocs(roster, 'amy').concat([
      player('dan'),  // no team yet
    ]);
    const {comp} = makeChoosePartners({event, players: docs, me: 'dan'});
    assert.strictEqual(comp.confirmedTeams.length, 1);
    assert.deepStrictEqual(comp.confirmedTeams[0].players, roster.slice().sort());

    // a stale claimed roster (dan says he's with amy/bob/cat but amy/bob/cat
    // are on a complete consistent team) is not confirmed and not "ready"
    const staleDocs = teamDocs(roster, 'amy').concat([
      player('dan', {
        teamCaptain: 'amy',
        teamMembers: ['amy', 'bob', 'cat', 'dan'],
      }),
    ]);
    const other = makeChoosePartners({event, players: staleDocs, me: 'dan'});
    assert.strictEqual(other.comp.confirmedTeams.length, 1,
        'stale overlapping claim is not a confirmed team');
  }

  // incomplete roster shows the current-team block; confirmed roster hides it
  {
    const partialDocs = teamDocs(['amy', 'bob'], 'amy')
        .concat(members('cat', 'dan'));
    const {comp} = makeChoosePartners({event, players: partialDocs, me: 'amy'});
    assert.strictEqual(comp.showCurrentTeam, true,
        'incomplete roster shows current team');
    const fullDocs = teamDocs(roster, 'amy').concat(members('dan'));
    const full = makeChoosePartners({event, players: fullDocs, me: 'amy'});
    assert.strictEqual(full.comp.showCurrentTeam, false,
        'confirmed roster does not duplicate the block');
  }

  // captain can add a checked-in unassigned player; a partial add toasts the
  // addition and a completing add toasts the finalized team
  {
    const docs = teamDocs(['amy'], 'amy').concat(members('bob', 'cat', 'dan'));
    const {comp, calls, toasts} =
        makeChoosePartners({event, players: docs, me: 'amy'});
    await comp.chooseBigTeamPlayer(docs[1]);
    assert.strictEqual(calls.length, 1);
    // clicking sends an invite to that player, not a roster write
    assert.deepStrictEqual(calls[0][1], [event.id, 'bob']);
    assert.ok(toasts.some(t => t.includes('Invitation sent')),
        'invite toast shown');
  }
  {
    const docs = teamDocs(['amy', 'bob'], 'amy').concat(members('cat', 'dan'));
    const {comp, calls, toasts} =
        makeChoosePartners({event, players: docs, me: 'amy'});
    await comp.chooseBigTeamPlayer(docs[2]);
    assert.strictEqual(calls.length, 1);
    const [, [id, target]] = calls[0];
    assert.strictEqual(id, event.id);
    assert.strictEqual(target, 'cat');
    assert.ok(toasts.some(t => t.includes('Invitation sent')),
        'invite toast shown');
  }

  // non-captain members cannot add
  {
    const docs = teamDocs(['amy', 'bob'], 'amy').concat(members('cat'));
    const {comp, calls, toasts} =
        makeChoosePartners({event, players: docs, me: 'bob'});
    await comp.chooseBigTeamPlayer(docs[2]);
    assert.strictEqual(calls.length, 0, 'no mutation attempted');
    assert.ok(toasts.some(t => t.includes('captain')),
        'captain-only message');
  }

  // an unchecked-in target cannot be added
  {
    const uncheckedEvent = bigTeamEvent({checkedInPlayers: ['amy']});
    const docs = teamDocs(['amy'], 'amy').concat(members('bob', 'cat'));
    const {comp, calls, toasts} =
        makeChoosePartners({event: uncheckedEvent, players: docs, me: 'amy'});
    await comp.chooseBigTeamPlayer(docs[1]);
    assert.strictEqual(calls.length, 0, 'unchecked target blocked');
    assert.ok(toasts.some(t => t.includes('cannot be added')));
  }

  // a dq'd target cannot be added
  {
    const docs = teamDocs(['amy'], 'amy').concat([
      player('dan', {dq: true}),
    ]);
    const {comp, calls} =
        makeChoosePartners({event, players: docs, me: 'amy'});
    await comp.chooseBigTeamPlayer(docs[1]);
    assert.strictEqual(calls.length, 0, 'dq target blocked');
  }

  // a dq'd caller cannot add either
  {
    const docs = [
      player('amy', {dq: true, teamCaptain: 'amy', teamMembers: ['amy']}),
      ...members('dan'),
    ];
    const {comp, calls} =
        makeChoosePartners({event, players: docs, me: 'amy'});
    await comp.chooseBigTeamPlayer(docs[1]);
    assert.strictEqual(calls.length, 0, 'dq caller blocked');
  }

  // an already-assigned target cannot be added
  {
    const docs = teamDocs(['amy'], 'amy').concat([
      player('dan', {teamCaptain: 'zed', teamMembers: ['dan', 'zed']}),
    ]);
    const {comp, calls} =
        makeChoosePartners({event, players: docs, me: 'amy'});
    await comp.chooseBigTeamPlayer(docs[1]);
    assert.strictEqual(calls.length, 0, 'assigned target blocked');
  }

  // malformed caller roster metadata falls back to a one-person team
  {
    const docs = [
      player('amy', {teamCaptain: 'amy', teamMembers: 'amy,bob'}),
      ...members('dan'),
    ];
    const {comp} = makeChoosePartners({event, players: docs, me: 'amy'});
    assert.deepStrictEqual(comp.currentTeam.players, ['amy'],
        'malformed roster ignored, no crash');
    assert.strictEqual(comp.showCurrentTeam, false,
        'malformed roster does not render a team block');
  }

  // available partners exclude dq'd players
  {
    const docs = teamDocs(['amy'], 'amy')
        .concat(members('bob', 'cat'))
        .concat([player('dan', {dq: true})]);
    const {comp} = makeChoosePartners({event, players: docs, me: 'amy'});
    assert.deepStrictEqual(comp.availablePartners.map(p => p.name),
        ['bob', 'cat'], 'dq players are not addable options');
  }

  // a rejected mutation shows the error toast, never a success toast
  {
    const docs = teamDocs(['amy'], 'amy').concat(members('bob'));
    const {comp, calls, toasts, eventService} =
        makeChoosePartners({event, players: docs, me: 'amy'});
    eventService._sendBigTeamInviteResult =
        Promise.reject(new Error('already on another team'));
    await comp.chooseBigTeamPlayer(docs[1]);
    assert.strictEqual(calls.length, 1, 'mutation attempted');
    assert.ok(toasts.some(t => t.includes('already on another team')),
        'error toast surfaced');
    assert.ok(!toasts.some(t => t.includes('Invitation sent')),
        'no success toast on failure');
  }

  // busy guard: a second call while busy does nothing
  {
    const docs = teamDocs(['amy'], 'amy').concat(members('zed'));
    const {comp, calls} =
        makeChoosePartners({event, players: docs, me: 'amy'});
    comp.busy = true;
    await comp.chooseBigTeamPlayer(docs[1]);
    assert.strictEqual(calls.length, 0, 'busy call ignored');
  }

  // a started event blocks team changes
  {
    const docs = teamDocs(['amy'], 'amy').concat(members('zed'));
    const {comp, calls} = makeChoosePartners({
      event, players: docs, me: 'amy', status: EventStatus.ONGOING,
    });
    await comp.chooseBigTeamPlayer(docs[1]);
    assert.strictEqual(calls.length, 0, 'started event blocked');
  }

  // invite controls: accept routes to the accept action, decline to
  // decline, and cancel to cancel — each on the exact player named
  {
    const docs = members('amy').concat(members('zed'));
    const {comp, calls} = makeChoosePartners({
      event, players: docs, me: 'amy'});
    calls.length = 0;
    await comp.acceptBigTeamInvite('zed');
    assert.deepStrictEqual(calls[0], ['acceptBigTeamInvite', [event.id, 'zed']],
        'accept bound to acceptInvite');
    comp.declineBigTeamInvite('zed');
    // the busy guard serializes invites; let decline settle first
    await new Promise(r => setTimeout(r, 0));
    comp.cancelBigTeamInvite('bob');
    await new Promise(r => setTimeout(r, 0));
    const dispatched = calls.map(c => c[0]);
    assert.ok(dispatched.includes('declineBigTeamInvite'),
        'decline routes to decline');
    assert.ok(dispatched.includes('cancelBigTeamInvite'),
        'cancel routes to cancel');
  }

  // click-to-invite: sends an invite (not a roster write), and a target
  // already carrying the caller's invite is suppressed — derived from
  // the player snapshot, not local state
  {
    const docs = members('amy').concat([
      {...player('bob'), bigTeamInvites: ['amy']},
      player('cat'), player('dan')]);
    const {comp, calls} = makeChoosePartners({event, players: docs, me: 'amy'});
    calls.length = 0;
    await comp.chooseBigTeamPlayer(docs[1]);  // bob: already invited
    assert.strictEqual(calls.length, 0, 're-invite after send suppressed');
    await comp.chooseBigTeamPlayer(docs[2]);  // cat: fresh target
    assert.deepStrictEqual(calls[0], ['sendBigTeamInvite', [event.id, 'cat']],
        'click sends invite, not roster write');
    // snapshot-derived cancel list picks up the same field
    assert.deepStrictEqual(comp.sentBigTeamInvites, ['bob']);
  }

  // the invite getters only surface for Big Team and only live data
  {
    const docs = members('amy').concat([
      {...player('bob'), bigTeamInvites: ['dan', 'amy']},
      {...player('cat'), dq: true, bigTeamInvites: ['amy']},
      {...player('dan'), bigTeamInvites: ['cat']},
    ]);
    const {comp} = makeChoosePartners({event, players: docs, me: 'amy'});
    // snapshot-derived outbound: bob and the DQ cat both carry it
    assert.deepStrictEqual(comp.sentBigTeamInvites.sort(),
        ['bob', 'cat'], 'sent list is snapshot-derived');
    // incoming: my own doc has none
    assert.deepStrictEqual(comp.bigTeamInvites, []);
    // a DQ'd inviter never surfaces to the invitee
    const invited = makeChoosePartners({
      event, players: docs.concat([
        {...player('zee'), bigTeamInvites: ['cat', 'bob']}]),
      me: 'zee'});
    // the DQ inviter is filtered; the valid unassigned inviter survives
    assert.deepStrictEqual(invited.comp.bigTeamInvites, ['bob'],
        'DQ inviter filtered, valid inviter kept');
  }
  // the HTML template must actually bind the invite controls — a class
  // method alone does not prove the wiring
  {
    const fs = require('fs');
    const html = fs.readFileSync(
        require('path').join(__dirname,
            '../src/app/components/choose-partners/' +
            'choose-partners.component.html'), 'utf8');
    assert.ok(html.includes('(click)="acceptBigTeamInvite(captain)"'),
        'template binds Accept to acceptBigTeamInvite');
    assert.ok(html.includes('(click)="declineBigTeamInvite(captain)"'),
        'template binds Decline to declineBigTeamInvite');
    assert.ok(html.includes('(click)="cancelBigTeamInvite(target)"'),
        'template binds Cancel to cancelBigTeamInvite');
    // captain-only rename on a Big Team: the button's *ngIf restricts it
    assert.ok(
        /teamCaptain === generals\.name[^>]*\(click\)="setTeamName/
            .test(html) ||
        /\(click\)="setTeamName[^>]*teamCaptain === generals\.name/
            .test(html) ||
        /teamCaptain === generals\.name/.test(html),
        'rename guarded to the team captain');
    assert.ok(!html.includes('setBigTeam('),
        'no direct roster mutation remains in the template');
  }
  console.log('  invite bindings passed');

  // leaveTeam surfaces success and failure correctly
  {
    const docs = teamDocs(roster, 'amy').concat(members('dan'));
    const success = makeChoosePartners({event, players: docs, me: 'bob'});
    await success.comp.leaveTeam();
    assert.ok(success.toasts.some(t => t.includes('left your team')),
        'leave success toast');

    const fail = makeChoosePartners({event, players: docs, me: 'bob'});
    fail.eventService._leaveBigTeamResult =
        Promise.reject(new Error('inconsistent'));
    await fail.comp.leaveTeam();
    assert.ok(fail.toasts.some(t => t.includes('inconsistent')),
        'leave failure toast');
    assert.ok(!fail.toasts.some(t => t.includes('left your team')),
        'no success toast on leave failure');
  }
  console.log('  choose-partners passed');
}

// --------------------------------------------- bracket event/status -----

function makeBracketEvent({event, players, me = 'matt'}) {
  const toasts = [];
  const updates = [];
  const eventService = {
    updateEvent: (id, data) => {
      updates.push([id, data]);
      return Promise.resolve();
    },
    checkInPlayer: () => Promise.resolve(),
    addPlayer: () => Promise.resolve(),
    removePlayer: () => Promise.resolve(),
  };
  const util = {
    showToast: msg => toasts.push(msg),
    selectTab$: {pipe: () => ({subscribe: () => {}})},
    confirm: async () => true,
  };
  const comp = new BracketEventComponent({name: me}, eventService, util);
  comp.event = event;
  comp.players = players;
  return {comp, toasts, updates};
}

async function testBracketEvent() {
  const rosterA = ['a1', 'a2', 'a3'];
  const rosterB = ['b1', 'b2', 'b3'];
  const extra = ['solo'];  // checked in but never part of a team
  const checkedIn = rosterA.concat(rosterB, extra);
  const event = bigTeamEvent({checkedInPlayers: checkedIn});
  const docs = teamDocs(rosterA, 'a1')
      .concat(teamDocs(rosterB, 'b1'))
      .concat(members('solo'));

  // startEvent counts actual bracket participants, not checked-in extras
  {
    const {comp, updates} = makeBracketEvent({event, players: docs});
    comp.createBracket();
    assert.ok(comp.bracket, 'bracket created');
    comp.startEvent();
    assert.strictEqual(updates.length, 1, 'start update issued');
    assert.strictEqual(updates[0][1].playerCount, 6,
        'playerCount counts bracket participants only');
    assert.ok(updates[0][1].bracket, 'bracket persisted');
  }

  // a stale candidate bracket is rejected when the roster has changed
  {
    const {comp, updates, toasts} = makeBracketEvent({event, players: docs});
    comp.createBracket();
    assert.ok(comp.bracket);

    // roster changes after bracket generation: solo forms a valid third team
    const stale = docs.concat(teamDocs(['c1', 'c2', 'c3'], 'c1'));
    comp.players = stale;
    comp.event = bigTeamEvent({
      checkedInPlayers: checkedIn.concat(['c1', 'c2', 'c3']),
    });
    comp.startEvent();
    assert.strictEqual(updates.length, 0, 'stale bracket start blocked');
    assert.ok(toasts.some(t => t.includes('stale')), 'stale toast shown');
  }

  // missing bracket is rejected too
  {
    const {comp, updates, toasts} = makeBracketEvent({event, players: docs});
    comp.startEvent();
    assert.strictEqual(updates.length, 0);
    assert.ok(toasts.some(t => t.includes('Create a bracket')));
  }

  // same entrants on different teams: a partition change makes the bracket
  // stale even though the union of players is identical
  {
    const {comp, updates, toasts} = makeBracketEvent({event, players: docs});
    comp.createBracket();
    assert.ok(comp.bracket);

    // swap a member between the teams: [a1,a2,a3]+[b1,b2,b3] becomes
    // [a1,a2,b3]+[b1,b2,a3] -- same six players, different teams
    const swapped = teamDocs(['a1', 'a2', 'b3'], 'a1')
        .concat(teamDocs(['b1', 'b2', 'a3'], 'b1'))
        .concat(members('solo'));
    comp.players = swapped;
    comp.startEvent();
    assert.strictEqual(updates.length, 0,
        'same players on different teams must not start');
    assert.ok(toasts.some(t => t.includes('stale')), 'stale toast shown');
  }

  // no eligible teams left: a bracket with no current teams cannot start
  {
    const {comp, updates} = makeBracketEvent({event, players: docs});
    comp.createBracket();
    assert.ok(comp.bracket);
    comp.players = docs.map(d => ({
      ...d, teamMembers: [], teamCaptain: '',
    }));
    comp.startEvent();
    assert.strictEqual(updates.length, 0, 'no eligible teams cannot start');
  }

  // a non-admin cannot start even with a valid bracket
  {
    const {comp, updates, toasts} = makeBracketEvent({
      event, players: docs, me: 'amy',
    });
    comp.createBracket();
    assert.ok(comp.bracket);
    comp.startEvent();
    assert.strictEqual(updates.length, 0, 'non-admin start blocked');
    assert.ok(toasts.some(t => t.includes('organizers')),
        'organizer toast shown');
  }

  // an already-started event cannot be started again
  {
    const {comp, updates, toasts} = makeBracketEvent({event, players: docs});
    comp.createBracket();
    comp.startEvent();
    assert.strictEqual(updates.length, 1);
    comp.event = {...comp.event, bracket: comp.bracket};  // persisted now
    comp.startEvent();
    assert.strictEqual(updates.length, 1, 'no second start');
    assert.ok(toasts.some(t => t.includes('already started')));
  }

  // Big Team preview uses real team extraction, not 1v1 teams
  {
    const threeTeams = docs.concat(teamDocs(['c1', 'c2', 'c3'], 'c1'));
    const previewEvent = bigTeamEvent({
      checkedInPlayers: checkedIn.concat(['c1', 'c2', 'c3']),
      tsp: Object.fromEntries(
          checkedIn.concat(['c1', 'c2', 'c3']).map((n, i) => [n, 100 - i])),
    });
    const {comp} = makeBracketEvent({event: previewEvent, players: threeTeams});
    comp.ngOnChanges({players: {}});  // players change refreshes the preview
    assert.ok(comp.preview, 'preview generated on players change');
    const previewSizes = previewTeams(comp.preview);
    assert.ok(previewSizes.every(size => size === 3),
        'Big Team preview uses 3-player rosters, not 1v1 teams');
  }

  // two confirmed teams are enough for a Big Team preview
  {
    const previewEvent = bigTeamEvent({
      checkedInPlayers: checkedIn,
      tsp: Object.fromEntries(checkedIn.map((n, i) => [n, 100 - i])),
    });
    const {comp} = makeBracketEvent({event: previewEvent, players: docs});
    comp.ngOnChanges({players: {}});
    assert.ok(comp.preview, 'two team preview generated');
    const sizes = previewTeams(comp.preview);
    assert.strictEqual(sizes.length, 2, 'two first-round teams');
    assert.ok(sizes.every(size => size === 3));
  }

  // a preview is cleared when the eligible teams fall below two, and a
  // team with an unchecked-in member is never previewed
  {
    const previewEvent = bigTeamEvent({
      checkedInPlayers: checkedIn,
      tsp: Object.fromEntries(checkedIn.map((n, i) => [n, 100 - i])),
    });
    const {comp} = makeBracketEvent({event: previewEvent, players: docs});
    comp.ngOnChanges({players: {}});
    assert.ok(comp.preview, 'preview generated');

    // remove a checked-in member from one team: no confirmed teams remain
    comp.event = bigTeamEvent({
      checkedInPlayers: ['a1', 'a2', 'b1', 'b2', 'b3'],
      tsp: previewEvent.tsp,
    });
    comp.ngOnChanges({players: {}});
    assert.ok(!comp.preview, 'stale preview cleared below two teams');
  }

  function previewTeams(preview) {
    const sizes = [];
    for (const match of preview.winners[0].matches) {
      for (const team of match.teams) {
        if (team.players?.length) sizes.push(team.players.length);
      }
    }
    return sizes;
  }
  console.log('  bracket-event passed');
}

function testBracketStatus() {
  const roster = ['amy', 'bob', 'cat'];
  const event = bigTeamEvent({checkedInPlayers: roster});

  // only membership in a fully consistent confirmed team counts
  {
    const docs = teamDocs(roster, 'amy');
    const comp = new BracketStatusComponent(
        {name: 'amy', nameChanged$: {subscribe: () => {}}}, {});
    comp.event = event;
    comp.players = docs;
    comp.determineInEvent();
    assert.strictEqual(comp.teamConfirmed, true, 'consistent roster confirmed');
  }

  // a stale claimed roster does not count as ready
  {
    const docs = teamDocs(roster, 'amy');
    docs[2].teamMembers = ['cat', 'zed'];  // cat claims a different roster
    const comp = new BracketStatusComponent(
        {name: 'cat', nameChanged$: {subscribe: () => {}}}, {});
    comp.event = event;
    comp.players = docs;
    comp.determineInEvent();
    assert.strictEqual(comp.teamConfirmed, false,
        'inconsistent roster not confirmed');
  }

  // right-size but unchecked-in roster does not count
  {
    const docs = teamDocs(roster, 'amy');
    const comp = new BracketStatusComponent(
        {name: 'amy', nameChanged$: {subscribe: () => {}}}, {});
    comp.event = bigTeamEvent({checkedInPlayers: ['amy', 'bob']});
    comp.players = docs;
    comp.determineInEvent();
    assert.strictEqual(comp.teamConfirmed, false,
        'unchecked-in member means not confirmed');
  }
  console.log('  bracket-status passed');
}

// -------------------------------------------------------- create event ---

function makeCreatePage() {
  const created = [];
  const dismissed = [];
  const eventService = {
    createEvent: async data => {
      created.push(data);
      return 'new-id';
    },
    updateEvent: async () => {},
    getEvent: () => ({pipe: () => ({subscribe: () => {}})}),
  };
  const modal = {dismiss: () => dismissed.push(true)};
  const nav = {get: () => null};
  const page = new CreateEventPage(eventService, modal, nav);
  // minimal valid baseline for a Big Team double elim event
  page.date = '2030-01-01';
  page.time = '12:00:00';
  page.visibility = 'Public';
  page.type = EventType.BIG_TEAM;
  page.format = EventFormat.DOUBLE_ELIM;
  page.checkIn = '15 minutes before start';
  page.pairingStrategy = 'Bring Your Partner';
  return {page, created, dismissed};
}

async function testCreateEvent() {
  // teamConfigValid rejects non-finite, fractional, and out-of-range sizes
  {
    const {page} = makeCreatePage();
    for (const bad of [0, 1, 9, 2.5, NaN, Infinity, -1, 'abc']) {
      page.teamSize = bad;
      assert.strictEqual(page.teamConfigValid, false,
          `teamSize ${bad} rejected`);
    }
    for (const good of [2, 3, 4, 8, '3']) {
      page.teamSize = good;
      assert.strictEqual(page.teamConfigValid, true,
          `teamSize ${good} accepted`);
    }
  }

  // double elim resolves to exactly two teams per game
  {
    const {page} = makeCreatePage();
    page.teamSize = 4;
    assert.strictEqual(page.resolvedPlayersPerGame, 8,
        'double elim 4v4 resolves 8 players per game');
    page.teamSize = 8;
    assert.strictEqual(page.resolvedPlayersPerGame, 16);
  }

  // DYP playersPerGame must be an integer multiple of teamSize, >= 2 teams,
  // and <= 16
  {
    const {page} = makeCreatePage();
    page.format = EventFormat.DYNAMIC_DYP;
    page.teamSize = 3;
    for (const bad of [5, 7, 6.5, 18, NaN, 'abc', 0]) {
      page.playersPerGame = bad;
      assert.strictEqual(page.teamConfigValid, false,
          `playersPerGame ${bad} rejected for 3v3`);
    }
    for (const good of [6, 9, 12, 15]) {
      page.playersPerGame = good;
      assert.strictEqual(page.teamConfigValid, true,
          `playersPerGame ${good} accepted for 3v3`);
    }
  }

  // create() refuses an invalid config even when called directly
  {
    const {page, created, dismissed} = makeCreatePage();
    page.teamSize = 2.5;
    await page.create();
    assert.strictEqual(created.length, 0, 'invalid config not persisted');
    assert.strictEqual(dismissed.length, 0, 'modal not dismissed');
  }

  // numeric values are persisted even if the inputs produced strings
  {
    const {page, created} = makeCreatePage();
    page.teamSize = '4';
    await page.create();
    assert.strictEqual(created.length, 1);
    const data = created[0];
    assert.strictEqual(typeof data.teamSize, 'number',
        'teamSize persisted as number');
    assert.strictEqual(data.teamSize, 4);
    assert.strictEqual(typeof data.playersPerGame, 'number');
    assert.strictEqual(data.playersPerGame, 8,
        'double elim playersPerGame is 2 * teamSize');
  }
  console.log('  create-event passed');
}

// ---------------------------------------------------- lobby urls ---------

function testLobbyUrls() {
  const opened = [];
  global.window = {open: url => opened.push(url), addEventListener() {}};

  const util = new UtilService();
  const generals = new GeneralsService(
      {httpsCallable: () => ({toPromise: async () => []})},
      {authState: {subscribe: () => {}}},
      {navigate: () => {}},
      util);

  const event = {
    id: 'evt1',
    type: EventType.ONE_VS_ONE,
    server: undefined,
    options: {},
  };

  // match lobbies are namespaced by the event id
  generals.joinLobby('match_3', event, true);
  generals.joinLobby('match_3', {...event, id: 'evt2'}, true);
  assert.ok(opened[0].includes('/games/match_evt1_3?'),
      `first event lobby: ${opened[0]}`);
  assert.ok(opened[1].includes('/games/match_evt2_3?'),
      'simultaneous events get distinct lobbies');

  // finals links are consistent for players and spectators
  opened.length = 0;
  generals.joinLobby('match_finals', event, true);
  generals.joinLobby('match_finals', event, true, {spectate: true});
  assert.ok(opened[0].includes('/games/match_evt1_finals?'));
  assert.ok(opened[1].includes('/games/match_evt1_finals?'));
  assert.ok(opened[1].includes('spectate=true'), 'spectate preserved');

  // arena event_* lobbies are unchanged
  opened.length = 0;
  generals.joinLobby('event_evt1_12345', event, false);
  assert.strictEqual(opened.length, 0, 'same-tab navigation uses location');
  generals.joinLobby('event_evt1_12345', event, true);
  assert.ok(opened[0].includes('/games/event_evt1_12345?'),
      'arena lobby unchanged');

  // a match lobby without an event id throws rather than colliding
  assert.throws(() => {
    generals.joinLobby('match_1', {...event, id: ''}, true);
  }, /event id/, 'empty event id rejected');

  // child events use their own id, not the parent's
  opened.length = 0;
  generals.joinLobby('match_2',
      {...event, id: 'child1', parentId: 'parent1'}, true);
  assert.ok(opened[0].includes('/games/match_child1_2?'),
      'child event uses own id');
  assert.ok(opened[0].includes('eventId=child1'), 'eventId stays the child');

  // Big Team events set the lobby player count
  opened.length = 0;
  generals.joinLobby('match_5', {
    id: 'big1',
    type: EventType.BIG_TEAM,
    format: EventFormat.DOUBLE_ELIM,
    teamSize: 8,
    playersPerGame: 16,
    options: {},
  }, true, {team: 2});
  assert.ok(opened[0].includes('players=16'), '8v8 lobby holds 16 players');
  assert.ok(opened[0].includes('team=2'), 'team index preserved');

  opened.length = 0;
  generals.joinLobby('match_5', {
    id: 'big2',
    type: EventType.BIG_TEAM,
    format: EventFormat.DOUBLE_ELIM,
    teamSize: 3,
    options: {},
  }, true);
  assert.ok(opened[0].includes('players=6'),
      'double elim falls back to 2 * teamSize');

  // a missing playersPerGame falls back to 2 * teamSize for Dynamic DYP too
  opened.length = 0;
  generals.joinLobby('match_5', {
    id: 'big3',
    type: EventType.BIG_TEAM,
    format: EventFormat.DYNAMIC_DYP,
    teamSize: 4,
    options: {},
  }, true);
  assert.ok(opened[0].includes('players=8'),
      'DYP falls back to 2 * teamSize when the field is absent');

  // a double elim lobby must resolve to exactly two teams: a provided
  // playersPerGame that differs from 2 * teamSize is a mismatch
  opened.length = 0;
  assert.throws(() => {
    generals.joinLobby('match_1', {
      id: 'mismatch',
      type: EventType.BIG_TEAM,
      format: EventFormat.DOUBLE_ELIM,
      teamSize: 3,
      playersPerGame: 9,
      options: {},
    }, true);
  }, /invalid/i, 'provided 9 for a 3v3 double elim rejects');
  assert.strictEqual(opened.length, 0, 'no lobby opened on mismatch');

  // the same provided size is fine for Dynamic DYP, which supports
  // multi-team matches
  generals.joinLobby('match_1', {
    id: 'dyp9',
    type: EventType.BIG_TEAM,
    format: EventFormat.DYNAMIC_DYP,
    teamSize: 3,
    playersPerGame: 9,
    options: {},
  }, true);
  assert.ok(opened[0].includes('players=9'),
      '3x3 multi-team DYP lobby accepted');

  // malformed persisted config is rejected, never trusted or replaced
  for (const bad of [
    {teamSize: 3, playersPerGame: 5},     // not a multiple of teamSize
    {teamSize: 3, playersPerGame: 17},    // above the lobby cap
    {teamSize: 3, playersPerGame: 0},     // falsy invalid, must not fall back
    {teamSize: 3, playersPerGame: 6.5},   // fractional
    {teamSize: 9, playersPerGame: 18},    // invalid team size
    {teamSize: undefined, playersPerGame: 6},
  ]) {
    opened.length = 0;
    assert.throws(() => {
      generals.joinLobby('match_1', {
        id: 'bad',
        type: EventType.BIG_TEAM,
        format: EventFormat.DOUBLE_ELIM,
        ...bad,
        options: {},
      }, true);
    }, /invalid/i, `malformed config ${JSON.stringify(bad)} rejected`);
    assert.strictEqual(opened.length, 0, 'no lobby opened for bad config');
  }

  // map/options metadata can never inject or override a parameter
  opened.length = 0;
  generals.joinLobby('match_1', {
    id: 'inj',
    type: EventType.ONE_VS_ONE,
    options: {map: 'seed&team=9'},
  }, true, {team: 2});
  assert.ok(opened[0].includes('map=seed%26team%3D9'),
      'map value stays one encoded parameter');
  assert.ok(!opened[0].includes('&team=9'),
      'injected team parameter impossible');
  assert.ok(opened[0].includes('team=2'), 'real team option intact');

  // getParamString encodes keys and values
  const params = util.getParamString({map: 'a&b=c', speed: '2x', team: 1});
  assert.strictEqual(params, '?map=a%26b%3Dc&speed=2x&team=1');
  assert.strictEqual(util.getParamString({x: undefined}), '?x=');
  assert.strictEqual(util.getParamString(null), '');

  // unicode and reserved characters in the lobby segment are encoded
  opened.length = 0;
  generals.joinLobby('match_1',
      {...event, id: 'ev t/ü'}, true);
  assert.ok(opened[0].includes('/games/match_ev%20t%2F%C3%BC_1?'),
      `lobby segment encoded: ${opened[0]}`);
  console.log('  lobby urls passed');
}

// ------------------------------------------------------------------ run --

async function run() {
  testGetConfirmedBigTeams();
  testRoundsValidation();
  testGenericRounds();
  testBracketCreator();
  await testBracketProgression();
  await testDynamicDYP();
  await testSetBigTeam();
  await testLeaveBigTeam();
  await testSetTeamName();
  await testChoosePartners();
  await testBracketEvent();
  testBracketStatus();
  await testCreateEvent();
  testLobbyUrls();
  console.log('tournament regression tests passed');
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
