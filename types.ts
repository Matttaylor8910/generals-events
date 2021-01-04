// the tournament object
// let's design for the ability to have multiple tournaments happening
// simultaneously located at /tournaments/:id
export interface Tournament {
  startTime: number;        // unix timestamp of start of tournament
  endTime: number;          // unix timestamp of end of tournament
  durationMinutes: number;  // # of minutes the tournament should go
  playersPerGame:
      number;       // number of players to wait for before starting a game
  queue: string[];  // player names in the queue, server will start games
  id?: string;      // client field
}

// the items to be shown in the leaderboard list
// located at /tournaments/:id/players
export interface LeaderboardPlayer {
  name: string;           // generals.io username
  rank: number;           // the person with the most points, show ties
  points: number;         // start at 0
  currentStreak: number;  // start at 0, potentially used to determine bonus for
                          // being on a streak
  record: GamePlayerRecord[];  // a list of the point values earned in each game
                               // played in the tournament and some metadata
}



// a game that was played during a tournament
// located at /tournaments/:id/games
export interface Game {
  type: string;           // game type from generals api response
  id: string;             // game id from generals api response
  started: number;        // unix timestamp of start of the game
  players: GamePlayer[];  // a list of the players in a game, ordered by points
}

export interface GamePlayer {
  name: string;
  kills: number;
  rank: number;
  points: number;
}

export interface GamePlayerRecord {
  points: number;
  onStreak: number;
  win: boolean;
}

// a record of a player's stats for this tournament at a given point in time
// this will be used to determine a player's points or streak over time
// located at /tournaments/:id/records
export interface PlayerHistoryRecord {
  name: string;           // generals.io username
  tournamentId: string;   // id of the tournament
  currentStreak: number;  // current streak
  bestStreak: number;     // best streak
  points: number;         // current points
  timestamp: number;  // unix timestamp of this record, should be the started
                      // timestamp of the last game this player played in
}

// the game object from the generals.io api
export interface GeneralsGame {
  type: '1v1'|'2v2'|'ffa'|'custom';
  id: string;
  started: number;
  turns: number;
  ranking: {name: string; stars: number;}[];
}