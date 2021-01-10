const Algorithms = require('../algorithms.js');

class Infiltrate {
	//TODO: create function, that returns nearest enemy tile next to fog
	static infiltrate(bot) {
		let enemyNeighbor = -1;

		if(this.lastAttackedIndexIsValid(bot)) {
			let attackSource = bot.lastAttackedIndex;
			let adjacentTiles = bot.gameMap.getAdjacentTiles(bot.gameState, attackSource);
			//loop through adjacent tiles
			for(let direction in adjacentTiles) {
				if (adjacentTiles.hasOwnProperty(direction)) {
					let nextTile = adjacentTiles[direction];
					//found an adjacent enemy tile, which has an undiscovered neighbor(ignore if it is a city)
					if(bot.gameMap.isEnemy(bot.gameState, nextTile.index) &&
						bot.gameMap.isWalkable(bot.gameState, nextTile.index) &&
						bot.gameMap.isAdjacentToFog(bot.gameState, nextTile.index)) {

						//no tile found yet, or already found and less armies
						if(enemyNeighbor == -1 || 
							bot.gameState.armies[nextTile.index] < bot.gameState.armies[enemyNeighbor.index]) {
							enemyNeighbor = nextTile;
						}
					}
				}
			}

			let start = attackSource;
			let end = -1;

			if(enemyNeighbor != -1) {
				end = enemyNeighbor.index;
			} else {
				//no adjacent enemy tile found, that could lead to the enemy general
				//search for nearest
				let path = this.getPathToNextTile(bot, attackSource);
				if(path.length > 1) {
					//path gets recalculated every move/infiltrate call
					end = path[1];
				}
			}

			if(end == -1 || bot.gameMap.remainingArmiesAfterAttack(bot.gameState, start, end) <= 1) {
				bot.isInfiltrating = false;
			}

			if(end != -1 && bot.gameMap.remainingArmiesAfterAttack(bot.gameState, start, end) >= 1) {
				bot.move({"start": start, "end": end});
			}
		} else {
			//console.log(bot.gameState.turn + " Last attack index was not valid!" + bot.lastAttackedIndex);
			bot.isInfiltrating = false;
		}
	}

	static lastAttackedIndexIsValid(bot) {
		return bot.lastAttackedIndex != -1 && bot.gameState.terrain[bot.lastAttackedIndex] == bot.gameState.playerIndex;
	}

	//get nearest tile to index with adjacent fog
	static getPathToNextTile(bot, index) {
		let tilesWithFog = [];
		for (let [key, value] of bot.gameState.enemyTiles) {
			if(bot.gameMap.isAdjacentToFog(bot.gameState, key)) {
				tilesWithFog.push(key);
			}
		}
		if(tilesWithFog.length > 0) {
			return Algorithms.aStar(bot.gameState, bot.gameMap, index, tilesWithFog);
		}
		return [];
	}
}

module.exports = Infiltrate;