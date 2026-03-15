const LZString = require('lz-string');
const Constants = require('./Constants');

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
  replay.playerColors = obj[i++] || replay.usernames.map((u, idx) => idx);
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

  return replay;
}

module.exports = deserializeReplay;
