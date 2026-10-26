'use strict';

// Canonical event game-option normalization for tournaments.
//
// The modifier registry mirrors generals.io shared/Constants.js exactly: ids
// 0..11, same names, same exclusion pairs. This file is plain JS so the
// vanilla-node simulator can require it; the Angular frontend consumes it via
// the typed bridge in ../../game-options.ts.

const Constants = require('./Constants');

const MODIFIERS = [
  {id: 0, name: 'Leapfrog', exclude: []},
  {id: 1, name: 'City-State', exclude: []},
  {id: 2, name: 'Misty Veil', exclude: [3]},
  {id: 3, name: 'Crystal Clear', exclude: [2, 6, 8]},
  {id: 4, name: 'Silent War', exclude: []},
  {id: 5, name: 'Defenseless', exclude: []},
  {id: 6, name: 'Watchtower', exclude: [3]},
  {id: 7, name: 'Torus', exclude: []},
  {id: 8, name: 'Fading Smog', exclude: [3]},
  {id: 9, name: 'Defection', exclude: []},
  {id: 10, name: 'Slippery', exclude: []},
  {id: 11, name: 'Chess Clock', exclude: []},
];

const MODIFIER_INDEXES = Constants.MODIFIER_INDEXES;

const KNOWN_MODIFIER_OPTION_KEYS = ['ChessClock'];
const KNOWN_CHESS_CLOCK_KEYS =
    ['StartingClock', 'ClockIncrement', 'DontLimitMoveSpeed'];

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// Strict numeric option parsing: accepts a finite number or a nonblank
// string that converts entirely to a finite number. Booleans, arrays,
// objects, partial strings like '5junk', and whitespace-only strings return
// undefined so callers can reject rather than silently defaulting.
function strictFiniteNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  }
  return undefined;
}

// Parses a numeric modifier id from a number or numeric string. Rejects
// fractions, non-finite values, and junk rather than silently dropping them.
function parseModifierId(value) {
  let id = value;
  if (typeof id === 'string') {
    if (id.trim() === '') {
      throw new Error(`Invalid modifier id '${value}'`);
    }
    id = Number(id);
  }
  if (!Number.isInteger(id) || id < 0 || id >= MODIFIERS.length) {
    throw new Error(`Unknown modifier id ${value}`);
  }
  return id;
}

// Normalizes a modifiers value into a unique list of integer ids 0..11.
// Accepts a comma-delimited string ('0,2'), a string array, or a number
// array. null/undefined normalize to the empty selection. Throws on any
// invalid, fractional, non-finite, or unknown id, and on exclusion combos.
function normalizeModifierIds(modifiers) {
  if (modifiers === null || modifiers === undefined) {
    return [];
  }

  let entries;
  if (typeof modifiers === 'string') {
    entries = modifiers.trim() === '' ? [] : modifiers.split(',');
  } else if (Array.isArray(modifiers)) {
    entries = modifiers;
  } else {
    throw new Error(`Invalid modifiers value ${modifiers}`);
  }

  const ids = [];
  for (const entry of entries) {
    const id = parseModifierId(entry);
    if (!ids.includes(id)) {
      ids.push(id);
    }
  }

  for (const id of ids) {
    for (const excluded of MODIFIERS[id].exclude) {
      if (ids.includes(excluded)) {
        throw new Error(
            `Invalid modifiers set, ${MODIFIERS[id].name} excludes ` +
            `${MODIFIERS[excluded].name}`);
      }
    }
  }

  return ids;
}

