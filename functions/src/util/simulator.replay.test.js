'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Constants = require('./Constants');
const deserializeReplay = require('./ReplayDeserializer');
const simulator = require('./simulator');

const TEST_REPLAY_DIR = path.resolve(__dirname, '../../../testReplays');

function loadReplay(filename) {
  const replayPath = path.join(TEST_REPLAY_DIR, filename);
  return deserializeReplay(fs.readFileSync(replayPath));
}

function getScore(result, name) {
  const score = result.scores.find((candidate) => candidate.name === name);
  assert.ok(score, `Expected score entry for ${name}`);
  return score;
}

function testGeneralTradeReplay() {
  const replay = loadReplay('EklipZAndAwerasdfTradeGeneralsThenAwerasdfKillsPiDayThenEklipZKillsAwerasdf.gior');
  assert.strictEqual(replay.generalTrades.length, 1);
  assert.deepStrictEqual(replay.generalTrades[0], {
    playerIndexA: 2,
    playerIndexB: 0,
    turn: 127,
  });

  const result = simulator.simulate(replay);

  assert.deepStrictEqual(result.summary, [
    'awerasdfaswefasdf killed Pi Day on turn 103',
    'EklipZ killed awerasdfaswefasdf on turn 123',
    'EklipZ wins!',
  ]);
  assert.strictEqual(result.turns, 123);

  const eklipz = getScore(result, 'EklipZ');
  assert.strictEqual(eklipz.kills, 1);
  assert.strictEqual(eklipz.rank, 1);
  assert.strictEqual(eklipz.points, 3);
  assert.strictEqual(eklipz.lastTurn, 123);
  assert.strictEqual(eklipz.tilesAfterFirstRound, 2);
  assert.deepStrictEqual(eklipz.killed, ['awerasdfaswefasdf']);
  assert.deepStrictEqual(eklipz.killedBy, []);

  const awer = getScore(result, 'awerasdfaswefasdf');
  assert.strictEqual(awer.kills, 1);
  assert.strictEqual(awer.rank, 2);
  assert.strictEqual(awer.points, 2);
  assert.strictEqual(awer.lastTurn, 123);
  assert.strictEqual(awer.tilesAfterFirstRound, 31);
  assert.deepStrictEqual(awer.killed, ['Pi Day']);
  assert.deepStrictEqual(awer.killedBy, ['EklipZ']);

  const piDay = getScore(result, 'Pi Day');
  assert.strictEqual(piDay.kills, 0);
  assert.strictEqual(piDay.rank, 3);
  assert.strictEqual(piDay.points, 0);
  assert.strictEqual(piDay.lastTurn, 103);
  assert.strictEqual(piDay.tilesAfterFirstRound, 2);
  assert.deepStrictEqual(piDay.killed, []);
  assert.deepStrictEqual(piDay.killedBy, ['awerasdfaswefasdf']);
}

function testTorusWrapKillReplay() {
  const replay = loadReplay('TorusWrapKillReplay.gior');
  assert.ok(replay.modifiers.includes(Constants.MODIFIER_INDEXES.Torus));

  const result = simulator.simulate(replay);

  assert.deepStrictEqual(result.summary, [
    'EklipZ killed Pi Day on turn 115',
    'EklipZ wins!',
  ]);
  assert.strictEqual(result.turns, 115);

  const eklipz = getScore(result, 'EklipZ');
  assert.strictEqual(eklipz.kills, 1);
  assert.strictEqual(eklipz.rank, 1);
  assert.strictEqual(eklipz.lastTurn, 115);
  assert.deepStrictEqual(eklipz.killed, ['Pi Day']);
  assert.deepStrictEqual(eklipz.killedBy, []);

  const piDay = getScore(result, 'Pi Day');
  assert.strictEqual(piDay.kills, 0);
  assert.strictEqual(piDay.rank, 2);
  assert.strictEqual(piDay.lastTurn, 115);
  assert.deepStrictEqual(piDay.killed, []);
  assert.deepStrictEqual(piDay.killedBy, ['EklipZ']);
}

