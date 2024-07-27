'use strict';

var Map = require('./Map');
var Constants = require('./Constants');

var DEAD_GENERAL = -1;

// @param teams Optional. Defaults to FFA.
function Game(sockets, teams) {
  if (!sockets) return;
  this.sockets = sockets;
  this.teams = teams;

  this.turn = 0;
  this.alivePlayers = sockets.length;
  this.leftSockets = [];
  this.inputBuffer = [];
  this.scores = [];
  this.deaths = [];

  this.map = null;
  this.generals = [];
  this.cities = [];
  this.deserts = [];
  this.swamps = [];
  this.modifiers = [];
  this.lights = [];

  for (var i = 0; i < sockets.length; i++) {
    this.inputBuffer.push([]);
    this.scores.push({
      total: 1,
      tiles: 1,
    });
  }
}

Game.prototype.addMountain = function(index) {
  this.map.setTile(index, Map.TILE_MOUNTAIN);
};

Game.prototype.addLookout = function(index) {
  this.map.setTile(index, Map.TILE_LOOKOUT);
};

Game.prototype.addObservatory = function(index) {
  this.map.setTile(index, Map.TILE_OBSERVATORY);
};

Game.prototype.addSwamp = function(index) {
  this.swamps.push(index);
};

Game.prototype.addDesert = function(index) {
  this.deserts.push(index);
};

Game.prototype.addCity = function(index, army) {
  this.cities.push(index);
  this.map.setArmy(index, army);
};

Game.prototype.addGeneral = function(index) {
  this.generals.push(index);
  if (index !== null) {
    this.map.setTile(index, this.generals.length - 1);
    this.map.setArmy(index, 1);
  }
};

Game.prototype.addNeutral = function(index, army) {
  if (!this.neutrals) this.neutrals = [];
  this.neutrals.push(index);
  this.map.setArmy(index, army);
};

Game.createFromReplay = function(gameReplay) {
  const sockets = gameReplay.generals.map(
      (g, i) => ({
        emit: function() {},
        gio_username: gameReplay.usernames[i],
        gio_stars: gameReplay.stars ? (gameReplay.stars[i] || 0) : '',
        gio_playerColor: gameReplay.playerColors[i],
      }));
  const game = new Game(sockets, gameReplay.teams);

  game.cities = [];
  game.generals = [];
  game.swamps = [];
  game.deserts = [];
  game.lights = gameReplay.lights;
  game.modifiers = gameReplay.modifiers || [];

  // Init the game map from the replay.
  game.map = new Map(gameReplay.mapWidth, gameReplay.mapHeight, gameReplay.teams, game.modifiers);
  gameReplay.mountains.forEach(m => {
    game.addMountain(m);
  });
  gameReplay.lookouts.forEach(m => {
    game.addLookout(m);
  });
  gameReplay.observatories.forEach(m => {
    game.addObservatory(m);
  });
  gameReplay.swamps.forEach(s => {
    game.addSwamp(s);
  });
  gameReplay.deserts.forEach(d => {
    game.addDesert(d);
  });
  gameReplay.cities.forEach((city, i) => {
    game.addCity(city, gameReplay.cityArmies[i]);
  });
  gameReplay.generals.forEach(g => {
    game.addGeneral(g);
  });
  gameReplay.neutrals.forEach((n, i) => {
    game.addNeutral(n, gameReplay.neutralArmies[i]);
  });

  return game;
};

Game

// Returns true when the game is over.
Game.prototype.update = function() {
  // Handle buffered attacks.
  for (var sock = 0; sock < this.sockets.length; sock++) {
    // Flip priorities every other turn.
    var i = (this.turn & 1) === 0 ? sock : this.sockets.length - 1 - sock;

    while (this.inputBuffer[i].length) {
      var attack = this.inputBuffer[i].splice(0, 1)[0];
      if (this.handleAttack(i, attack[0], attack[1], attack[2], attack[3]) !==
          false) {
        // This attack wasn't useless.
        break;
      }
    }
  }

  this.turn++;

  // Increment armies at generals and cities, decrement armies at swamps.
  if (this.turn % Constants.RECRUIT_RATE === 0) {
    for (i = 0; i < this.generals.length; i++) {
      this.map.incrementArmyAt(this.generals[i]);
    }
    for (i = 0; i < this.cities.length; i++) {
      // Increment owned cities.
      if (this.map.tileAt(this.cities[i]) >= 0) {
        this.map.incrementArmyAt(this.cities[i]);
      }
    }
    for (i = 0; i < this.swamps.length; i++) {
      if (this.map.tileAt(this.swamps[i]) >= 0) {
        this.map.decrementArmyAt(this.swamps[i]);
      }
    }
  }

  // Give farm to all owned tiles for all players.
  if (this.turn % Constants.FARM_RATE === 0) {
    var size = this.map.size();
    for (var i = 0; i < size; i++) {
      if (this.map.tileAt(i) >= 0) {
        this.map.incrementArmyAt(i);
      }
    }

    // We just incremented deserts too though, which dont gain any army. So reduce them back down specifically.
    for (var i = 0; i < this.deserts.length; i++) {
      const desertIdx = this.deserts[i];
      if (this.map.tileAt(desertIdx) >= 0) {
        this.map.decrementArmyAt(desertIdx);
      }
    }
  }

  this.recalculateScores();
};

