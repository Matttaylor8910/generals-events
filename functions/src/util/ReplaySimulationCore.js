const Constants = require('./Constants');
const Map = require('./Map');
const MoveResolver = require('./MoveResolver');

const DEAD_GENERAL = -1;
const GAME_TYPES = {
  REPLAY: 'replay',
  TWO_VS_TWO: '2v2',
  BIG_TEAM: 'bigteam',
};

function hasDuplicate(arr) {
  return !!arr && arr.some((item, index) => arr.indexOf(item) !== index);
}

function createReplayOptions(gameReplay) {
  const version = gameReplay.version;
  return {
    priority_cycle: version === 3,
    priority_reversed: version === 4,
    old_priority: version < 5,
    city_regen: version < 6,
    chat_present: version >= 9,
    general_trade_events_present: version >= 16,
    modifiers: gameReplay.modifiers || [],
    old_priority_v2: version >= 5 && version < 15,
  };
}

function createReplaySockets(gameReplay) {
  return gameReplay.generals.map((g, i) => ({
    id: `replay-${i}`,
    emit: function () {},
    gio_username: gameReplay.usernames[i],
    gio_stars: gameReplay.stars ? (gameReplay.stars[i] || 0) : '',
    gio_playerColor: gameReplay.playerColors[i],
    _replayIndex: i,
    dead: false,
    queueDeath: false,
    moveCount: 0,
    lastMoveTurn: 0,
  }));
}

class ReplaySimulationCore {
  constructor(gameReplay, config = {}) {
    this.gameReplay = gameReplay;
    this.type = GAME_TYPES.REPLAY;
    this.options = config.options || createReplayOptions(gameReplay);
    this.sockets = config.sockets || createReplaySockets(gameReplay);
    this.teams = gameReplay.teams || null;
    this.turn = 0;
    this.alivePlayers = this.sockets.length;
    this.leftSockets = [];
    this.inputBuffer = [];
    this.scores = [];
    this.leaderboardScores = [];
    this.capturedPlayers = [];
    this.captures = [];
    this.deaths = [];
    this.attackIndices = [];
    this.annihilatedArmyAgainstPlayers = [];
    this.updatesSinceLastMove = 0;
    this.winners = undefined;
    this.cities = [];
    this.citySet = new Set();
    this.generals = [];
    this.deserts = [];
    this.swamps = [];
    this.lights = gameReplay.lights || [];
    this.neutrals = [];
    this.rawVisible = null;
    this.currentAFKIndex = 0;
    this.currentMoveIndex = 0;
    this.currentChatIndex = 0;
    this.currentGeneralTradeIndex = 0;
    this.getNextValidSetOfMovesPrioritized = this.getPlayerMovesPriorityV3;
    if (this.options.old_priority) {
      this.getNextValidSetOfMovesPrioritized = this.getPlayerMovesPriorityV1;
    } else if (this.options.old_priority_v2) {
      this.getNextValidSetOfMovesPrioritized = this.getPlayerMovesPriorityV2;
    }

    this.moveResolver = new MoveResolver();

    for (let i = 0; i < this.sockets.length; i++) {
      this.inputBuffer.push([]);
      this.scores.push({ total: 1, tiles: 1 });
      this.captures.push(0);
      this.capturedPlayers.push([]);
      this.attackIndices[i] = 0;
      this.annihilatedArmyAgainstPlayers[i] = new Int32Array(this.sockets.length);
    }

    this.map = config.map || (config.createMap ? config.createMap(gameReplay) : new Map(gameReplay.mapWidth, gameReplay.mapHeight, gameReplay.teams, gameReplay.modifiers || []));
    this.populateFromReplay(gameReplay);
    this.moveResolver.setMap(this.map, this.generals);
    if (typeof this.map.computeVisibility === 'function') {
      this.rawVisible = this.map.computeVisibility(this.lights, this.cities, this.generals, 0);
    }
  }

