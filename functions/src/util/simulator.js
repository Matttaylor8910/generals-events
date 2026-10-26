const EventReplaySimulation = require('./EventReplaySimulation');
const Constants = require('./Constants');
const EventGameOptions = require('./EventGameOptions');
const TeamArena = require('./TeamArena');

const ReplayLoader = require('./ReplayLoader');

function getReplay(replayId, server = 'na') {
  // bounded S3 -> backup -> S3 sequence; 'loc' stays on the guarded local
  // replay transport and never reaches cloud storage. The loader returns
  // the decoded replay so nothing parses the bytes twice.
  return ReplayLoader.getReplay(replayId, server);
}

/**
 * Returns a promise of an object looking like:
 * {
 *   scores: IGamePlayerStats[],
 *   summary: string[],
 *   turns: number,
 *   elapsedMs?: number|null,  // Chess Clock only
 * }
 *
 * When expectedOptions is provided and explicitly carries a modifiers field,
 * the decoded replay's modifier set and ChessClock options must match it or
 * the promise rejects before any results are written.
 *
 * @returns {Promise<{scores: any[], summary: string[], turns: number,
 *     elapsedMs?: number|null}>}
 */
function getReplayStats(replayId, server = 'na', expectedOptions) {
  return getReplay(replayId, server).then(replay => {
    EventGameOptions.assertReplayMatchesExpectedOptions(
        replay, expectedOptions);
    return simulate(replay);
  });
}

/**
 * Same contract as getReplayStats plus a team roster gate: the decoded
 * replay's usernames must exactly partition into expectedTeams
 * ({id, name, players}) and the replay's own team assignments must match the
 * dispatched roster. Any mismatch rejects before simulation, so a foreign
 * replay can never be scored against a dispatched arena game. The result
 * carries teamOutcomes: per-team terminal results keyed by dispatched team
 * id.
 *
 * @returns {Promise<{scores: any[], summary: string[], turns: number,
 *     elapsedMs?: number|null, teamOutcomes: object[]}>}
 */
function getTeamArenaReplayStats(
    replayId, server = 'na', expectedOptions, expectedTeams) {
  return getReplay(replayId, server).then(replay => {
    EventGameOptions.assertReplayMatchesExpectedOptions(
        replay, expectedOptions);
    TeamArena.assertReplayTeams(replay, expectedTeams);
    return simulate(replay, expectedTeams);
  });
}

