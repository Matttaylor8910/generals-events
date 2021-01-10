const Algorithms = require('../algorithms.js');
const Heuristics = require('../heuristics.js');

class Discover {
	//every tile just got an extra unit, move them to conquer new tiles 
	static first(bot, waitTurns) {
		//get all tiles, that can be reached with a maximum of moves
		let radius = this.armiesReceivedTillTurn(waitTurns + 1);
		let reachableTiles = Algorithms.bfs(bot.gameState, bot.gameMap, bot.gameState.ownGeneral, radius);
		let discoverTile = Heuristics.chooseDiscoverTile(bot.gameState, bot.gameMap, reachableTiles);
		
		let moves = Algorithms.dijkstra(bot.gameState, bot.gameMap, bot.gameState.ownGeneral, discoverTile);
		bot.queueMoves(moves);
	}

	static second(bot, waitTurns) {
		//TODO: check tiles on armies[general]
		let turns = Math.ceil((waitTurns + 1) / 2 / 2);
		let moveableTiles = bot.gameMap.getMoveableTiles(bot.gameState);
		if(moveableTiles.length > 0) {
			let move = Algorithms.decisionTreeSearch(bot.gameState, bot.gameMap, moveableTiles, turns);
			bot.move(move);
		}
	}

	//gets the amount of armies that the general produced until a given turn
	static armiesReceivedTillTurn(turn) {
		return (turn / 2) + 1;
	}
}

module.exports = Discover;