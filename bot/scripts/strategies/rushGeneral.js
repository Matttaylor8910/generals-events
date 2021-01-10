const Algorithms = require('../algorithms.js');
const Collect = require('./collect.js');

const COLLECT_TURNS = 20;
let collectTurnsLeft = COLLECT_TURNS;

class RushGeneral {

	static rush(bot) {
		if(!this.tryToKillGeneral(bot)) {
			if(collectTurnsLeft > 0) {
				bot.collectArea = Algorithms.aStar(bot.gameState, bot.gameMap, bot.gameState.ownGeneral, [bot.gameState.enemyGeneral]);
				//remove last element(enemy general)
				bot.collectArea.pop();
				Collect.collect(bot);
				collectTurnsLeft--;
			} else if(collectTurnsLeft == 0) {
				this.moveToGeneral(bot, bot.gameState.ownGeneral);
				collectTurnsLeft = -1;
			} else {
				this.moveToGeneral(bot, bot.lastAttackedIndex);
			}
		}
	}

	static moveToGeneral(bot, start) {
		//start moving collected armies
		let pathFromHighestArmyToGeneral = Algorithms.aStar(bot.gameState, bot.gameMap, start, [bot.gameState.enemyGeneral]);
		
		//if length would be 2 there is only the general left to attack, but there aren't enough armies to kill him
		if(pathFromHighestArmyToGeneral.length > 2) {
			bot.move({"start": start, "end": pathFromHighestArmyToGeneral[1]});
		} else {
			collectTurnsLeft = COLLECT_TURNS;
		}
	}

	//if player is adjacent to enemy general and has enough amrmies -> attack and return true
	//return false otherwise
	static tryToKillGeneral(bot) {
		let adjacentTiles = bot.gameMap.getAdjacentTiles(bot.gameState, bot.gameState.enemyGeneral);
		let attackableNeighbours = [];

		//loop through adjacent tiles
		for(let direction in adjacentTiles) {
			if(adjacentTiles.hasOwnProperty(direction)) {
				let nextTile = adjacentTiles[direction];
				if(nextTile.value != -5 && nextTile.value == bot.gameState.playerIndex) {
					if(this.hasEnoughArmiesToAttackGeneral(bot, nextTile.index)) {
						bot.move({"start": nextTile.index, "end": bot.gameState.enemyGeneral});
						bot.isInfiltrating = false;
						return true;	
					} else if(bot.gameState.armies[nextTile.index] > 1) {
						attackableNeighbours.push(nextTile.index);
					}
				}
			}
		}
		if(attackableNeighbours.length > 1) {
			return this.tryGroupAttack(bot, attackableNeighbours);
		}

		return false;
	}

	//try to attack general with more than one neighbour
	static tryGroupAttack(bot, attackableNeighbours) {
		let highestArmy = -1;
		let highestArmyTile = -1; 
		let attackableArmySum = 0;
		for(let neighbour of attackableNeighbours) {
			let armies = bot.gameState.armies[neighbour];
			attackableArmySum += armies - 1;
			if(armies > highestArmy) {
				highestArmy = armies;
				highestArmyTile = neighbour;
			}
		}

		if(attackableArmySum > bot.gameState.armies[bot.gameState.enemyGeneral]) {
			bot.move({"start": highestArmyTile, "end": bot.gameState.enemyGeneral});
			return true;
		}

		return false;
	}

	static hasEnoughArmiesToAttackGeneral(bot, index) {
		let nextTurnArmyGain = 0;
		//generals get an extra army every even turn
		if(bot.turn % 2 != 0) {
			nextTurnArmyGain = 1;
		}
		//attacking tile leaves 1 army behind and has to have one mor ethen enemy to take the tile
		return (bot.gameState.armies[index] - 1) > (bot.gameState.armies[bot.gameState.enemyGeneral] + nextTurnArmyGain);
	}
}

module.exports = RushGeneral;