// Normalizes ChessClock modifier options using the same contract as the live
// game and queue validation: StartingClock >= 1 (default 10), ClockIncrement
// >= 0 (default 5), DontLimitMoveSpeed a real boolean (default false).
// Numeric-form strings are accepted for the numeric fields and stored as
// numbers; every other malformed value throws.
function normalizeChessClockOptions(raw) {
  if (raw === null || raw === undefined) {
    return {
      StartingClock: Constants.DEFAULT_CHESS_CLOCK_STARTING,
      ClockIncrement: Constants.DEFAULT_CHESS_CLOCK_INCREMENT,
      DontLimitMoveSpeed: Constants.DEFAULT_CHESS_CLOCK_DONT_LIMIT_MOVE_SPEED,
    };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid ChessClock modifier options');
  }

  const normalized = {};
  for (const key of Object.keys(raw)) {
    if (!KNOWN_CHESS_CLOCK_KEYS.includes(key)) {
      throw new Error(`Unknown ChessClock option '${key}'`);
    }
  }

  const startingClock = raw.StartingClock === undefined ||
      raw.StartingClock === null ? Constants.DEFAULT_CHESS_CLOCK_STARTING :
      strictFiniteNumber(raw.StartingClock);
  if (!isFiniteNumber(startingClock) || startingClock < 1) {
    throw new Error(`Invalid ChessClock StartingClock ${raw.StartingClock}`);
  }

  const clockIncrement = raw.ClockIncrement === undefined ||
      raw.ClockIncrement === null ? Constants.DEFAULT_CHESS_CLOCK_INCREMENT :
      strictFiniteNumber(raw.ClockIncrement);
  if (!isFiniteNumber(clockIncrement) || clockIncrement < 0) {
    throw new Error(`Invalid ChessClock ClockIncrement ${raw.ClockIncrement}`);
  }

  const dontLimit = raw.DontLimitMoveSpeed === undefined ||
      raw.DontLimitMoveSpeed === null ?
      Constants.DEFAULT_CHESS_CLOCK_DONT_LIMIT_MOVE_SPEED :
      raw.DontLimitMoveSpeed;
  if (typeof dontLimit !== 'boolean') {
    throw new Error(
        `Invalid ChessClock DontLimitMoveSpeed ${raw.DontLimitMoveSpeed}`);
  }

  normalized.StartingClock = startingClock;
  normalized.ClockIncrement = clockIncrement;
  normalized.DontLimitMoveSpeed = dontLimit;
  return normalized;
}

// Normalizes a modifier_options object. Only the ChessClock option key is
// supported; unknown keys throw so a silently-misparsed clock config can
// never slip through. Returns undefined when the input is absent.
function normalizeModifierOptions(raw) {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid modifier_options value');
  }

  const normalized = {};
  for (const key of Object.keys(raw)) {
    if (!KNOWN_MODIFIER_OPTION_KEYS.includes(key)) {
      throw new Error(`Unknown modifier option '${key}'`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'ChessClock')) {
    normalized.ChessClock = normalizeChessClockOptions(raw.ChessClock);
  }
  return normalized;
}

// Returns a normalized shallow copy of an event options object: modifiers
// become unique integer ids and modifier_options is normalized. Unrelated
// options pass through untouched. Throws on invalid values.
function normalizeEventGameOptions(options) {
  if (options === null || options === undefined) {
    return {};
  }
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Invalid event options');
  }

  const normalized = Object.assign({}, options);
  if (Object.prototype.hasOwnProperty.call(normalized, 'modifiers')) {
    normalized.modifiers = normalizeModifierIds(normalized.modifiers);
  }
  if (Object.prototype.hasOwnProperty.call(normalized, 'modifier_options')) {
    const modifierOptions = normalizeModifierOptions(
        normalized.modifier_options);
    if (modifierOptions === undefined) {
      delete normalized.modifier_options;
    } else {
      normalized.modifier_options = modifierOptions;
    }
  }
  return normalized;
}

// Non-throwing wrapper for UI validation.
function validateEventGameOptions(options) {
  try {
    const normalized = normalizeEventGameOptions(options);
    return {valid: true, normalized};
  } catch (error) {
    return {valid: false, error: error.message};
  }
}

function sameIdSet(a, b) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every(id => set.has(id));
}

