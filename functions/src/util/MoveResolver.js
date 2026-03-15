const Constants = require('./Constants');

class MoveResolver {
  constructor() {
    this.map = null;
    this.teams = [];
    this.generals = [];
  }

  setMap(map, generals) {
    this.map = map;
    this.teams = map.teams;
    this.generals = generals;
    this.dependencyChecker = !map.modFlags[Constants.MODIFIER_INDEXES.Slippery]
      ? this.hasDependency
      : this.isDependency;

    if (!this.teams || this.teams.length !== this.generals.length) {
      this.teams = [];
      for (let i = 0; i < this.generals.length; i++) {
        this.teams.push(i + 1);
      }
      this.teams.push(-1);
    }
  }

  determineMoveOrder(moves) {
    if (!moves || moves.length === 0) return [];

    const outputMoves = [];
    const movesWithSortPrio = moves.map((move, i) => ({
      move,
      isDefensive: this.isDefensiveMove(move),
      isGeneralAttack: this.generals[this.map.tileAt(move.end)] === move.end,
      army: this.map.armyAt(move.start),
      basePriority: i,
    }));

    movesWithSortPrio.sort((a, b) => {
      if (a.isDefensive !== b.isDefensive) {
        return a.isDefensive ? -1 : 1;
      }

      if (a.isGeneralAttack !== b.isGeneralAttack) {
        return a.isGeneralAttack ? 1 : -1;
      }

      if (a.army !== b.army) {
        return b.army - a.army;
      }

      return a.basePriority - b.basePriority;
    });

    moves = movesWithSortPrio.map(({ move }) => move);

    let progress = true;
    let startIdx = 0;
    let endIdx = moves.length - 1;

    while (progress && startIdx <= endIdx) {
      progress = false;

      for (let i = startIdx; i <= endIdx; i++) {
        const remainingMove = moves[i];
        if (remainingMove === null) {
          if (i === startIdx) {
            startIdx++;
          } else if (i === endIdx) {
            endIdx--;
          }
          continue;
        }

        if (!this.dependencyChecker(remainingMove, moves, i, startIdx, endIdx)) {
          this.queueOutputMove(moves, outputMoves, remainingMove, i);
          if (i === startIdx) {
            startIdx++;
          } else if (i === endIdx) {
            endIdx--;
          }
          progress = true;
          break;
        }
      }

      if (!progress && startIdx <= endIdx) {
        const hiPriMove = moves[startIdx];
        this.queueOutputMove(moves, outputMoves, hiPriMove, startIdx);
        startIdx++;
        progress = startIdx !== endIdx;
      }
    }

    return outputMoves;
  }

  isDefensiveMove(move) {
    const playerIndex = move.playerIndex;
    const destinationOwner = this.map.tileAt(move.end);
    return this.teams[destinationOwner] === this.teams[playerIndex];
  }

  hasDependency(move, moves, moveIdx, startIdx, endIdx) {
    for (let i = startIdx; i <= endIdx; i++) {
      if (i === moveIdx) continue;
      const otherMove = moves[i];
      if (otherMove === null) continue;
      if (otherMove.end === move.start && otherMove.start !== move.end) {
        return true;
      }
    }

    return false;
  }

  isDependency(move, moves, moveIdx, startIdx, endIdx) {
    for (let i = startIdx; i <= endIdx; i++) {
      if (i === moveIdx) continue;
      const otherMove = moves[i];
      if (otherMove === null) continue;
      if (otherMove.start === move.end && otherMove.end !== move.start && this.generals[this.map.tileAt(otherMove.end)] !== move.end) {
        return true;
      }
    }

    return false;
  }

  queueOutputMove(remainingMoves, outputMoves, move, moveIndex) {
    if (outputMoves.find((mv) => mv.playerIndex === move.playerIndex)) {
      throw new Error('Player ' + move.playerIndex + ' has already moved');
    }

    outputMoves.push(move);
    remainingMoves[moveIndex] = null;
    return true;
  }
}

module.exports = MoveResolver;