  populateFromReplay(gameReplay) {
    gameReplay.mountains.forEach((m) => this.addMountain(m));
    gameReplay.observatories.forEach((m) => this.addObservatory(m));
    gameReplay.lookouts.forEach((m) => this.addLookout(m));
    gameReplay.deserts.forEach((d) => this.addDesert(d));
    gameReplay.swamps.forEach((s) => this.addSwamp(s));
    gameReplay.cities.forEach((city, i) => this.addCity(city, gameReplay.cityArmies[i]));
    gameReplay.generals.forEach((g, i) => {
      this.addGeneral(g);
      if (g === null || g === undefined) {
        this.deaths.push(this.sockets[i]);
        this.sockets[i].dead = true;
        this.alivePlayers--;
      }
    });
    (gameReplay.neutrals || []).forEach((n, i) => this.addNeutral(n, gameReplay.neutralArmies[i]));
  }

  addMountain(index) {
    this.map.setTile(index, Map.TILE_MOUNTAIN);
  }

  addObservatory(index) {
    this.map.setTile(index, Map.TILE_OBSERVATORY);
  }

  addLookout(index) {
    this.map.setTile(index, Map.TILE_LOOKOUT);
  }

  addDesert(index) {
    this.deserts.push(index);
  }

  addSwamp(index) {
    this.swamps.push(index);
  }

  addCity(index, army) {
    this.cities.push(index);
    this.citySet.add(index);
    this.map.setArmy(index, army);
  }

  addGeneral(index) {
    this.generals.push(index);
    if (index !== null && index !== undefined) {
      this.map.setTile(index, this.generals.length - 1);
      this.map.setArmy(index, 1);
    }
  }

  addNeutral(index, army) {
    this.neutrals.push(index);
    this.map.setArmy(index, army);
  }

  nextTurn(no_visible_update) {
    if (this.isOver()) {
      return;
    }

    this.processReplayAfks();
    this.bufferReplayMoves();
    this.processReplayChat();
    this.update(true);
    this.processReplayGeneralTrades();

    if (typeof this.map.computeVisibility === 'function') {
      this.rawVisible = this.map.computeVisibility(this.lights, this.cities, this.generals, this.turn);
    }

    const winners = this.isOver();
    if (winners) {
      this.onReplayGameWon(winners);
    }

    this.onReplayTurnAdvanced(no_visible_update);
  }

  processReplayAfks() {
    while (this.gameReplay.afks.length > this.currentAFKIndex && this.gameReplay.afks[this.currentAFKIndex].turn <= this.turn) {
      const afk = this.gameReplay.afks[this.currentAFKIndex++];
      const index = afk.index;
      if (this.isDead(this.sockets[index])) {
        this.tryNeutralizePlayer(index);
        this.onReplayAfkNeutralized(index);
      } else {
        this.killPlayer(this.sockets[index]);
        this.onReplayPlayerSurrender(index);
      }
    }
  }

  bufferReplayMoves() {
    while (this.gameReplay.moves.length > this.currentMoveIndex && this.gameReplay.moves[this.currentMoveIndex].turn <= this.turn) {
      const move = this.gameReplay.moves[this.currentMoveIndex++];
      this.inputBuffer[move.index].push([move.start, move.end, move.is50, this.currentMoveIndex - 1]);
    }
  }

  processReplayChat() {
    if (!this.options.chat_present) {
      return;
    }

    while (this.gameReplay.chat.length > this.currentChatIndex && this.gameReplay.chat[this.currentChatIndex].turn <= this.turn + 1) {
      const chat = this.gameReplay.chat[this.currentChatIndex++];
      this.onReplayRecordedChatMessage({
        username: this.gameReplay.usernames[chat.playerIndex],
        text: chat.text,
        prefix: chat.prefix,
        playerIndex: chat.playerIndex,
        playerColor: this.gameReplay.playerColors[chat.playerIndex],
        turn: chat.turn,
      });
    }
  }

  processReplayGeneralTrades() {
    if (!this.options.general_trade_events_present) {
      return;
    }

    while (this.gameReplay.generalTrades.length > this.currentGeneralTradeIndex
      && this.gameReplay.generalTrades[this.currentGeneralTradeIndex].turn <= this.turn) {
      const trade = this.gameReplay.generalTrades[this.currentGeneralTradeIndex++];
      this.onReplayGeneralTrade(trade);
    }
  }

  onReplayPlayerSurrender() {}

  onReplayRecordedChatMessage() {}

  onReplayGeneralTrade() {}

  onReplayAfkNeutralized() {}

