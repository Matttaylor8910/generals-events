'use strict';

// Shared wire validation and scoring for 2v2 and arbitrary-size team arenas.
// Nominal gameSize stays a multiple of teamSize even when an explicitly
// short-handed roster contains fewer actual players.
function isTeamArena(event) {
  return !!event && event.format === 'Arena'
      && (event.type === 'Big Team' || event.type === '2v2');
}

function validateTeamArenaConfig(event) {
  if (!isTeamArena(event)) throw new Error('This is not a team arena');
  const { teamSize, playersPerGame } = event;
  if (!Number.isInteger(teamSize) || teamSize < 2 || teamSize > 8
      || !Number.isInteger(playersPerGame) || playersPerGame > 16
      || playersPerGame < 2 * teamSize || playersPerGame % teamSize !== 0) {
    throw new Error('Game size must be a multiple of team size, with 2-16 players');
  }
  if (event.type === '2v2' && (teamSize !== 2 || playersPerGame !== 4)) {
    throw new Error('2v2 arenas require teams of 2 and games of 4');
  }
  if (!['Bring Your Partner', 'Random Partners']
    .includes(event.doublesPairingStrategy)) {
    throw new Error('Choose bring-your-own or random partners');
  }
}

function normalizeLobby(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || Object.keys(raw).some(key =>
        !['version', 'teamSize', 'gameSize', 'teams'].includes(key))
      || raw.version !== 1) {
    throw new Error('Invalid event team roster');
  }
  validateTeamArenaConfig({
    format: 'Arena', type: 'Big Team', teamSize: raw.teamSize,
    playersPerGame: raw.gameSize, doublesPairingStrategy: 'Bring Your Partner',
  });
  if (!Array.isArray(raw.teams)
      || raw.teams.length !== raw.gameSize / raw.teamSize) {
    throw new Error('Event team count does not match game size');
  }
  const seen = new Set();
  const teams = raw.teams.map(members => {
    if (!Array.isArray(members) || !members.length
        || members.length > raw.teamSize) {
      throw new Error('Invalid event team size');
    }
    return members.map(name => {
      if (typeof name !== 'string' || !name.trim() || name.length > 100
          || seen.has(name)) {
        throw new Error('Event rosters require unique player names');
      }
      seen.add(name);
      return name;
    });
  });
  return { version: 1, teamSize: raw.teamSize, gameSize: raw.gameSize, teams };
}

// Firestore storage codec: the wire contract's nested string[][] rosters
// cannot live in a document (Firestore forbids nested arrays), so each
// roster is wrapped in an object at the storage boundary. Wire payloads —
// lobby URLs, API responses, replay validation — always use the flattened
// IEventTeamLobby shape; only document reads/writes see this form.
function storeLobby(raw) {
  const normalized = normalizeLobby(raw);
  return { ...normalized,
    teams: normalized.teams.map(players => ({ players })) };
}

function loadLobby(stored) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)
      || !Array.isArray(stored.teams)
      || stored.teams.some(team => !team || typeof team !== 'object'
          || Array.isArray(team)
          || Object.keys(team).some(key => key !== 'players')
          || !Array.isArray(team.players))) {
    throw new Error('Invalid stored event team lobby');
  }
  return normalizeLobby({ ...stored,
    teams: stored.teams.map(team => team.players) });
}

function assertReplayTeams(replay, expectedTeams) {
  if (!Array.isArray(expectedTeams) || expectedTeams.length < 2
      || !Array.isArray(replay.usernames) || !Array.isArray(replay.teams)
      || replay.teams.length !== replay.usernames.length
      || new Set(replay.usernames).size !== replay.usernames.length) {
    throw new Error('Replay has no valid team roster');
  }
  const expectedNames = expectedTeams.flatMap(team => team.players);
  if (new Set(expectedNames).size !== expectedNames.length
      || expectedNames.length !== replay.usernames.length
      || !expectedNames.every(name => replay.usernames.includes(name))
      || new Set(expectedTeams.map(team => team.id)).size !== expectedTeams.length) {
    throw new Error('Replay players do not match dispatched arena roster');
  }
  const usedTeams = new Set();
  for (const team of expectedTeams) {
    if (!team.players.length) throw new Error('Empty dispatched team');
    const indexes = team.players.map(name => replay.usernames.indexOf(name));
    const actualTeam = replay.teams[indexes[0]];
    if (!Number.isInteger(actualTeam) || actualTeam < 0
        || usedTeams.has(actualTeam)
        || indexes.some(index => replay.teams[index] !== actualTeam)) {
      throw new Error('Replay teams do not match dispatched arena roster');
    }
    usedTeams.add(actualTeam);
  }
}