// Validates a decoded replay against an event's expected options.
// - the replay's own modifiers must always be known/valid (fail closed on
//   unknown future ids)
// - when expectedOptions explicitly carries a modifiers field (even null or
//   empty, which means "no modifiers"), the replay's modifier set must be
//   set-equal to it
// - when the field is absent the event predates modifier tracking and only
//   the decoded-ids validation applies (legacy unspecified behavior)
// - for ChessClock games the effective clock options (after defaults) must
//   match exactly
// Throws on any mismatch; call before writing results.
function assertReplayMatchesExpectedOptions(replay, expectedOptions) {
  const decoded = normalizeModifierIds(replay && replay.modifiers);

  if (!expectedOptions ||
      !Object.prototype.hasOwnProperty.call(expectedOptions, 'modifiers')) {
    return;
  }

  const expected = normalizeModifierIds(expectedOptions.modifiers);
  if (!sameIdSet(decoded, expected)) {
    throw new Error(
        `Replay modifiers [${decoded}] do not match expected event ` +
        `modifiers [${expected}]`);
  }

  if (!decoded.includes(MODIFIER_INDEXES.ChessClock)) {
    return;
  }

  const expectedClock = normalizeChessClockOptions(
      expectedOptions.modifier_options &&
      expectedOptions.modifier_options.ChessClock);
  const actualClock = normalizeChessClockOptions(
      replay.modifier_options && replay.modifier_options.ChessClock);
  if (expectedClock.StartingClock !== actualClock.StartingClock ||
      expectedClock.ClockIncrement !== actualClock.ClockIncrement ||
      expectedClock.DontLimitMoveSpeed !== actualClock.DontLimitMoveSpeed) {
    throw new Error(
        'Replay ChessClock options ' +
        `${JSON.stringify(actualClock)} do not match expected ` +
        `${JSON.stringify(expectedClock)}`);
  }
}

// Validates the exact elapsed-timing metadata appended to ChessClock replays.
// Shape: {turns:number[], players:(number|null)[], duration:number|null} in
// milliseconds relative to the game start. Throws on malformed data rather
// than accepting a plausible-but-wrong clock.
function assertValidChessClockElapsed(elapsed, playerCount) {
  if (!elapsed || typeof elapsed !== 'object' || Array.isArray(elapsed)) {
    throw new Error('Malformed chessClockElapsed metadata');
  }
  if (!Array.isArray(elapsed.turns) ||
      !Array.isArray(elapsed.players) ||
      !(elapsed.duration === null || isFiniteNumber(elapsed.duration))) {
    throw new Error('Malformed chessClockElapsed metadata');
  }

  let lastTurnTime = 0;
  for (const t of elapsed.turns) {
    if (!isFiniteNumber(t) || t < 0 || t < lastTurnTime) {
      throw new Error('Malformed chessClockElapsed turn timing');
    }
    lastTurnTime = t;
  }

  if (elapsed.players.length !== playerCount) {
    throw new Error('Malformed chessClockElapsed player count');
  }
  for (const p of elapsed.players) {
    if (p !== null && (!isFiniteNumber(p) || p < 0)) {
      throw new Error('Malformed chessClockElapsed player timing');
    }
  }

  if (elapsed.duration !== null) {
    const floor = Math.max(
        lastTurnTime,
        ...elapsed.players.filter(p => p !== null));
    if (elapsed.duration < floor) {
      throw new Error('Malformed chessClockElapsed duration');
    }
  }
}

// Stricter than assertValidChessClockElapsed: requires the metadata to
// describe a completed game. The live endgame cleanup kills every remaining
// player, so a finished game has a finite non-negative death offset for
// every player and a finite duration covering all of them. Used for
// scoring, where partial in-progress timing data must never fabricate a
// plausible-but-wrong result.
function assertCompletedChessClockElapsed(elapsed, playerCount) {
  assertValidChessClockElapsed(elapsed, playerCount);
  if (!isFiniteNumber(elapsed.duration)) {
    throw new Error('chessClockElapsed has no completed duration');
  }
  if (!elapsed.players.every(p => isFiniteNumber(p) && p >= 0)) {
    throw new Error('chessClockElapsed is missing a player death offset');
  }
}

module.exports = {
  MODIFIERS,
  MODIFIER_INDEXES,
  normalizeModifierIds,
  normalizeChessClockOptions,
  normalizeModifierOptions,
  normalizeEventGameOptions,
  validateEventGameOptions,
  assertReplayMatchesExpectedOptions,
  assertValidChessClockElapsed,
  assertCompletedChessClockElapsed,
};