function testFfaTournamentScoringReplay() {
  const replay = loadReplay('s8BsB7Tfg.gior');
  assert.strictEqual(replay.teams, null);
  assert.strictEqual(replay.generalTrades.length, 1);
  assert.deepStrictEqual(replay.generalTrades[0], {
    playerIndexA: 2,
    playerIndexB: 6,
    turn: 137,
  });

  const result = simulator.simulate(replay);

  assert.deepStrictEqual(result.summary, [
    'new art killed 3141592653589793pi on turn 60',
    'new art killed Decaffree on turn 73',
    'EklipZ killed vasi3 on turn 77',
    'I7199@ quit on turn 99',
    'new art killed I7199@ on turn 100',
    'new art killed syndicate on turn 169',
    'EklipZ killed new art on turn 182',
    'EklipZ wins!',
  ]);
  assert.strictEqual(result.turns, 182);

  const eklipz = getScore(result, 'EklipZ');
  assert.strictEqual(eklipz.kills, 2);
  assert.strictEqual(eklipz.rank, 1);
  assert.strictEqual(eklipz.points, 8);
  assert.strictEqual(eklipz.lastTurn, 182);
  assert.strictEqual(eklipz.tilesAfterFirstRound, 24);
  assert.deepStrictEqual(eklipz.killed, ['vasi3', 'new art']);
  assert.deepStrictEqual(eklipz.killedBy, []);

  const newArt = getScore(result, 'new art');
  assert.strictEqual(newArt.kills, 4);
  assert.strictEqual(newArt.rank, 2);
  assert.strictEqual(newArt.points, 9);
  assert.strictEqual(newArt.lastTurn, 182);
  assert.strictEqual(newArt.tilesAfterFirstRound, 18);
  assert.deepStrictEqual(newArt.killed, ['3141592653589793pi', 'Decaffree', 'I7199@', 'syndicate']);
  assert.deepStrictEqual(newArt.killedBy, ['EklipZ']);

  const syndicate = getScore(result, 'syndicate');
  assert.strictEqual(syndicate.kills, 0);
  assert.strictEqual(syndicate.rank, 3);
  assert.strictEqual(syndicate.points, 4);
  assert.strictEqual(syndicate.lastTurn, 169);
  assert.strictEqual(syndicate.tilesAfterFirstRound, 20);
  assert.deepStrictEqual(syndicate.killed, []);
  assert.deepStrictEqual(syndicate.killedBy, ['new art']);

  const i7199 = getScore(result, 'I7199@');
  assert.strictEqual(i7199.kills, 0);
  assert.strictEqual(i7199.rank, 4);
  assert.strictEqual(i7199.points, 3);
  assert.strictEqual(i7199.lastTurn, 99);
  assert.strictEqual(i7199.tilesAfterFirstRound, 15);
  assert.deepStrictEqual(i7199.killed, []);
  assert.deepStrictEqual(i7199.killedBy, []);

  const vasi3 = getScore(result, 'vasi3');
  assert.strictEqual(vasi3.kills, 0);
  assert.strictEqual(vasi3.rank, 5);
  assert.strictEqual(vasi3.points, 2);
  assert.strictEqual(vasi3.lastTurn, 77);
  assert.strictEqual(vasi3.tilesAfterFirstRound, 10);
  assert.deepStrictEqual(vasi3.killed, []);
  assert.deepStrictEqual(vasi3.killedBy, ['EklipZ']);

  const decaffree = getScore(result, 'Decaffree');
  assert.strictEqual(decaffree.kills, 0);
  assert.strictEqual(decaffree.rank, 6);
  assert.strictEqual(decaffree.points, 1);
  assert.strictEqual(decaffree.lastTurn, 73);
  assert.strictEqual(decaffree.tilesAfterFirstRound, 13);
  assert.deepStrictEqual(decaffree.killed, []);
  assert.deepStrictEqual(decaffree.killedBy, ['new art']);

  const pi = getScore(result, '3141592653589793pi');
  assert.strictEqual(pi.kills, 0);
  assert.strictEqual(pi.rank, 7);
  assert.strictEqual(pi.points, 0);
  assert.strictEqual(pi.lastTurn, 60);
  assert.strictEqual(pi.tilesAfterFirstRound, 19);
  assert.deepStrictEqual(pi.killed, []);
  assert.deepStrictEqual(pi.killedBy, ['new art']);
}

function run() {
  testGeneralTradeReplay();
  testTorusWrapKillReplay();
  testFfaTournamentScoringReplay();
  console.log('simulator replay regression tests passed');
}

run();