  onReplaySystemMessage() {}

  onReplayGameWon(winners) {
    const usernames = winners.reduce((str, socket, i) => (i === winners.length - 1 ? str + socket.gio_username : str + socket.gio_username + ', '), '');
    const isTeam = hasDuplicate(this.teams);
    const multiText = ['The team with ['];
    const multiColors = [null];

    if (isTeam) {
      for (let i = 0; i < winners.length; i++) {
        multiText.push(winners[i].gio_username);
        multiColors.push(winners[i].gio_playerColor);
        if (winners.length - 1 !== i) {
          multiText.push(', ');
          multiColors.push(null);
        }
      }
      multiText.push('] wins!');
      multiColors.push(null);
    }

    this.onReplaySystemMessage({
      text: isTeam ? 'The team with [' + usernames + '] wins!' : usernames + ' wins!',
      playerColor: winners[0].gio_playerColor,
      multiText: isTeam ? multiText : null,
      multiColors: isTeam ? multiColors : null,
      turn: this.turn,
    }, { type: 'win', winners });
  }

  onReplayTurnAdvanced() {}

  isDead(socket) {
    return !!socket.dead;
  }

  killPlayer(socket) {
    if (this.isDead(socket)) {
      return;
    }

    this.deaths.push(socket);
    socket.dead = true;
    this.clearMoves(socket.id);
    this.alivePlayers--;
    this.winners = undefined;
  }

  clearMoves(socket_id) {
    const index = this.indexOfSocketID(socket_id);
    if (index < 0) {
      return;
    }
    this.inputBuffer[index] = [];
  }

  indexOfSocketID(socket_id) {
    for (let i = 0; i < this.sockets.length; i++) {
      if (this.sockets[i].id === socket_id) {
        return i;
      }
    }
    return -1;
  }

  handleCityTick() {
    for (let i = 0; i < this.cities.length; i++) {
      if (this.map.tileAt(this.cities[i]) >= 0 || (this.options.city_regen && this.map.armyAt(this.cities[i]) < Constants.MIN_CITY_ARMY)) {
        this.map.incrementArmyAt(this.cities[i]);
      }
    }
  }

  handleSwampTick() {
    for (let i = 0; i < this.swamps.length; i++) {
      if (this.map.tileAt(this.swamps[i]) >= 0) {
        this.map.decrementArmyAt(this.swamps[i]);
      }
    }
  }

  getPlayerMovesPriorityV1() {
    const moves = [];
    let playerSocketIdx;
    for (let sock = 0; sock < this.sockets.length; sock++) {
      if (this.options.priority_cycle) {
        playerSocketIdx = (sock + this.turn) % this.sockets.length;
      } else if (this.options.priority_reversed) {
        playerSocketIdx = this.sockets.length - 1 - sock;
      } else {
        playerSocketIdx = sock;
      }

      while (this.inputBuffer[playerSocketIdx].length) {
        const [start, end, is50, attackIndex] = this.inputBuffer[playerSocketIdx].splice(0, 1)[0];
        if (this.checkAttackValidAndIncrementAttackIndex(playerSocketIdx, start, end, is50, attackIndex)) {
          moves.push({ playerIndex: playerSocketIdx, start, end, is50, attackIndex });
          break;
        }
      }
    }

    return moves;
  }

  getPlayerMovesPriorityV2() {
    const moves = [];
    for (let sock = 0; sock < this.sockets.length; sock++) {
      const playerSocketIdx = (this.turn & 1) === 0 ? sock : this.sockets.length - 1 - sock;
      while (this.inputBuffer[playerSocketIdx].length) {
        const [start, end, is50, attackIndex] = this.inputBuffer[playerSocketIdx].splice(0, 1)[0];
        const isValid = this.checkAttackValidAndIncrementAttackIndex(playerSocketIdx, start, end, is50, attackIndex);
        if (isValid) {
          moves.push({ playerIndex: playerSocketIdx, start, end, is50, attackIndex });
          break;
        }
      }
    }

    return moves;
  }

  getPlayerMovesPriorityV3() {
    const moves = this.getPlayerMovesPriorityV2(true);
    const movesFinal = this.moveResolver.determineMoveOrder(moves);
    for (const move of movesFinal) {
      this.attackIndices[move.playerIndex] = Math.max(this.attackIndices[move.playerIndex], move.attackIndex);
    }
    return movesFinal;
  }

