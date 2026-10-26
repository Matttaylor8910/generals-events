'use strict';

// Standalone regression tests for the canonical MoveResolver, which the
// events package now hosts for both the live game and the replay
// simulator. Runs with plain `node` - no main-repo imports and no global
// logger, matching how the simulator runs inside cloud functions.

const assert = require('assert');
const Constants = require('./Constants');
const MoveResolver = require('./MoveResolver');

// 4x5 board. Players 0..3 hold a 4-cycle over adjacent tiles
// (0->1->5->4->0), each with 10 armies; player 4 has an independent
// 2-army move 10->11 (the smallest army that can legally move; still
// below the cycle armies). Generals sit unrelated at 12..16 so nothing
// in the fixture is a general attack. Teams are unique per player.
const GENERALS = [12, 13, 14, 15, 16];
const WIDTH = 4;
const HEIGHT = 5;

function makeMap(slippery) {
  const tiles = new Array(WIDTH * HEIGHT).fill(-1);
  const armies = new Array(WIDTH * HEIGHT).fill(0);
  tiles[0] = 0;
  tiles[1] = 1;
  tiles[5] = 2;
  tiles[4] = 3;
  armies[0] = armies[1] = armies[5] = armies[4] = 10;
  tiles[10] = 4;
  armies[10] = 2;
  for (let i = 0; i < GENERALS.length; i++) {
    tiles[GENERALS[i]] = i;
    armies[GENERALS[i]] = 1;
  }
  const modFlags = new Array(12).fill(false);
  modFlags[Constants.MODIFIER_INDEXES.Slippery] = slippery;
  return {
    teams: [0, 1, 2, 3, 4],
    modFlags,
    tileAt(index) {
      return tiles[index] === undefined ? -1 : tiles[index];
    },
    armyAt(index) {
      return armies[index] === undefined ? 0 : armies[index];
    },
  };
}

function cycleMoves() {
  return [
    {playerIndex: 0, start: 0, end: 1, is50: false, attackIndex: 0},
    {playerIndex: 1, start: 1, end: 5, is50: false, attackIndex: 0},
    {playerIndex: 2, start: 5, end: 4, is50: false, attackIndex: 0},
    {playerIndex: 3, start: 4, end: 0, is50: false, attackIndex: 0},
  ];
}

function cyclePlusIndependentMoves() {
  return cycleMoves().concat([
    {playerIndex: 4, start: 10, end: 11, is50: false, attackIndex: 0},
  ]);
}

function resolve(slippery, moves, installLogger) {
  const hadLogger =
      Object.prototype.hasOwnProperty.call(global, 'logger');
  const savedLogger = global.logger;
  if (installLogger) {
    global.logger = installLogger;
  } else {
    delete global.logger;
  }
  try {
    const resolver = new MoveResolver();
    resolver.setMap(makeMap(slippery), GENERALS);
    return resolver.determineMoveOrder(moves);
  } finally {
    if (hadLogger) {
      global.logger = savedLogger;
    } else {
      delete global.logger;
    }
  }
}

function assertWholeMoves(moves, ordered, message) {
  assert.strictEqual(ordered.length, moves.length, message);
  for (const move of moves) {
    assert.strictEqual(
        ordered.filter(out => out === move).length, 1,
        `${message}: every input move must appear exactly once`);
  }
}

function testNormalCycleOrdering() {
  // pure 4-cycle: the cycle break takes the highest-priority move first,
  // then the rest unwind in input order
  const moves = cycleMoves();
  const ordered = resolve(false, moves, null);
  assert.deepStrictEqual(ordered.map(mv => mv.playerIndex),
      [0, 1, 2, 3], 'normal pure cycle order');
  assertWholeMoves(moves, ordered, 'normal pure cycle');

  // with the independent smaller move last in sort order, it resolves
  // first (no dependencies), then the cycle breaks the same way; the
  // already-resolved null slot must not crash the diagnostic path
  const moves5 = cyclePlusIndependentMoves();
  const ordered5 = resolve(false, moves5, null);
  assert.deepStrictEqual(ordered5.map(mv => mv.playerIndex),
      [4, 0, 1, 2, 3], 'normal cycle + independent order');
  assertWholeMoves(moves5, ordered5, 'normal cycle + independent');
  console.log('  normal ordering passed');
}

function testSlipperyCycleOrdering() {
  // under Slippery the dependency direction flips: breaking the cycle at
  // the highest-priority move unblocks the move INTO its source first,
  // so the cycle unwinds backwards
  const moves = cycleMoves();
  const ordered = resolve(true, moves, null);
  assert.deepStrictEqual(ordered.map(mv => mv.playerIndex),
      [0, 3, 2, 1], 'slippery pure cycle order');
  assertWholeMoves(moves, ordered, 'slippery pure cycle');

  const moves5 = cyclePlusIndependentMoves();
  const ordered5 = resolve(true, moves5, null);
  assert.deepStrictEqual(ordered5.map(mv => mv.playerIndex),
      [4, 0, 3, 2, 1], 'slippery cycle + independent order');
  assertWholeMoves(moves5, ordered5, 'slippery cycle + independent');
  console.log('  slippery ordering passed');
}

function testDiagnosticsWithLogger() {
  const calls = [];
  const stubLogger = {
    info: (...args) => calls.push(args.map(String).join(' ')),
  };

  const ordered = resolve(false, cyclePlusIndependentMoves(), stubLogger);
  assert.deepStrictEqual(ordered.map(mv => mv.playerIndex),
      [4, 0, 1, 2, 3], 'ordering is unchanged with a logger installed');

  const cycleLog = calls.find(line =>
      line.startsWith('Breaking cycle with highest priority move'));
  assert.ok(cycleLog, 'cycle-break diagnostic must be logged');
  for (const token of ['0 0(', '1 1(', '2 5(', '3 4(']) {
    assert.ok(cycleLog.includes(token),
        `unresolved cycle move ${token} must be listed; got: ${cycleLog}`);
  }
  assert.ok(!cycleLog.includes('4 10('),
      'cycle diagnostic must not deref/list the already-resolved ' +
      `player 4 move; got: ${cycleLog}`);
  console.log('  diagnostic logging passed');
}

function testDiagnosticsWithoutLogger() {
  // no global logger at all: ordering must be identical and nothing may
  // throw even though the diagnostic retry pass still runs
  const ordered = resolve(false, cyclePlusIndependentMoves(), null);
  assert.deepStrictEqual(ordered.map(mv => mv.playerIndex),
      [4, 0, 1, 2, 3], 'ordering is unchanged without a logger');
  assert.strictEqual(
      Object.prototype.hasOwnProperty.call(global, 'logger'), false,
      'logger global must be restored/absent after the call');
  console.log('  no-logger path passed');
}

function run() {
  testNormalCycleOrdering();
  testSlipperyCycleOrdering();
  testDiagnosticsWithLogger();
  testDiagnosticsWithoutLogger();
  console.log('MoveResolver regression tests passed');
}

run();
