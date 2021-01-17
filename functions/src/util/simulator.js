const http = require('axios').default;
const LZString = require('lz-string');
const Game = require('./Game');

function getReplay(replayId, server = 'na') {
  const BASE_URL = `https://generalsio-replays-${server}.s3.amazonaws.com`;
  return http.get(`${BASE_URL}/${replayId}.gior`, {responseType: 'arraybuffer'})
      .then(response => deserialize(response.data));
}

function getReplayStats(replayId, server = 'na') {
  return getReplay(replayId, server).then(replay => simulate(replay));
}

// TODO: handle team games (#7)
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
    return {name, kills: 0};
  });

  // Simulate the game!
  while (!game.isOver() && game.turn < 2000) {
    nextTurn();

    const alive = game.generals.filter(g => g >= 0).length;
    const turn = Math.floor(game.turn / 2);

    // print when players are eliminated
    if (alive < lastAlive) {
      for (let i = 0; i < game.generals.length; i++) {
        if (generals[i] !== game.generals[i]) {
          const killerIndex = game.map.tileAt(replay.generals[i]);
          const killer = usernames[killerIndex];
          if (killer !== undefined) {
            summary.push(`${killer} killed ${usernames[i]} on turn ${turn}`);
            players[killerIndex].kills++;
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
          currentAFK.add(afk.index);
        }
      }
    });

    // hold onto the last state
    generals = [...game.generals];
    lastAlive = alive;
  }

  summary.push(`${usernames[game.scores[0].i]} wins!`);

  // if the player that came in second quit or surrendered, give that kill to
  // the player who got first
  if (afks.find(afk => afk.index === game.scores[1].i)) {
    players[game.scores[0].i].kills++;
  }

  // scoring right now is a combination of rank + # of kills
  const scores = game.scores.map((score, index) => {
    const {name, kills} = players[score.i];
    const rank = index + 1;
    const points = game.generals.length - rank + kills;
    return {name, kills, rank, points, streak: false};
  });

  return {scores, summary};
}

// Returns an object that represents the replay.
// @param serialized A serialized replay Buffer.
function deserialize(serialized) {
  var obj =
      JSON.parse(LZString.decompressFromUint8Array(new Uint8Array(serialized)));

  var replay = {};
  var i = 0;
  replay.version = obj[i++];
  replay.id = obj[i++];
  replay.mapWidth = obj[i++];
  replay.mapHeight = obj[i++];
  replay.usernames = obj[i++];
  replay.stars = obj[i++];
  replay.cities = obj[i++];
  replay.cityArmies = obj[i++]
  replay.generals = obj[i++];
  replay.mountains = obj[i++];
  replay.moves = obj[i++].map(deserializeMove);
  replay.afks = obj[i++].map(deserializeAFK);
  replay.teams = obj[i++];
  replay.map_title = obj[i++];  // only available when version >= 7

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

module.exports = {
  getReplay: getReplay,
  getReplayStats: getReplayStats
};