  update(no_game_update = true) {
    let anyMove = false;
    const moves = this.getNextValidSetOfMovesPrioritized();
    const defection = this.map.modFlags && this.map.modFlags[Constants.MODIFIER_INDEXES.Defection];
    const defectionCredit = defection ? this.sockets.map(() => 0) : null;
    const consumedMoveIndices = new Set();

    for (let i = 0; i < moves.length; i++) {
      if (consumedMoveIndices.has(i)) {
        continue;
      }

      const move = moves[i];
      const pI = move.playerIndex;
      if (pI !== this.map.tileAt(move.start)) {
        this.attackIndices[pI] = Math.max(this.attackIndices[pI], move.attackIndex);
        continue;
      }

      const mutualGeneralSwapMoveIndex = this.getMutualGeneralSwapMoveIndex(moves, i, consumedMoveIndices);
      if (mutualGeneralSwapMoveIndex !== -1) {
        const mutualSwapMove = moves[mutualGeneralSwapMoveIndex];
        const pJ = mutualSwapMove.playerIndex;
        this.executeMutualGeneralSwap(pI, pJ, move, mutualSwapMove);
        consumedMoveIndices.add(mutualGeneralSwapMoveIndex);
        anyMove = true;
        this.sockets[pI].moveCount += 1;
        this.sockets[pI].lastMoveTurn = this.turn;
        this.sockets[pJ].moveCount += 1;
        this.sockets[pJ].lastMoveTurn = this.turn;
        continue;
      }

      if (defection) {
        for (let j = i + 1; j < moves.length; j++) {
          const moveJ = moves[j];
          if (move.start === moveJ.end && move.end === moveJ.start
            && this.map.tileAt(moveJ.start) === moveJ.playerIndex
            && (!this.map.teams || this.map.teams[moveJ.playerIndex] !== this.map.teams[pI])) {
            const pJ = moveJ.playerIndex;
            const reserve = move.is50 ? Math.ceil(this.map.armyAt(move.start) / 2) : 1;
            const sentArmy = this.map.armyAt(move.start) - reserve;
            const receivedArmy = this.map.armyAt(move.end) - 1;
            defectionCredit[pJ] = Math.max(defectionCredit[pJ], Math.min(sentArmy, receivedArmy));
            break;
          }
        }

        for (let j = 0; j < i; j++) {
          if (move.end === moves[j].end && this.map.tileAt(moves[j].end) === moves[j].playerIndex
            && (!this.teams || this.teams[moves[j].playerIndex] !== this.teams[pI])) {
            const pJ = moves[j].playerIndex;
            const reserve = move.is50 ? Math.ceil(this.map.armyAt(move.start) / 2) : 1;
            const sentArmy = this.map.armyAt(move.start) - reserve;
            const receivedArmy = this.map.armyAt(move.end) - 1;
            defectionCredit[pJ] = Math.max(defectionCredit[pJ], Math.min(sentArmy, receivedArmy));
          }
        }
      }

      anyMove |= this.handleAttack(pI, move.start, move.end, move.is50, move.attackIndex);
      anyMove = true;
      this.sockets[pI].moveCount += 1;
      this.sockets[pI].lastMoveTurn = this.turn;
    }

    if (defection) {
      for (let i = 0; i < defectionCredit.length; i++) {
        if (defectionCredit[i] > 0 && this.generals[i] >= 0) {
          const newArmy = this.map.armyAt(this.generals[i]) + defectionCredit[i];
          this.map.setArmy(this.generals[i], newArmy);
          this.notifyDefectionArmy(this.turn, i, defectionCredit[i]);
        }
      }
    }

    const hasRunTooLong = this.turn > Constants.MAX_GAME_MOVES_AT_NORMAL_SPEED;
    if (!anyMove || hasRunTooLong) {
      this.updatesSinceLastMove++;
      if (this.updatesSinceLastMove > Constants.MAX_GAME_ALL_PLAYERS_AFK_MOVES_AT_NORMAL_SPEED || hasRunTooLong) {
        this._killAllButLastPlayerLargestToSmallest();
      }
    } else {
      this.updatesSinceLastMove = 0;
    }

    this.turn++;

    if (this.turn % Constants.RECRUIT_RATE === 0) {
      for (let playerSocketIdx = 0; playerSocketIdx < this.generals.length; playerSocketIdx++) {
        this.map.incrementArmyAt(this.generals[playerSocketIdx]);
      }
      this.handleCityTick();
      this.handleSwampTick();
    }

    if (this.turn % Constants.FARM_RATE === 0) {
      const size = this.map.size();
      for (let playerSocketIdx = 0; playerSocketIdx < size; playerSocketIdx++) {
        if (this.map.tileAt(playerSocketIdx) >= 0) {
          this.map.incrementArmyAt(playerSocketIdx);
        }
      }

      for (let playerSocketIdx = 0; playerSocketIdx < this.deserts.length; playerSocketIdx++) {
        const idx = this.deserts[playerSocketIdx];
        if (this.map.tileAt(idx) >= 0) {
          this.map.decrementArmyAt(idx);
        }
      }
    }

    this.recalculateScores();
    return no_game_update;
  }

