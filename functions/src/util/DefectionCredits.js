'use strict';

// Defection collision counterpart credits (replay version >= 20 semantics).
//
// The pre-20 implementation speculatively scanned forward/backward through the
// resolver-ordered move list and granted Math.max credits guessed from army
// sizes before any move executed. That both missed credit for intents that
// later got invalidated (a source captured mid-turn by an earlier move) and
// invented credit from armies that never actually met (uncapped tunnel sends,
// garrison-1 estimates).
//
// This helper records each player's turn-selected intent (one move per player
// per turn) and lets handleAttack add ONLY the defending counterpart's credit
// when a real annihilation just happened: the defender gets the same actual
// `annihilated` amount the attacker was awarded iff its selected intent either
// arrives at the attacked tile (same-destination collision) or is the exact
// opposing cross (defender intended start -> attacker's start). Stationary
// defenders, chase garrisons and unrelated moves earn nothing. Credits are
// SUMMED across independent contacts in the turn (a player whose intent
// collides in two different battles collects both), awarded at end of turn to
// the recipient's CURRENT general.
//
// Team hostility and annihilated > 0 are already established by the caller;
// this helper must not recalculate annihilation from post-attack board state.

class DefectionCredits {
  /**
   * @param {Array<{playerIndex:number,start:number,end:number,is50:boolean}>} moves
   *        resolver-ordered turn-selected intents (at most one per player)
   * @param {number} playerCount
   */
  constructor(moves, playerCount) {
    this.movesByPlayer = new Map(moves.map(m => [m.playerIndex, m]));
    this.credits = Array(playerCount).fill(0);
  }

  /**
   * Awards the defender's counterpart credit for a just-resolved contact.
   * Called by handleAttack immediately after `annihilated` is computed and
   * before the attacker's own award/capture handling.
   */
  addCounterpart(attacker, start, end, defender, annihilated) {
    if (defender < 0 || defender === attacker || annihilated <= 0) return;
    const mv = this.movesByPlayer.get(defender);
    if (mv && (mv.end === end || (mv.start === end && mv.end === start))) {
      this.credits[defender] += annihilated;
    }
  }
}

// Replays at or above this serialized version used the intent-recording
// writer and must replay with these corrected credit semantics; older
// replays keep the legacy speculative forward/backward calculation so their
// historical outcomes are preserved bit-for-bit.
DefectionCredits.MODERN_REPLAY_VERSION = 20;

module.exports = DefectionCredits;
