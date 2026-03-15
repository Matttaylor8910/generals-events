'use strict';

module.exports = {
  MIN_CITY_ARMY: 40,
  RECRUIT_RATE: 2,  // 1 recruit per city/general every _ turns.
  FARM_RATE: 50,    // 1 recruit per land every _ turns.
  MAX_GAME_MOVES_AT_NORMAL_SPEED: 25000 * 2,
  MAX_GAME_ALL_PLAYERS_AFK_MOVES_AT_NORMAL_SPEED: 1000 * 2,
  DEFAULT_CITY_DENSITY_OPTION: 0.5,
  DEFAULT_MOUNTAIN_DENSITY_OPTION: 0.5,
  DEFAULT_LOOKOUT_DENSITY_OPTION: 0.0,
  DEFAULT_OBSERVATORY_DENSITY_OPTION: 0.0,
  DEFAULT_DESERT_DENSITY_OPTION: 0.0,
  DEFAULT_SWAMP_DENSITY_OPTION: 0.0,
  DEFAULT_CITY_FAIRNESS_OPTION: 0.5,
  DEFAULT_SPAWN_FAIRNESS_OPTION: 0.5,
  MODIFIER_INDEXES: {
    Leapfrog: 0,
    CityState: 1,
    MistyVeil: 2,
    CrystalClear: 3,
    SilentWar: 4,
    Defenseless: 5,
    Watchtower: 6,
    Torus: 7,
    FadingSmog: 8,
    Defection: 9,
    Slippery: 10,
  },
};