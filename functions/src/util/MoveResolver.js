const Constants = require('./Constants');

/**
 * MoveResolver
 *
 * Handles the new move queue priority system that:
 * 1. Prioritizes defensive moves (moving to friendly tiles)
 * 2. Resolves offensive move conflicts based on army size (largest army wins)
 * 3. Processes dependent moves (e.g., moving to a tile that another player is moving away from)
 *
 * This is the canonical implementation shared by the live game and the
 * replay simulator. The standalone events package has no global logger, so
 * diagnostics resolve the optional global per call and stay inert without
 * it; the retry pass itself still runs so ordering never depends on
 * logging being present.
 */
class MoveResolver {
  constructor() {
    /** @type {Terrain} */
    this.map = null;

    /** @type {number[]} */
    this.teams = [];

    /** @type {number[]} */
    this.generals = [];
  }

  /**
   * Set the map and generals for the resolver
   * @param {Terrain} map
   * @param {number[]} generals
   */
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

  /**
   * Process all moves from all players, respecting the priority system.
   * Accepts moves in their original "priority" order from previous priority implementation, as that is the final tiebreaker on move order.
   * @param {{playerIndex: number, start: number, end: number, is50: boolean, attackIndex: number}[]} moves
   * @returns {{playerIndex: number, start: number, end: number, is50: boolean, attackIndex: number}[]} the moves in the order we expect them to be executed.
   */
  determineMoveOrder(moves) {
    if (!moves || moves.length === 0) return [];

    // the events runtime has no global logger; resolve it per call so
    // diagnostics work wherever a logger happens to be installed
    const log = typeof logger === 'undefined' ? null : logger;

    /** @type {{playerIndex: number, start: number, end: number, is50: boolean, attackIndex: number}[]} */
    const outputMoves = [];
    // // Process defensive moves first (moving to friendly tiles)

    let logs = [];
    // const defensiveMoves = moves.filter(mv => this.isDefensiveMove(mv));

    const movesWithSortPrio = moves.map((mv, i) => ({
      move: mv,
      isDefensive: this.isDefensiveMove(mv),
      isGeneralAttack: this.generals[this.map.tileAt(mv.end)] === mv.end,
      army: this.map.armyAt(mv.start),
      basePriority: i,
    }));
    // logs.push(['Pre-sort', movesWithSortPrio.map(mv => `${mv.move.playerIndex} ${mv.move.start}->${mv.move.end}`).join(', ')]);

    movesWithSortPrio.sort((a, b) => {
      // Negative if a should come first
      if (a.isDefensive !== b.isDefensive)
        return a.isDefensive ? -1 : 1;

      if (a.isGeneralAttack !== b.isGeneralAttack)
        return a.isGeneralAttack ? 1 : -1;
        // return a.isGeneralAttack ? -1 : 1;

      if (a.army !== b.army) {
        return b.army - a.army;
        // // Friendly moves the smaller army moves first, for funsies
        // if (this.map.teams[a.move.playerIndex] !== this.map.teams[b.move.playerIndex]) {
        //   return b.army - a.army;
        // } else {
        //   return a.army - b.army;
        // }
      }

      return a.basePriority - b.basePriority;
    });

    if (log) {
      logs.push(['Post-sort', movesWithSortPrio.map(mv => `${mv.move.playerIndex} ${mv.move.start}->${mv.move.end}`).join(', ')]);
    }
    moves = movesWithSortPrio.map(mv => mv.move);

    // Now just apply moves in this order as long as they have no dependencies.

    // Third pass: Process remaining moves in dependency order
    // Keep processing until no more moves can be executed
    let progress = true;
    let redoAndLog = false;
    let startIdx = 0;
    let endIdx = moves.length - 1;

    // First pass: process dependencies
    while (progress && startIdx <= endIdx) {
      progress = false;

      for (let i = startIdx; i <= endIdx; i++) {
        const remainingMove = moves[i];
        if (remainingMove === null)
        {
          if (i === startIdx)
            startIdx++;
          else if (i === endIdx)
            endIdx--;
          continue;
        }

        // Check if this move can be executed (no dependency or dependency has been resolved)
        if (!this.dependencyChecker(remainingMove, moves, i, startIdx, endIdx)) {
          if (redoAndLog && log) log.info(`Move INCLUDED ${remainingMove.playerIndex} ${remainingMove.start}(p${this.map.tileAt(remainingMove.start)} a${this.map.armyAt(remainingMove.start)}) -> ${remainingMove.end}(p${this.map.tileAt(remainingMove.end)} a${this.map.armyAt(remainingMove.end)})`);
          this.queueOutputMove(moves, outputMoves, remainingMove, i);
          if (i === startIdx)
            startIdx++;
          else if (i === endIdx)
            endIdx--;
          progress = true;
          break;
        }
        else {
          if (redoAndLog && log) log.info(`Move ${remainingMove.playerIndex} has dependency on it at tile ${remainingMove.start}. ${remainingMove.playerIndex} ${remainingMove.start}(p${this.map.tileAt(remainingMove.start)} a${this.map.armyAt(remainingMove.start)}) -> ${remainingMove.end}(p${this.map.tileAt(remainingMove.end)} a${this.map.armyAt(remainingMove.end)})`);
        }
      }

      // If we couldn't process any move but still have moves, break a circular dependency
      if (!progress && startIdx <= endIdx) {
        if (!redoAndLog) {
          redoAndLog = true;
          progress = true;
          if (logs.length) {
            for (const logPack of logs) {
              log.info(...logPack);
            }
            logs = [];
          }

          continue;
        }

        redoAndLog = false;
        // break the cycle with the current highest priority move.
        // Resolved moves are null in `moves` - filter them out of the
        // diagnostic before reading their fields.
        if (log) {
          log.info('Breaking cycle with highest priority move', moves.filter(mv => mv !== null).map(mv => `${mv.playerIndex} ${mv.start}(p${this.map.tileAt(mv.start)} a${this.map.armyAt(mv.start)}) -> ${mv.end}(p${this.map.tileAt(mv.end)} a${this.map.armyAt(mv.end)})`));
        }
        const hiPriMove = moves[startIdx];
        this.queueOutputMove(moves, outputMoves, hiPriMove, startIdx);
        startIdx++;

        progress = startIdx !== endIdx;
      }
    }

    return outputMoves;
  }