// Outcomes come from the replay engine's per-turn team elimination state,
// not individual leaderboard order (a winning teammate may have died first).
// Simultaneous eliminated teams tie. Every participating teammate gets the
// same placement/kill/bonus points; a fixed team's total adds them only once.
function scoreTeamArena(expectedTeams, playerScores, outcomes, durationMinutes) {
  if (!Array.isArray(outcomes) || outcomes.length !== expectedTeams.length
      || outcomes.filter(team => team.winner === true).length !== 1
      || !Number.isInteger(durationMinutes) || durationMinutes < 0) {
    throw new Error('Invalid terminal team outcomes');
  }
  const byOutcome = new Map(outcomes.map(team => [team.id, team]));
  if (byOutcome.size !== expectedTeams.length
      || expectedTeams.some(team => !byOutcome.has(team.id))
      || outcomes.some(team => !team.winner
          && (!Number.isInteger(team.eliminatedTurn) || team.eliminatedTurn < 0))) {
    throw new Error('Incomplete team elimination history');
  }
  const scoreByName = new Map(playerScores.map(score => [score.name, score]));
  if (scoreByName.size !== playerScores.length
      || playerScores.length !== expectedTeams.reduce((n, team) => n + team.players.length, 0)) {
    throw new Error('Invalid arena player scores');
  }
  const teams = expectedTeams.map(team => {
    const outcome = byOutcome.get(team.id);
    const rank = outcome.winner
        ? 1
        : 1 + outcomes.filter(other =>
          other.winner || other.eliminatedTurn > outcome.eliminatedTurn).length;
    // Use recorded enemy captures, not simulate()'s legacy inferred kill for
    // the last surrender. Friendly captures never earn team points.
    const victims = new Set();
    for (const name of team.players) {
      const score = scoreByName.get(name);
      if (!score) throw new Error('Missing arena player score');
      for (const victim of score.killed || []) {
        if (!team.players.includes(victim)) victims.add(victim);
      }
    }
    const outlived = outcome.winner
        ? expectedTeams.length - 1
        : outcomes.filter(other => !other.winner
            && other.eliminatedTurn < outcome.eliminatedTurn).length;
    const twoTeams = expectedTeams.length === 2;
    let points = twoTeams
        ? (outcome.winner ? 2 : 0)
        : outlived + victims.size;
    if (!twoTeams && rank === 1) points += 5 + durationMinutes;
    if (!twoTeams && rank === 2) points += Math.floor(durationMinutes / 2);
    return {
      id: team.id, name: team.name, players: team.players.slice(),
      rank, points, kills: victims.size,
    };
  });
  teams.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  const scores = playerScores.map(score => {
    const team = teams.find(candidate => candidate.players.includes(score.name));
    return { ...score, rank: team.rank, points: team.points,
      teamId: team.id, teamKills: team.kills, streak: false,
      teamCount: expectedTeams.length };
  });
  return { teams, scores };
}

function rankArenaTeams(teams) {
  return teams.slice().sort((a, b) =>
    (b.points || 0) - (a.points || 0)
        || ((b.wins || 0) / (b.games || 1)) - ((a.wins || 0) / (a.games || 1))
        || (b.games || 0) - (a.games || 0) || a.id.localeCompare(b.id));
}

module.exports = {
  isTeamArena, validateTeamArenaConfig, normalizeLobby, assertReplayTeams,
  storeLobby, loadLobby,
  scoreTeamArena, rankArenaTeams,
};