  _killAllButLastPlayerLargestToSmallest() {
    const playerScores = [];
    for (let sock = 0; sock < this.sockets.length; sock++) {
      const socket = this.sockets[sock];
      if (!this.isDead(socket)) {
        playerScores.push({ index: sock, score: this.scores[sock], playerSocket: socket });
      }
    }

    playerScores.sort((a, b) => {
      let diff = a.score.total - b.score.total;
      if (diff !== 0) {
        return diff;
      }
      diff = a.score.tiles - b.score.tiles;
      if (diff === 0) {
        diff = a.index - b.index;
      }
      return diff;
    });

    for (let i = 0; i < playerScores.length - 1; i++) {
      this.killPlayer(playerScores[i].playerSocket);
    }
  }

  isOver() {
    if (this.winners) return this.winners;
    if (!this.teams && this.alivePlayers === 1) {
      for (let i = 0; i < this.generals.length; i++) {
        if (!this.isDead(this.sockets[i])) {
          this.winners = [this.sockets[i]];
          return this.winners;
        }
      }
    } else if (this.teams) {
      let winningTeam = undefined;
      for (let i = 0; i < this.generals.length; i++) {
        if (!this.isDead(this.sockets[i])) {
          if (winningTeam === undefined) {
            winningTeam = this.teams[i];
          } else if (this.teams[i] !== winningTeam) {
            return undefined;
          }
        }
      }
      if (winningTeam !== undefined) {
        this.winners = this.sockets.filter((s, i) => this.teams[i] === winningTeam);
        return this.winners;
      }
    }
    return undefined;
  }

  recalculateScores() {
    for (let i = 0; i < this.sockets.length; i++) {
      this.scores[i].i = i;
      this.scores[i].color = this.sockets[i].gio_playerColor;
      this.scores[i].total = 0;
      this.scores[i].tiles = 0;
      this.scores[i].dead = this.sockets[i].dead;
      this.scores[i].has_kill = this.capturedPlayers[i] && this.capturedPlayers[i].length > 0;
      delete this.scores[i].neutralize_in;
      delete this.scores[i].warn_afk;
    }

    for (let i = 0; i < this.map.size(); i++) {
      const tile = this.map._map[i];
      if (tile >= 0) {
        this.scores[tile].total += this.map._armies[i];
        this.scores[tile].tiles++;
      }
    }

    this.leaderboardScores = this.scores.map((score) => Object.assign({}, score));
    this.leaderboardScores.sort((a, b) => this.lbSort(a, b));
  }

  lbSort(a, b) {
    if (a.has_kill !== b.has_kill) return a.has_kill ? -1 : 1;
    if (a.dead && !b.dead) return 1;
    if (b.dead && !a.dead) return -1;
    if (a.dead && b.dead) {
      return this.deaths.indexOf(this.sockets[b.i]) - this.deaths.indexOf(this.sockets[a.i]);
    }
    if (b.total !== a.total) return b.total - a.total;
    if (b.tiles !== a.tiles) return b.tiles - a.tiles;
    return a.i - b.i;
  }