  /**
   * Check if a move is defensive (moving to a friendly tile)
   * @param {{start: number, end: number, playerIndex: number}} move Move object
   * @returns {boolean} True if defensive move
   */
  isDefensiveMove(move) {
    const playerIndex = move.playerIndex;
    const destinationOwner = this.map.tileAt(move.end);

    return this.teams[destinationOwner] === this.teams[playerIndex];
  }

  /**
   * Check if a move has a dependency (moving to a tile owned by another player who is also moving)
   * @param {{start: number, end: number, playerIndex: number}} move Move object
   * @returns {boolean} True if the move has a dependency
   */
  hasDependency(move, moves, moveIdx, startIdx, endIdx) {
    // Check if anyone is targeting this moves source tile.
    for (let i = startIdx; i <= endIdx; i++) {
      if (i === moveIdx)
        continue;
      const otherMove = moves[i];
      if (otherMove === null)
        continue;
      if (otherMove.end === move.start && otherMove.start !== move.end)
        return true;
    }

    return false;
  }

  /**
   * Check if this move would cause other moves to have dependencies.
   * @param {{start: number, end: number, playerIndex: number}} move Move object
   * @returns {boolean} True if the move is a dependency
   */
  isDependency(move, moves, moveIdx, startIdx, endIdx) {
    // Check if we are moving to a tile that is being moved to

    for (let i = startIdx; i <= endIdx; i++) {
      if (i === moveIdx)
        continue;
      const otherMove = moves[i];
      if (otherMove === null)
        continue;
      if (otherMove.start === move.end && otherMove.end !== move.start && this.generals[this.map.tileAt(otherMove.end)] !== move.end)
        return true;
    }

    return false;
  }

  /**
   * Execute a move using the game's handleAttack method
   * @param {{start: number, end: number, playerIndex: number}} move Move object
   * @returns {boolean} True if the move was successful
   */
  queueOutputMove(remainingMoves, outputMoves, move, moveIndex) {
    // TODO remove
    if (outputMoves.find(mv => mv.playerIndex === move.playerIndex))
      throw Error('Player ' + move.playerIndex + ' has already moved');

    outputMoves.push(move);
    remainingMoves[moveIndex] = null;
    return true;
  }
}

module.exports = MoveResolver;
