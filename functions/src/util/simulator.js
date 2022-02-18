const http = require('axios').default;
const LZString = require('lz-string');
const Game = require('./Game');

function getReplay(replayId, server = 'na') {
  const BASE_URL = `https://generalsio-replays-${server}.s3.amazonaws.com`;
  return http.get(`${BASE_URL}/${replayId}.gior`, {responseType: 'arraybuffer'})
      .then(response => deserialize(response.data));
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
  // Create a game from the replay.
  var game = Game.createFromReplay(replay);

  var currentMoveIndex = 0;
  var currentAFKIndex = 0;

  // Simulates the next turn.
  function nextTurn() {
    // Put moves in the move queue.
    while (replay.moves.length > currentMoveIndex &&
           replay.moves[currentMoveIndex].turn <= game.turn) {
      var move = replay.moves[currentMoveIndex++];
      game.handleAttack(move.index, move.start, move.end, move.is50);
    }

    // Check for AFKs.
    while (replay.afks.length > currentAFKIndex &&
           replay.afks[currentAFKIndex].turn <= game.turn) {
      var afk = replay.afks[currentAFKIndex++];
      var index = afk.index;

      // If already dead, mark as dead general and neutralize if needed.
      if (game.deaths.indexOf(game.sockets[index]) >= 0) {
        game.tryNeutralizePlayer(index);
      }
      // Mark as AFK if not already dead.
      else {
        game.deaths.push(game.sockets[index]);
        game.alivePlayers--;
      }
    }

    game.update();
  }

  const summary = [];
  let {alivePlayers: lastAlive, generals} = game;
  let {afks, usernames} = replay;
  let currentAFK = new Set();
  let players = replay.usernames.map(name => {
    return {name, kills: 0, lastTurn: 0, killed: [], killedBy: [], tilesAfterFirstRound: 0};
  });
  let turn = 0;

  // Simulate the game!
  while (!game.isOver()) {
    nextTurn();

    // first round just ended
    if (game.turn === 50) {
      players.forEach((player, index) => {
        player.tilesAfterFirstRound = game.scores.find(score => score.i === index).tiles;
      });
    }

    const alive = game.generals.filter(g => g >= 0).length;
    turn = Math.floor(game.turn / 2);

    // print when players are eliminated
    if (alive < lastAlive) {
      for (let i = 0; i < game.generals.length; i++) {
        if (generals[i] !== game.generals[i]) {
          const killerIndex = game.map.tileAt(replay.generals[i]);
          const killer = usernames[killerIndex];
          if (killer !== undefined) {
            summary.push(`${killer} killed ${usernames[i]} on turn ${turn}`);
            players[killerIndex].kills++;
            players[killerIndex].killed.push(usernames[i]);

            // only set lastTurn if it isn't already set, otherwise players who
            // surrender then immediately jump into a new game will look like
            // they were in two games at once, even though they already
            // surrendered and left
            if (players[i].lastTurn === 0) {
              players[i].lastTurn = turn;
              players[i].killedBy.push(killer);
            }
          }
        }
      }
    }

    // print when players go afk, and then again when their general becomes a
    // city
    afks.forEach(afk => {
      if (afk.turn === game.turn) {
        const name = usernames[afk.index];
        if (currentAFK.has(afk.index)) {
          summary.push(`No one captured ${
              name} before they turned into a city on turn ${turn}`);
        } else {
          summary.push(`${name} quit on turn ${turn}`);
          players[afk.index].lastTurn = turn;
          currentAFK.add(afk.index);
        }
      }
    });

    // hold onto the last state
    generals = [...game.generals];
    lastAlive = alive;
  }

  // the last player alive made it to the final turn, they win
  const winnerIndex = game.scores[0].i;
  players[winnerIndex].lastTurn = turn;
  summary.push(`${usernames[winnerIndex]} wins!`);

  // if the player that came in second quit or surrendered, give that kill to
  // the player who won
  if (afks.find(afk => afk.index === game.scores[1].i)) {
    players[winnerIndex].kills++;
  }

  // scoring right now is a combination of rank + # of kills
  const scores = game.scores.map((score, index) => {
    const {name, kills, lastTurn, killed, killedBy, tilesAfterFirstRound} = players[score.i];
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

  return {scores, summary, turns: turn};
}

// Returns an object that represents the replay.
// @param serialized A serialized replay Buffer.
function deserialize(serialized) {
  const obj =
      JSON.parse(LZString.decompressFromUint8Array(new Uint8Array(serialized)));

  if (!obj) return;

  const replay = {};
  let i = 0;
  replay.version = obj[i++];
  replay.id = obj[i++];
  replay.mapWidth = obj[i++];
  replay.mapHeight = obj[i++];
  replay.usernames = obj[i++];
  replay.stars = obj[i++];
  replay.cities = obj[i++];
  replay.cityArmies = obj[i++];
  replay.generals = obj[i++];
  replay.mountains = obj[i++] || [];
  replay.moves = obj[i++].map(deserializeMove);
  replay.afks = obj[i++].map(deserializeAFK);
  replay.teams = obj[i++];
  replay.map = obj[i++];
  replay.neutrals = obj[i++] || [];
  replay.neutralArmies = obj[i++] || [];
  replay.swamps = obj[i++] || [];
  replay.chat = (obj[i++] || []).map(deserializeChat);
  replay.playerColors = obj[i++] || replay.usernames.map((u, i) => i);
  replay.lights = obj[i++] || [];
  const options = (obj[i++] || [
    1, Constants.DEFAULT_CITY_DENSITY_OPTION,
    Constants.DEFAULT_MOUNTAIN_DENSITY_OPTION,
    Constants.DEFAULT_SWAMP_DENSITY_OPTION
  ]);
  replay.speed = options[0];
  replay.city_density = options[1];
  replay.mountain_density = options[2];
  replay.swamp_density = options[3];

  return replay;
};

function deserializeMove(serialized) {
  return {
    index: serialized[0],
    start: serialized[1],
    end: serialized[2],
    is50: serialized[3],
    turn: serialized[4],
  };
}

function deserializeAFK(serialized) {
  return {
    index: serialized[0],
    turn: serialized[1],
  };
}

function deserializeChat(serialized) {
  return {
    text: serialized[0],
    prefix: serialized[1],
    playerIndex: serialized[2],
    turn: serialized[3],
  };
}

module.exports = {
  getReplay: getReplay,
  getReplayStats: getReplayStats
};