  checkAttackValid(index, start, end) {
    if (this.isDead(this.sockets[index])) {
      return false;
    }
    if (this.map.tileAt(start) !== index) {
      return false;
    }
    if (this.map.armyAt(start) <= 0) {
      return false;
    }
    if (this.map.armyAt(start) === 1 && (!this.teams || this.teams[index] !== this.teams[this.map.tileAt(end)] || this.map.tileAt(end) === index)) {
      return false;
    }
    return this.map.isValidMove(start, end);
  }

  checkAttackValidAndIncrementAttackIndex(index, start, end, is50, attackIndex) {
    this.attackIndices[index] = Math.max(this.attackIndices[index], attackIndex);
    return this.checkAttackValid(index, start, end);
  }

  handleAttack(index, start, end, is50, attackIndex) {
    this.attackIndices[index] = Math.max(this.attackIndices[index], attackIndex);
    if (this.map._map[start] !== index) {
      return false;
    }

    const oldEndPlayer = this.map.tileAt(end);
    const startArmyBefore = this.map.armyAt(start);
    const endArmyBefore = this.map.armyAt(end);
    const succeeded = this.map.attack(start, end, is50, this.generals);
    if (!succeeded) {
      return false;
    }

    const newEndPlayer = this.map.tileAt(end);
    const wasCapture = newEndPlayer !== oldEndPlayer;
    const startArmyAfter = this.map.armyAt(start);
    const endArmyAfter = this.map.armyAt(end);
    const annihilated = (startArmyBefore + endArmyBefore - startArmyAfter - endArmyAfter) >>> 1;

    if (this.map.modFlags && this.map.modFlags[Constants.MODIFIER_INDEXES.Defection]
      && annihilated > 0
      && this.map.teams
      && this.map.teams[index] !== this.map.teams[oldEndPlayer]) {
      if (oldEndPlayer >= 0) {
        const newArmy = this.map.armyAt(this.generals[index]) + annihilated;
        this.notifyDefectionArmy(this.turn, index, annihilated);
        this.map.setArmy(this.generals[index], newArmy);
      }
    }

    if (oldEndPlayer >= 0 && wasCapture && this.generals[oldEndPlayer] === end && oldEndPlayer !== newEndPlayer) {
      this.executePlayerCapture(oldEndPlayer, newEndPlayer, end);
    }

    if (annihilated > 0 && oldEndPlayer >= 0) {
      this.annihilatedArmyAgainstPlayers[index][oldEndPlayer] += annihilated;
    }

    return true;
  }

  wouldAttackCaptureGeneral(start, end, is50, defenderMove = null) {
    const attackerIndex = this.map.tileAt(start);
    const defenderIndex = this.map.tileAt(end);
    if (attackerIndex < 0 || defenderIndex < 0 || attackerIndex === defenderIndex) {
      return false;
    }
    if (this.generals[defenderIndex] !== end) {
      return false;
    }
    if (this.teams && this.teams[attackerIndex] === this.teams[defenderIndex]) {
      return false;
    }

    const reserve = is50 ? Math.ceil(this.map.armyAt(start) / 2) : 1;
    const sentArmy = this.map.armyAt(start) - reserve;
    if (sentArmy <= 0) {
      return false;
    }

    if (this.map.modFlags && this.map.modFlags[Constants.MODIFIER_INDEXES.Defenseless]) {
      return true;
    }

    let defenderArmyAfterMove = this.map.armyAt(end);
    if (defenderMove && defenderMove.start === end) {
      defenderArmyAfterMove = defenderMove.is50 ? Math.ceil(this.map.armyAt(end) / 2) : 1;
    }

    return sentArmy > defenderArmyAfterMove;
  }

