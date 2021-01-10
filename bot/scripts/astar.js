const Heap = require('code42day-binary-heap'); 

class AStar {
	static init(gameState, gameMap) {
		this.TILE_COST = 1;
		let searchList = [];

		for(let i = 0; i < gameMap.size; i++) {
			searchList[i] = {};
			searchList[i].index = i;
			searchList[i].g = 0;
			searchList[i].h = 0;
			searchList[i].f = 0;
			searchList[i].armies = 0;
			searchList[i].visited = false;
			searchList[i].closed = false;
			searchList[i].parent = null;
		}
		return searchList;
	}

	static search(gameState, gameMap, start, ends) {
		let searchList = this.init(gameState, gameMap);

		//compare by f value, if equal, compare which has the most armies
 		function compare(a, b) {return a.f == b.f ? b.armies - a.armies : a.f - b.f;}
		let openHeap = new Heap(compare);

		openHeap.push(searchList[start]);
		//TODO: equal tiles -> pick largest army

		while(openHeap.size() > 0) {
			//tile with min f value
			let curTile = openHeap.pop();
			if(curTile === undefined) {
				return [];
			}
			//end was found, build path
			if(ends.includes(curTile.index)) {
				let cur = curTile;
				let path = [];
				while(cur.parent) {
					path.push(cur.index);
					cur = cur.parent;
				}
				//add starting node
				path.push(cur.index);
				return path.reverse();
			}

			curTile.closed = true;

			let adjacentTiles = gameMap.getAdjacentTiles(gameState, curTile.index);
			for(let direction in adjacentTiles) {
				if (adjacentTiles.hasOwnProperty(direction)) {
					let nextTile = adjacentTiles[direction];
					if(!gameMap.isWalkable(gameState, nextTile)) {
						continue;
					}

					let neighbour = searchList[nextTile.index];
					if(neighbour.closed) {
						continue;
					}

					//g score(cost from start to current node)
					let gScore = curTile.g + this.TILE_COST;
					let visited = neighbour.visited;

					//if tile is owned by enemy, add extra weight
					if(nextTile.value >= 0 && nextTile.value != gameState.playerIndex) {
						gScore += gameState.armies[nextTile.index];
					} else if(nextTile.value == -1) {
						//empty tile
						gScore += 1;
					}

					if(!visited || gScore < neighbour.g) {
						neighbour.visited = true;
						neighbour.parent = curTile;
						neighbour.g = gScore;
						neighbour.h = neighbour.h || this.getNearestEndPointHScore(gameMap, start, ends);
						neighbour.f = neighbour.g + neighbour.h;
						neighbour.armies = gameState.armies[nextTile.index];

						if(!visited) {
							openHeap.push(neighbour);
						}  else {
							//already seen the node, but heap needs to be updated for correct sorting
							openHeap.rebuild(neighbour);
						}
					}
				}
			}
		}
		return [];
	}

	static getNearestEndPointHScore(gameMap, start, ends) {
		let min = Infinity;
		for(let end of ends) {
			let distance = gameMap.manhattenDistance(start, end);
			if(distance < min) {
				min = distance;
			}
		}
		return min;
	}
}

module.exports = AStar;