// Returns true if the game is over.
Game.prototype.isOver = function() {
  // Game with no teams - ends when one player is left.
  if (!this.teams && this.alivePlayers === 1) {
    return true;
  }
  // Game with teams - ends when everyone left alive is on the same team.
  else if (this.teams) {
    var winningTeam = undefined;
    for (var i = 0; i < this.generals.length; i++) {
      if (this.deaths.indexOf(this.sockets[i]) < 0) {
        // Player is alive!
        if (winningTeam === undefined) {
          winningTeam = this.teams[i];
        } else if (this.teams[i] !== winningTeam) {
          return;
        }
      }
    }
    return true;
  }
};

Game.prototype.recalculateScores = function() {
  // Recalculate scores (totals, tiles).
  for (var i = 0; i < this.sockets.length; i++) {
    this.scores[i].i = i;
    this.scores[i].total = 0;
    this.scores[i].tiles = 0;
    this.scores[i].dead = (this.deaths.indexOf(this.sockets[i]) >= 0);
  }
  for (var i = 0; i < this.map.size(); i++) {
    var tile = this.map.tileAt(i);
    if (tile >= 0) {
      this.scores[tile].total += this.map.armyAt(i);
      this.scores[tile].tiles++;
    }
  }
  var self = this;
  this.scores.sort(function(a, b) {
    if (a.dead && !b.dead) return 1;
    if (b.dead && !a.dead) return -1;
    if (a.dead && b.dead) {
      return self.deaths.indexOf(self.sockets[b.i]) -
          self.deaths.indexOf(self.sockets[a.i]);
    }
    if (b.total === a.total) return b.tiles - a.tiles;
    return b.total - a.total;
  });
};

Game.prototype.indexOfSocketID = function(socket_id) {
  var index = -1;
  for (var i = 0; i < this.sockets.length; i++) {
    if (this.sockets[i].id == socket_id) {
      index = i;
      break;
    }
  }
  return index;
};

// Returns false if the attack was useless, i.e. had no effect or failed.
Game.prototype.handleAttack = function(index, start, end, is50, attackIndex) {
  // Verify that the attack starts from an owned tile.
  if (this.map.tileAt(start) !== index) {
    return false;
  }

  // Store the value of the end tile pre-attack.
  var endTile = this.map.tileAt(end);

  // Handle the attack.
  var succeeded = this.map.attack(start, end, is50, this.generals);
  if (!succeeded) {
    return false;
  }

  // Check if this attack toppled a general.
  var newEndTile = this.map.tileAt(end);
  var generalIndex = this.generals.indexOf(end);
  if (newEndTile !== endTile && generalIndex >= 0) {
    // General captured! Give the capturer command of the captured's army.
    this.map.replaceAll(endTile, newEndTile, 0.5);

    // Only count as a death if this player has not died before (i.e. rage
    // quitting)
    var deadSocket = this.sockets[endTile];
    if (this.deaths.indexOf(deadSocket) < 0) {
      this.deaths.push(deadSocket);
      this.alivePlayers--;
      deadSocket.emit('game_lost', {
        killer: newEndTile,
      });
    }

    // Turn the general into a city.
    if (this.modifiers.includes(Constants.MODIFIER_INDEXES.Leapfrog)) {
      this.cities.push(this.generals[index]);
      this.generals[index] = this.generals[generalIndex];
    } else {
      this.cities.push(end);
    }
    this.generals[generalIndex] = DEAD_GENERAL;
  }
};

// Returns the index of an alive teammate of the given player, if any.
Game.prototype.aliveTeammate = function(index) {
  if (this.teams) {
    for (var i = 0; i < this.sockets.length; i++) {
      if (this.teams[i] === this.teams[index] &&
          this.deaths.indexOf(this.sockets[i]) < 0) {
        return i;
      }
    }
  }
};

// If the player hasn't been captured yet, either gives their land to a teammate
// or turns it gray (neutral).
Game.prototype.tryNeutralizePlayer = function(playerIndex) {
  var deadGeneralIndex = this.generals[playerIndex];
  this.generals[playerIndex] = DEAD_GENERAL;

  // Check if the player has an alive teammate who can take their land.
  var aliveTeammateIndex = this.aliveTeammate(playerIndex);
  var newIndex = Number.isInteger(aliveTeammateIndex) ? aliveTeammateIndex :
                                                        Map.TILE_EMPTY;

  // Check if the player hasn't been captured yet.
  if (this.map.tileAt(deadGeneralIndex) === playerIndex) {
    this.map.replaceAll(playerIndex, newIndex);
    this.cities.push(deadGeneralIndex);
  }
};

module.exports = Game;