  getMutualGeneralSwapMoveIndex(moves, moveIndex, consumedMoveIndices) {
    const move = moves[moveIndex];
    const playerIndex = move.playerIndex;
    const opponentIndex = this.map.tileAt(move.end);
    const playerGeneral = this.generals[playerIndex];
    const opponentGeneral = opponentIndex >= 0 ? this.generals[opponentIndex] : -1;

    if (opponentIndex < 0 || opponentIndex === playerIndex) {
      return -1;
    }
    if (opponentGeneral !== move.end) {
      return -1;
    }
    if (!this.checkAttackValid(playerIndex, move.start, move.end)) {
      return -1;
    }

    for (let j = moveIndex + 1; j < moves.length; j++) {
      if (consumedMoveIndices.has(j)) {
        continue;
      }
      const oppositeMove = moves[j];
      if (oppositeMove.playerIndex !== opponentIndex) {
        continue;
      }
      if (oppositeMove.end !== playerGeneral) {
        continue;
      }
      if (!this.checkAttackValid(opponentIndex, oppositeMove.start, oppositeMove.end)) {
        continue;
      }

      const firstWouldCapture = this.wouldAttackCaptureGeneral(move.start, move.end, move.is50, oppositeMove);
      const secondWouldCapture = this.wouldAttackCaptureGeneral(oppositeMove.start, oppositeMove.end, oppositeMove.is50, move);
      if (!firstWouldCapture || !secondWouldCapture) {
        continue;
      }
      return j;
    }

    return -1;
  }

  executeMutualGeneralSwap(playerIndexA, playerIndexB, moveA, moveB) {
    const generalA = this.generals[playerIndexA];
    const generalB = this.generals[playerIndexB];
    const tradeMoveA = moveA && moveA.playerIndex === playerIndexA ? moveA : moveB;
    const tradeMoveB = moveB && moveB.playerIndex === playerIndexB ? moveB : moveA;
    if (!tradeMoveA || !tradeMoveB) {
      return;
    }

    const startA = tradeMoveA.start;
    const startB = tradeMoveB.start;
    const reserveA = tradeMoveA.is50 ? Math.ceil(this.map.armyAt(startA) / 2) : 1;
    const reserveB = tradeMoveB.is50 ? Math.ceil(this.map.armyAt(startB) / 2) : 1;
    const sentArmyA = this.map.armyAt(startA) - reserveA;
    const sentArmyB = this.map.armyAt(startB) - reserveB;
    const defenseArmyAtGeneralB = tradeMoveB.start === generalB ? (tradeMoveB.is50 ? Math.ceil(this.map.armyAt(generalB) / 2) : 1) : this.map.armyAt(generalB);
    const defenseArmyAtGeneralA = tradeMoveA.start === generalA ? (tradeMoveA.is50 ? Math.ceil(this.map.armyAt(generalA) / 2) : 1) : this.map.armyAt(generalA);
    const capturedGeneralArmyB = Math.max(0, sentArmyA - defenseArmyAtGeneralB);
    const capturedGeneralArmyA = Math.max(0, sentArmyB - defenseArmyAtGeneralA);
    const postAttackArmyOverrides = {};

    if (startA !== generalA && startA !== generalB) {
      postAttackArmyOverrides[startA] = reserveA;
    }
    if (startB !== generalA && startB !== generalB) {
      postAttackArmyOverrides[startB] = reserveB;
    }

    const mapSize = this.map.size();
    for (let i = 0; i < mapSize; i++) {
      const owner = this.map.tileAt(i);
      if (owner !== playerIndexA && owner !== playerIndexB) {
        continue;
      }
      if (i === generalA || i === generalB) {
        continue;
      }

      const army = Object.prototype.hasOwnProperty.call(postAttackArmyOverrides, i) ? postAttackArmyOverrides[i] : this.map.armyAt(i);
      const halvedArmy = Math.round(army * 0.5);
      if (owner === playerIndexA) {
        this.map.setTile(i, playerIndexB);
      } else {
        this.map.setTile(i, playerIndexA);
      }
      this.map.setArmy(i, halvedArmy);
    }

    this.map.setTile(generalA, playerIndexB);
    this.map.setArmy(generalA, capturedGeneralArmyA);
    this.map.setTile(generalB, playerIndexA);
    this.map.setArmy(generalB, capturedGeneralArmyB);
    this.generals[playerIndexA] = generalB;
    this.generals[playerIndexB] = generalA;

    const shouldEmitTradeMessage = !this.options.general_trade_events_present;
    if (shouldEmitTradeMessage) {
      this.onReplaySystemMessage(this.buildGeneralTradeMessage(playerIndexA, playerIndexB), {
        type: 'general_trade',
        playerIndexA,
        playerIndexB,
      });
    }
  }

