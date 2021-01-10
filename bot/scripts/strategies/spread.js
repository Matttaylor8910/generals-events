class Spread {
	//every tile just got an extra unit, move them to conquer new tiles 
	static spread(bot) {
		let gameMap = bot.gameMap;
		let gameState = bot.gameState;
		let playerIndex = gameMap.playerIndex;

		let moveableTiles = gameMap.getMoveableTiles(gameState);
		let possibleMoves = [];
		for(let tile of moveableTiles) {
			let adjacentTiles = gameMap.getAdjacentTiles(gameState, tile);
			let neighbourMoves = [];

			//loop through adjacent tiles
			for(let direction in adjacentTiles) {
				if (adjacentTiles.hasOwnProperty(direction)) {
					let nextTile = adjacentTiles[direction];
					//empty tile
					if(nextTile.value == -1 && !gameMap.isCity(gameState, nextTile)) {
						neighbourMoves.push(nextTile.index);
					}
				}
			}
			if(neighbourMoves.length > 0) {
				possibleMoves.push({"index": tile, "moves": neighbourMoves});
			}
		}

		this.sortByNeighbourCount(possibleMoves);
		while(possibleMoves.length > 0) {
			let curNode = possibleMoves.shift();

			if(curNode.moves.length >= 1) {
				let chosenTile = curNode.moves.shift();

				bot.move({"start": curNode.index, "end": chosenTile});
				this.removeAlreadyOccupiedTile(possibleMoves, chosenTile);

				this.sortByNeighbourCount(possibleMoves);
			}
		}
	}

	//TODO: sort while updating for more efficiency
	static sortByNeighbourCount(moves) {
		moves.sort((a,b) => 
			(a.moves.length > b.moves.length) ? 1 : ((b.moves.length > a.moves.length) ? -1 : 0) 
		);
	}

	static removeAlreadyOccupiedTile(moves, index) {
		moves.map(x =>
			x.moves = x.moves.filter(v => v !== index)
		);
	}
}

module.exports = Spread;