// Map Constants.
// Any tile with a nonnegative value is owned by the player corresponding to its value.
// For example, a tile with value 1 is owned by the player with playerIndex = 1.
module.exports.EMPTY = -1;
module.exports.MOUNTAIN = -2;
module.exports.FOG = -3;
module.exports.FOG_OBSTACLE = -4; // Cities and Mountains show up as Obstacles in the fog of war.
module.exports.OFF_LIMITS = -5;