  buildGeneralTradeMessage(playerIndexA, playerIndexB, turn = this.turn) {
    const socketA = this.sockets[playerIndexA];
    const socketB = this.sockets[playerIndexB];
    if (this.type !== GAME_TYPES.REPLAY && this.options.modifiers.includes(Constants.MODIFIER_INDEXES.SilentWar)) {
      return {
        text: 'Two players traded generals.',
        turn,
        eventType: 'general_trade',
      };
    }

    return {
      text: `${socketA.gio_username} and ${socketB.gio_username} traded generals.`,
      multiText: [socketA.gio_username, ' and ', socketB.gio_username, ' traded generals.'],
      multiColors: [socketA.gio_playerColor, null, socketB.gio_playerColor, null],
      turn,
      eventType: 'general_trade',
    };
  }

  executePlayerCapture(deadPlayerIndex, capturedByPlayerIndex, end) {
    this.map.replaceAll(deadPlayerIndex, capturedByPlayerIndex, 0.5);
    this.captures[capturedByPlayerIndex] += 1 + this.captures[deadPlayerIndex];
    if (capturedByPlayerIndex >= 0) {
      this.capturedPlayers[capturedByPlayerIndex].push(deadPlayerIndex);
    }

    const deadSocket = this.sockets[deadPlayerIndex];
    if (!this.isDead(deadSocket)) {
      this.killPlayer(deadSocket);
      deadSocket.emit('game_lost', { killer: capturedByPlayerIndex });
    }

    if (this.options.modifiers.includes(Constants.MODIFIER_INDEXES.Leapfrog)) {
      this.cities.push(this.generals[capturedByPlayerIndex]);
      this.citySet.add(this.generals[capturedByPlayerIndex]);
      this.generals[capturedByPlayerIndex] = this.generals[deadPlayerIndex];
    } else {
      this.cities.push(end);
      this.citySet.add(end);
    }
    this.generals[deadPlayerIndex] = DEAD_GENERAL;

    let message = {
      text: `${this.sockets[capturedByPlayerIndex].gio_username} captured ${this.sockets[deadPlayerIndex].gio_username}.`,
      multiText: [this.sockets[capturedByPlayerIndex].gio_username, ' captured ', this.sockets[deadPlayerIndex].gio_username, '.'],
      multiColors: [this.sockets[capturedByPlayerIndex].gio_playerColor, null, deadSocket.gio_playerColor, null],
      turn: this.turn,
    };

    if (this.type !== GAME_TYPES.REPLAY && this.options.modifiers.includes(Constants.MODIFIER_INDEXES.SilentWar)) {
      message = {
        text: `Someone captured ${this.sockets[deadPlayerIndex].gio_username}.`,
        multiText: ['Someone captured ', this.sockets[deadPlayerIndex].gio_username, '.'],
        multiColors: [null, deadSocket.gio_playerColor, null],
        turn: this.turn,
      };
    }

    this.onReplaySystemMessage(message, {
      type: 'capture',
      deadPlayerIndex,
      capturedByPlayerIndex,
    });
  }

  notifyDefectionArmy() {}

  getNextLivingTeammateIndex(index) {
    if (this.teams) {
      for (let i = 0; i < this.sockets.length; i++) {
        if (i === index) continue;
        if (this.teams[i] === this.teams[index] && !this.isDead(this.sockets[i])) {
          return i;
        }
      }
    }
    return Map.TILE_EMPTY;
  }

  tryNeutralizePlayer(playerIndex) {
    const deadGeneralIndex = this.generals[playerIndex];
    this.generals[playerIndex] = DEAD_GENERAL;
    const newIndex = this.getNextLivingTeammateIndex(playerIndex);
    if (this.map.tileAt(deadGeneralIndex) !== playerIndex) {
      return;
    }
    this.map.replaceAll(playerIndex, newIndex);
    this.cities.push(deadGeneralIndex);
    this.citySet.add(deadGeneralIndex);
  }
}

ReplaySimulationCore.DEAD_GENERAL = DEAD_GENERAL;
ReplaySimulationCore.GAME_TYPES = GAME_TYPES;
ReplaySimulationCore.createReplayOptions = createReplayOptions;
ReplaySimulationCore.createReplaySockets = createReplaySockets;

module.exports = ReplaySimulationCore;