// TODO: maybe recognize players that turtle, give 0 points (#8)
//
// expectedTeams is optional: when provided (team arena dispatch), the
// simulation additionally records the first turn on which every member of
// each dispatched team is dead, and the winning team is identified from the
// engine's actual winners rather than the individual leaderboard (a winning
// teammate may have died first, and has_kill sorts before alive).
function simulate(replay, expectedTeams) {
  // a direct team-arena call validates the roster partition the same way
  // the fetching wrapper does; there is no trusted bypass
  if (expectedTeams !== undefined && expectedTeams !== null) {
    TeamArena.assertReplayTeams(replay, expectedTeams);
  }

  const isChessClock = (replay.modifiers || [])
      .includes(Constants.MODIFIER_INDEXES.ChessClock);

  // exact elapsed metadata for Chess Clock replays; validated rather than
  // trusted so malformed timing data throws instead of producing plausible
  // but wrong results. Replays serialized at v21+ must carry a complete
  // exact-timing object: partial or missing metadata means the game never
  // finished and must not be scored (a fake idle winner and a fabricated
  // short duration is exactly what this rejects). Older clock replays
  // predate the tail and score normally with an unknown elapsed time.
  let elapsed = null;
  if (isChessClock && replay.version >= 20) {
    EventGameOptions.assertCompletedChessClockElapsed(
        replay.chessClockElapsed, replay.usernames.length);
    const executionTimestamps = replay.chessClockMoveExecutionTimestamps || [];
    if (replay.chessClockElapsed.turns.length !==
        executionTimestamps.length) {
      throw new Error('chessClockElapsed turns do not align with ' +
          'execution timestamps');
    }
    elapsed = replay.chessClockElapsed;
  } else if (isChessClock && replay.chessClockElapsed) {
    EventGameOptions.assertValidChessClockElapsed(
        replay.chessClockElapsed, replay.usernames.length);
    const executionTimestamps = replay.chessClockMoveExecutionTimestamps || [];
    if (replay.chessClockElapsed.turns.length !==
        executionTimestamps.length) {
      throw new Error('chessClockElapsed turns do not align with ' +
          'execution timestamps');
    }
    elapsed = replay.chessClockElapsed;
  }

  // a v20+ exact-clock replay must reach its recorded terminal outcome
  // within its executed-turn timeline. The +1 covers an afk/surrender
  // landing between executions; simulating past that means the replay was
  // truncated before its final move and the all-AFK idle limit would
  // fabricate a winner under a finite "exact" duration
  const boundToRecordedTurns =
      elapsed && replay.version >= 20 ? elapsed.turns.length : -1;

  const summary = [];
  const currentAFK = new Set();
  const players = replay.usernames.map(name => ({ name, kills: 0, lastTurn: 0, killed: [], killedBy: [], tilesAfterFirstRound: 0 }));
  const game = new EventReplaySimulation(replay, players, summary, currentAFK);
  let turn = 0;

  // team arena tracking: replay team index -> dispatched team id, plus the
  // first turn on which every member of a team is dead
  let teamTracking = null;
  if (expectedTeams) {
    if (!Array.isArray(replay.teams) ||
        replay.teams.length !== replay.usernames.length) {
      throw new Error('Replay has no valid team roster');
    }
    teamTracking = expectedTeams.map(team => {
      const playerIndexes =
          team.players.map(name => replay.usernames.indexOf(name));
      return {
        id: team.id,
        replayTeam: replay.teams[playerIndexes[0]],
        playerIndexes,
        eliminatedTurn: null,
      };
    });
  }

  // Simulate the game!
  while (!game.isOver()) {
    if (boundToRecordedTurns >= 0 &&
        game.turn > boundToRecordedTurns) {
      throw new Error('No recorded terminal outcome');
    }
    game.nextTurn();

    if (teamTracking) {
      // raw game turn, not the halved summary turn: consecutive executions
      // that share a summary turn would falsely tie two eliminations that
      // actually resolved in order
      for (const tracked of teamTracking) {
        if (tracked.eliminatedTurn === null &&
            tracked.playerIndexes.every(
                index => game.isDead(game.sockets[index]))) {
          tracked.eliminatedTurn = game.turn;
        }
      }
    }

    // first round just ended
    if (game.turn === 50) {
      game.recalculateScores();
      players.forEach((player, index) => {
        const score = game.scores.find(candidate => candidate.i === index);
        player.tilesAfterFirstRound = score ? score.tiles : 0;
      });
    }

    turn = Math.floor(game.turn / 2);
  }

  game.recalculateScores();
  const rankedScores = game.leaderboardScores;

  // team arena outcomes come from the engine's real winners (every member
  // of the surviving team, even earlier-dead teammates), not the individual
  // leaderboard order where has_kill outranks alive. Survivors that never
  // recorded a death get the terminal turn; early-dead teammates keep their
  // own death times.
  let teamOutcomes;
  if (teamTracking) {
    const winners = game.isOver() || [];
    const winnerReplayTeam =
        winners.length ?
        replay.teams[replay.usernames.indexOf(winners[0].gio_username)] :
        undefined;
    teamOutcomes = teamTracking.map(tracked => ({
      id: tracked.id,
      winner: tracked.replayTeam === winnerReplayTeam,
      eliminatedTurn: tracked.eliminatedTurn,
    }));
    for (const socket of winners) {
      const index = replay.usernames.indexOf(socket.gio_username);
      // a teammate who died earlier keeps their real death turn; only the
      // survivors carry the terminal turn
      if (index >= 0 &&
          !game.isDead(game.sockets[index]) &&
          !players[index].lastTurn) {
        players[index].lastTurn = turn;
      }
    }
    if (winners.length) {
      const winnerNames = winners
          .map(socket => socket.gio_username).join(', ');
      summary.push(`${winnerNames} win!`);
    }
  } else {
    // legacy path: the last player alive made it to the final turn
    const winnerIndex = rankedScores[0].i;
    players[winnerIndex].lastTurn = turn;
    summary.push(`${replay.usernames[winnerIndex]} wins!`);

    // if the player that came in second quit or surrendered, give that
    // kill to the player who won
    if (rankedScores.length > 1 &&
        replay.afks.find(afk => afk.index === rankedScores[1].i)) {
      const secondPlace = players[rankedScores[1].i].name;

      // only increment if they aren't already in their list of kills
      // this is an edge case where someone quits right as they're captured
      if (!players[winnerIndex].killed.includes(secondPlace)) {
        players[winnerIndex].kills++;
      }
    }
  }

  // scoring right now is a combination of rank + # of kills
  const scores = rankedScores.map((score, index) => {
    const { name, kills, lastTurn, killed, killedBy, tilesAfterFirstRound } = players[score.i];
    const rank = index + 1;
    const points = game.generals.length - rank + kills;
    const record = {
      name,
      kills,
      rank,
      points,
      lastTurn,
      killed,
      killedBy,
      tilesAfterFirstRound,
      streak: false,
    };
    // exact per-player death offset in ms for Chess Clock replays only; null
    // for players still alive and for legacy clock replays that predate the
    // elapsed metadata
    if (elapsed) {
      record.elapsedMs = elapsed.players[score.i];
    } else if (isChessClock) {
      record.elapsedMs = null;
    }
    return record;
  });

  const result = { scores, summary, turns: turn };
  // Chess Clock replays always report elapsedMs explicitly: the recorded
  // duration when present, or null for legacy replays so callers mark the
  // finish time as unknown instead of inventing one from turn counts.
  if (isChessClock) {
    result.elapsedMs = elapsed ? elapsed.duration : null;
  }
  if (teamOutcomes) {
    result.teamOutcomes = teamOutcomes;
  }
  return result;
}

module.exports = {
  getReplay: getReplay,
  getReplayStats: getReplayStats,
  getTeamArenaReplayStats: getTeamArenaReplayStats,
  simulate: simulate,
};
