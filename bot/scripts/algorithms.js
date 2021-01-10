const Heuristics = require('./heuristics.js');
const AStar = require('./astar.js');

class Algorithms {

	//breadth first search. get all reachable tiles in radius
	static bfs(gameState, gameMap, node, radius) {
		let isVisited = Array.apply(null, Array(gameMap.size)).map(function () { return false; })
		isVisited[node] = true;
		
		let queue = [];
		let curLayer = 0;
		let curLayerTiles = 1;
		let nextLayerTiles = 0;
		let foundNodes = [];

		queue.push(node);
		while(queue.length > 0) {
			let curTile = queue.shift();

			//don't add starting node
			if(curLayer != 0) {
				foundNodes.push({"index": curTile, "generalDistance": curLayer});
			}
			
			let adjacentTiles = gameMap.getAdjacentTiles(gameState, curTile);
			//loop through adjacent tiles
			for(let direction in adjacentTiles) {
				if (adjacentTiles.hasOwnProperty(direction)) {
					let nextTile = adjacentTiles[direction];
					if(!isVisited[nextTile.index]) {
						//tile can be moved on(ignore cities)
						if(gameMap.isWalkable(gameState, nextTile)) {
							queue.push(nextTile.index);
							isVisited[nextTile.index] = true;
							nextLayerTiles++;
						}
					}
				}
			}

			//check if all tiles of current depth are already visited
			if(--curLayerTiles == 0) {
				//move to next layer, if radius reached -> stop
				if(curLayer++ == radius) {
					break;
				}	
				curLayerTiles = nextLayerTiles;
				nextLayerTiles = 0;
			}
		}
		return foundNodes;
	}

	static aStar(gameState, gameMap, start, ends) {
		return AStar.search(gameState, gameMap, start, ends);
	}

	//returns shortest path (as array) between start and end index
	//no node weights
	static dijkstra(gameState, gameMap, start, end) {
		let isVisited = [];
		let previous = [];
		
		for(let i = 0; i < gameMap.size; i++) {
			isVisited[i] = false;
			previous[i] = i;
		}

		previous[start] = -1;

		let queue = [];
		queue.push(start);

		while(queue.length > 0) {
			let curTile = queue.shift();
			isVisited[curTile] = true;

			let adjacentTiles = gameMap.getAdjacentTiles(gameState, curTile);
			//loop through adjacent tiles
			for(let direction in adjacentTiles) {
				if (adjacentTiles.hasOwnProperty(direction)) {
					let nextTile = adjacentTiles[direction];
					if(!isVisited[nextTile.index] && !queue.includes(nextTile.index) 
						&& gameMap.isWalkable(gameState, nextTile)) {
						previous[nextTile.index] = curTile;
						if(nextTile.index == end) {
							return this.constructDijkstraPath(start, end, previous);
						}
						queue.push(nextTile.index);
					}
				}
			}
		}

		//no path to end node found
		console.log("Dijkstra found no path! start: " + start + " end: " + end);
		return [];
	}

	//go from end backwards and reconstruct the path as an array
	static constructDijkstraPath(start, end, previous) {
		let prevIndex;
		let curIndex = end;
		let path = [];
		path.push(end);

		//start node has -1 as previous
		while((prevIndex = previous[curIndex]) != -1) {
			//insert at first index of array
			path.unshift({"start": prevIndex, "end": curIndex});
			curIndex = prevIndex;
		}
		return path;
	}

	static decisionTreeSearch(gameState, gameMap, startPoints, turns) {
		//to avoid passing the gameState and gameMap in every recursion
		this.curGameState = gameState;
		this.gameMap = gameMap;

		let moves = [];

		for(let start of startPoints) {
			moves.push(this.decisionTreeSearchRec(start, turns));
		}

		return this.getBestMove(moves);
	}

	//TODO: if enemy tile -> check if it can be captured
	//TODO: simulate new generated armies and moved armies
	//weight: see calcCaptureWeight
	//gets move with maximum amount of tile captures
	static decisionTreeSearchRec(start, turns, weight = 0) {
		let possibleMoves = [];

		if(turns != 0) {
			let adjacentTiles = this.gameMap.getAdjacentTiles(this.curGameState, start);
			//loop through adjacent tiles
			for(let direction in adjacentTiles) {
				if (adjacentTiles.hasOwnProperty(direction)) {
					let nextTile = adjacentTiles[direction];
					if(this.gameMap.isWalkable(this.curGameState, nextTile)) {
						let nextWeight = Heuristics.calcCaptureWeight(this.gameMap.playerIndex, nextTile.value);
						possibleMoves.push(this.decisionTreeSearchRec(nextTile.index, turns - 1, nextWeight));
					} 
				}
			}

			//try waiting a turn without moving
			possibleMoves.push(this.decisionTreeSearchRec(start, turns - 1, 0));
		}

		if(possibleMoves.length == 0) {
			//no more possible moves
			return {"start": start, "end": -1, "weight": weight};
		} else {
			//more possible moves found
			let bestPath = this.getBestMove(possibleMoves);
			return {"start": start, "end": bestPath.start, "weight": weight + bestPath.weight};
		}
	}

	static getBestMove(moves) {
		return moves.reduce((prev, current) =>
			(prev.weight > current.weight) ? prev : current
		);
	}
}
module.exports = Algorithms;