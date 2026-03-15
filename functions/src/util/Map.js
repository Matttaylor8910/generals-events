'use strict';

const Constants = require('./Constants');

// @param teams Optional. If supplied, teams[i] is the team for player i.
function Map(width, height, teams, modifiers = null) {
  this.width = width;
  this.height = height;
  this.modifiers = modifiers || [];
  this.modFlags = Object.keys(Constants.MODIFIER_INDEXES).reduce((arr) => {
    arr.push(false);
    return arr;
  }, []);
  for (let modifierIndex = 0; modifierIndex < this.modifiers.length; modifierIndex++) {
    this.modFlags[this.modifiers[modifierIndex]] = true;
  }
  if (teams) this.teams = teams;

  this._map = [];
  this._armies = [];
  for (let i = 0; i < this.height; i++) {
    for (let j = 0; j < this.width; j++) {
      this._map.push(Map.TILE_EMPTY);
      this._armies.push(0);
    }
  }

  // Certain functions need to be different implementations for Torus vs not-torus:
  if (!this.modFlags[Constants.MODIFIER_INDEXES.Torus]) {
    // NORMAL IMPL

    /**
     * Less performant than indexFrom. Also, try to avoid using this at all by using movable / visible caches instead (but not when using the map editor).
     *
     * @param {*} row
     * @param {*} col
     * @returns -1 if not valid coordinates, otherwise the index of the tile.
     */
    this.indexFromChecked = function (row, col) {
      if (row >= this.height || row < 0) return -1;
      if (col >= this.width || col < 0) return -1;
      return row * this.width + col;
    };

    // TODO with the movable stuff, in theory we should be able to remove almost all uses of this.
    this.indexFrom = function (row, col) {
      return row * this.width + col;
    };

    // Returns the Manhattan distance between index1 and index2. Use the basic manhattan distance function as the real distance function.
    this.distance = function (index1, index2) {
      const x1 = Math.floor(index1 / this.width);
      const y1 = index1 % this.width;
      const x2 = Math.floor(index2 / this.width);
      const y2 = index2 % this.width;
      return Math.abs(x1 - x2) + Math.abs(y1 - y2);
    };
  } else {
    // TORUS IMPL
    // Override the default implementation of specific functions to ones that supports torus maps.
    //  This lets us keep the fast implementation by default by not having if-checks in every one of these functions.
    this.indexFromChecked = function (row, col) {
      if (row >= this.height)
        row -= this.height;

      if (row < 0)
        row += this.height;

      if (col >= this.width)
        col -= this.width;

      if (col < 0)
        col += this.width;

      return row * this.width + col;
    };

    // There is now no difference between these functions in Torus map case, as the edges are always handled by wrapping, now.
    this.indexFrom = this.indexFromChecked;

    // For Torus we need to consider wrapping. We'll do that by checking the normal manhattan distances,
    // as well as the reflected versions (both up, and right) manhattan distances, and taking the minimum.
    this.distance = function (index1, index2) {
      const x1 = Math.floor(index1 / this.width);
      const y1 = index1 % this.width;
      const x2 = Math.floor(index2 / this.width);
      const y2 = index2 % this.width;

      const xMin = Math.min(Math.abs(x1 - x2), Math.abs(x1 - x2 + this.height), Math.abs(x2 - x1 + this.height));
      const yMin = Math.min(Math.abs(y1 - y2), Math.abs(y1 - y2 + this.width), Math.abs(y2 - y1 + this.width));

      return xMin + yMin;
    };
  }

  this._precomputeMovable();
}

Map.prototype.locationOf = function (index) {
  const row = Math.floor(index / this.width);
  const col = index % this.width;
  return { row, col };
};

Map.prototype._precomputeMovable = function () {
  this.movableLookup = new Array(this._map.length);

  for (let i = 0; i < this._map.length; i++) {
    const thisTileMovable = [];
    const { row: r, col: c } = this.locationOf(i);

    const up = this.indexFromChecked(r - 1, c);
    if (up != -1) thisTileMovable.push(up);
    const down = this.indexFromChecked(r + 1, c);
    if (down != -1) thisTileMovable.push(down);
    const left = this.indexFromChecked(r, c - 1);
    if (left != -1) thisTileMovable.push(left);
    const right = this.indexFromChecked(r, c + 1);
    if (right != -1) thisTileMovable.push(right);

    this.movableLookup[i] = thisTileMovable;
  }
};

Map.prototype.size = function() {
  return this.width * this.height;
};

