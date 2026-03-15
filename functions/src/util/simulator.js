const http = require('axios').default;
const deserializeReplay = require('./ReplayDeserializer');
const EventReplaySimulation = require('./EventReplaySimulation');

function getReplay(replayId, server = 'na') {
  const BASE_URL = `https://generalsio-replays-${server}.s3.amazonaws.com`;
  return http.get(`${BASE_URL}/${replayId}.gior`, { responseType: 'arraybuffer' })
    .then(response => deserializeReplay(response.data));
}

/**
 * Returns a promise of an object looking like:
 * {
 *   scores: IGamePlayerStats[],
 *   summary: string[]
 * }
 */
function getReplayStats(replayId, server = 'na') {
  return getReplay(replayId, server).then(replay => simulate(replay));
}

// TODO: maybe recognize players that turtle, give 0 points (#8)
function simulate(replay) {
  const summary = [];
  const currentAFK = new Set();
  const players = replay.usernames.map(name => ({ name, kills: 0, lastTurn: 0, killed: [], killedBy: [], tilesAfterFirstRound: 0 }));
  const game = new EventReplaySimulation(replay, players, summary, currentAFK);
  let turn = 0;

  // Simulate the game!
  while (!game.isOver()) {
    game.nextTurn();

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

  // the last player alive made it to the final turn, they win
  const winnerIndex = rankedScores[0].i;
  players[winnerIndex].lastTurn = turn;
  summary.push(`${replay.usernames[winnerIndex]} wins!`);

  // if the player that came in second quit or surrendered, give that kill to
  // the player who won
  if (rankedScores.length > 1 && replay.afks.find(afk => afk.index === rankedScores[1].i)) {
    const secondPlace = players[rankedScores[1].i].name;

    // only increment if they aren't already in their list of kills
    // this is an edge case where someone quits right as they're captured
    if (!players[winnerIndex].killed.includes(secondPlace)) {
      players[winnerIndex].kills++;
    }
  }

  // scoring right now is a combination of rank + # of kills
  const scores = rankedScores.map((score, index) => {
    const { name, kills, lastTurn, killed, killedBy, tilesAfterFirstRound } = players[score.i];
    const rank = index + 1;
    const points = game.generals.length - rank + kills;
    return {
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
  });

  return { scores, summary, turns: turn };
}

module.exports = {
  getReplay: getReplay,
  getReplayStats: getReplayStats,
  simulate: simulate,
};
