const LZString = require('lz-string');
const Constants = require('./Constants');
const EventGameOptions = require('./EventGameOptions');

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

function deserializePing(serialized) {
  return {
    player: serialized[0],
    turn: serialized[1],
    tileIndex: serialized[2],
  };
}

function deserializeChat(serialized) {
  return {
    text: serialized[0],
    prefix: serialized[1],
    playerIndex: serialized[2],
    turn: serialized[3],
  };
}

function deserializeGeneralTrade(serialized) {
  return {
    playerIndexA: serialized[0],
    playerIndexB: serialized[1],
    turn: serialized[2],
  };
}

function deserializeReplay(serialized) {
  const obj = JSON.parse(LZString.decompressFromUint8Array(new Uint8Array(serialized)));
  if (!obj) return undefined;

  const replay = {};
  let i = 0;
  replay.version = obj[i++];
  replay.id = obj[i++];
  replay.mapWidth = obj[i++];
  replay.mapHeight = obj[i++];
  replay.usernames = obj[i++];
  replay.stars = obj[i++];
  replay.cities = obj[i++];
  replay.cityArmies = obj[i++];
  replay.generals = obj[i++];
  replay.mountains = obj[i++] || [];
  replay.moves = obj[i++].map(deserializeMove);
  replay.afks = obj[i++].map(deserializeAFK);
  replay.teams = obj[i++];
  replay.map = obj[i++];
  replay.neutrals = obj[i++] || [];
  replay.neutralArmies = obj[i++] || [];
  replay.swamps = obj[i++] || [];
  replay.chat = (obj[i++] || []).map(deserializeChat);
  const rawPlayerColors = obj[i++];
  // Replace null/undefined entries (from sockets that never had
  // gio_playerColor set) with the player's index so every player has a valid
  // color, mirroring the live GameReplay deserializer.
  replay.playerColors = rawPlayerColors
      ? rawPlayerColors.map((c, idx) => (c === null || c === undefined ? idx : c))
      : replay.usernames.map((u, idx) => idx);
  replay.lights = obj[i++] || [];

  const options = (obj[i++] || [
    1,
    Constants.DEFAULT_CITY_DENSITY_OPTION,
    Constants.DEFAULT_MOUNTAIN_DENSITY_OPTION,
    Constants.DEFAULT_SWAMP_DENSITY_OPTION,
    Constants.DEFAULT_CITY_FAIRNESS_OPTION,
    Constants.DEFAULT_SPAWN_FAIRNESS_OPTION,
    Constants.DEFAULT_DESERT_DENSITY_OPTION,
    Constants.DEFAULT_LOOKOUT_DENSITY_OPTION,
    Constants.DEFAULT_OBSERVATORY_DENSITY_OPTION,
  ]);

  replay.speed = options[0];
  replay.city_density = options[1];
  replay.mountain_density = options[2];
  replay.swamp_density = options[3];
  replay.modifiers = obj[i++] || [];
  replay.observatories = obj[i++] || [];
  replay.lookouts = obj[i++] || [];
  replay.deserts = obj[i++] || [];

  if (replay.version > 12) {
    replay.city_fairness = options[4];
    replay.spawn_fairness = options[5];
    replay.desert_density = options[6];
    replay.lookout_density = options[7];
    replay.observatory_density = options[8];
  } else {
    replay.city_fairness = -1;
    replay.spawn_fairness = -1;
    replay.desert_density = 0.0;
    replay.lookout_density = 0.0;
    replay.observatory_density = 0.0;
  }

  replay.player_transforms = new Uint8Array(replay.generals.length);
  const rawTransforms = obj[i++];
  if (rawTransforms) {
    for (let transformIndex = 0; transformIndex < replay.generals.length; transformIndex++) {
      replay.player_transforms[transformIndex] = rawTransforms[transformIndex];
    }
  }

  const pingsRaw = obj[i++];
  replay.pings = pingsRaw ? pingsRaw.map(deserializePing) : [];

  const generalTradesRaw = obj[i++];
  replay.generalTrades = generalTradesRaw ? generalTradesRaw.map(deserializeGeneralTrade) : [];

  // v18: tunnels and tunnel limits, then per-turn chess clock timings.
  replay.tunnels = [];
  replay.tunnelLimits = [];
  const tunnelExt = obj[i++];
  const tunnelLimits = obj[i++];
  if (tunnelExt) {
    replay.tunnels = tunnelExt;
    replay.tunnelLimits = tunnelLimits;
  }
  replay.chessClockTimingsByMove = [];
  const chessClockTimingsByMove = obj[i++];
  if (chessClockTimingsByMove) {
    replay.chessClockTimingsByMove = chessClockTimingsByMove;
  }

  // v19: stronghold settings and stronghold list/strengths.
  replay.stronghold_density = Constants.DEFAULT_STRONGHOLD_DENSITY_OPTION;
  replay.stronghold_strength_min = Constants.DEFAULT_STRONGHOLD_STRENGTH_MIN_OPTION;
  replay.stronghold_strength_max = Constants.DEFAULT_STRONGHOLD_STRENGTH_MAX_OPTION;
  replay.strongholds = [];
  replay.strongholdStrengths = [];
  if (replay.version >= 18) {
    replay.stronghold_density = obj[i++] ?? Constants.DEFAULT_STRONGHOLD_DENSITY_OPTION;
    replay.stronghold_strength_min = obj[i++] ?? Constants.DEFAULT_STRONGHOLD_STRENGTH_MIN_OPTION;
    replay.stronghold_strength_max = obj[i++] ?? Constants.DEFAULT_STRONGHOLD_STRENGTH_MAX_OPTION;
    const strongholdExt = obj[i++];
    const strongholdStrengths = obj[i++];
    if (strongholdExt) {
      replay.strongholds = strongholdExt;
      replay.strongholdStrengths = strongholdStrengths;
    }
  }

  // chess clock per-turn execution timestamps (seconds relative to the first
  // executed move), appended after the stronghold fields.
  replay.chessClockMoveExecutionTimestamps = [];
  if (i < obj.length) {
    const chessClockMoveExecutionTimestamps = obj[i++];
    if (chessClockMoveExecutionTimestamps) {
      replay.chessClockMoveExecutionTimestamps = chessClockMoveExecutionTimestamps;
    }
  }

  // per-modifier options (currently only ChessClock).
  replay.modifier_options = null;
  if (i < obj.length) {
    replay.modifier_options = obj[i++] || null;
  }

  // v20 (wire 19): exact chess clock elapsed metadata (milliseconds from the
  // game start) or null for non-clock games and replays that predate it.
  // Malformed tail values are preserved so simulator-side validation can
  // reject them rather than silently treating them as legacy replays.
  replay.chessClockElapsed = null;
  if (i < obj.length) {
    const elapsed = obj[i++];
    replay.chessClockElapsed = elapsed === undefined ? null : elapsed;
  }

  // fail closed on unknown or malformed modifier ids so we never simulate a
  // replay with unimplemented rules
  replay.modifiers = EventGameOptions.normalizeModifierIds(replay.modifiers);

  return replay;
}

module.exports = deserializeReplay;