// Returns whether index 1 is adjacent to index 2.
Map.prototype.isAdjacent = function(i1, i2) {
  return this.movableLookup[i1].includes(i2);
};

Map.prototype.isValidTile = function(index) {
  return index >= 0 && index < this._map.length;
};

Map.prototype.isSameTeam = function(startTile, endTile) {
  if (startTile < 0 || endTile < 0) {
    return false;
  }

  if (startTile === endTile) {
    return true;
  }

  return !!this.teams && this.teams[startTile] === this.teams[endTile];
};

Map.prototype.isObstacle = function (index) {
  const t = this._map[index];
  return t === Map.TILE_MOUNTAIN || t === Map.TILE_OBSERVATORY || t === Map.TILE_LOOKOUT;
};

Map.prototype.tileAt = function(index) {
  return this._map[index];
};

Map.prototype.armyAt = function(index) {
  return this._armies[index];
};

Map.prototype.setTile = function(index, val) {
  this._map[index] = val;
};

Map.prototype.setArmy = function(index, val) {
  this._armies[index] = val;
};

Map.prototype.incrementArmyAt = function(index) {
  this._armies[index]++;
};

// Used by swamp handler ONLY. If the new army value is 0 (e.g. from a swamp),
// reset the tile to empty.
Map.prototype.decrementArmyAt = function(index) {
  this._armies[index]--;
  if (this._armies[index] <= 0) {
    this._map[index] = Map.TILE_EMPTY;

    // To make sure it does not end with -1 on it, set army to 0 if it is empty
    if (this._armies[index] < 0) {
      this._armies[index] = 0;
    }
  }
};

// Attacks from start to end. Always leaves 1 unit left at start.
Map.prototype.attack = function(start, end, is50, generals) {
  if (!this.isValidMove(start, end, is50, generals)) {
    return false;
  }

  const reserve = is50 ? Math.ceil(this._armies[start] / 2) : 1;
  const endTile = this._map[end];
  const startTile = this._map[start];
  const nonTeamMove = !this.isSameTeam(startTile, endTile);

  // Attacking an enemy or neutral tile.
  if (nonTeamMove) {
    // player -> enemy
    if (this.modFlags[Constants.MODIFIER_INDEXES.Defenseless] && generals[endTile] === end) {
      // Defenseless modifier
      this._armies[end] = Math.max(0, this._armies[start] - reserve - this._armies[end]);
      this.setTile(end, startTile);
    } else if (this._armies[end] >= this._armies[start] - reserve) {
      // Non-takeover
      this._armies[end] -= this._armies[start] - reserve;
    } else {
      // Takeover
      this._armies[end] = this._armies[start] - reserve - this._armies[end];
      this.setTile(end, startTile);
    }
  } else {
    // Attacking an Ally (or own tile)
    this._armies[end] += this._armies[start] - reserve;
    if (endTile !== startTile && generals[endTile] !== end) {
      // Attacking a non-general allied tile.
      // Steal ownership of the tile.
      this.setTile(end, startTile);
    }
  }

  this._armies[start] = reserve;

  return true;
};

Map.prototype.isValidMove = function(start, end) {
  if (!this.isValidTile(start)) {
    console.error('Attack has invalid start position ' + start);
    return false;
  }

  if (!this.isValidTile(end)) {
    console.error('Attack has invalid end position ' + end);
    return false;
  }

  if (!this.isAdjacent(start, end)) {
    return false;
  }

  if (this.isObstacle(end)) {
    return false;
  }

  if (this._armies[start] === 0) {
    return false;
  }

  const endTile = this._map[end];
  const startTile = this._map[start];
  const nonTeamMove = !this.isSameTeam(startTile, endTile);

  if (nonTeamMove && this._armies[start] <= 1) {
    return false;
  }

  return true;
};

// Replaces all tiles of value val1 with val2.
// @param scale Optional. If provided, scales replaced armies down using scale
// as a multiplier.
Map.prototype.replaceAll = function(val1, val2, scale) {
  scale = scale || 1;
  for (let i = 0; i < this._map.length; i++) {
    if (this._map[i] === val1) {
      this._map[i] = val2;
      this._armies[i] = Math.round(this._armies[i] * scale);
    }
  }
};

// Nonnegative numbers represent player indices.
Map.TILE_EMPTY = -1;
Map.TILE_MOUNTAIN = -2;
Map.TILE_FOG = -3;
Map.TILE_FOG_OBSTACLE = -4;
Map.TILE_LOOKOUT = -5;
Map.TILE_OBSERVATORY = -6;

module.exports = Map;