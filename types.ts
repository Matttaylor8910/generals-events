export enum TournamentType {
  FFA = 'FFA',
  ONE_VS_ONE = '1v1',
}

export enum GameStatus {
  STARTED = 'STARTED',
  FINISHED = 'FINISHED',
}

// the tournament object
// let's design for the ability to have multiple tournaments happening
// simultaneously located at /tournaments/:id
export interface ITournament {
  name: string;
  type: TournamentType;
  startTime: number;        // unix timestamp of start of tournament
  endTime: number;          // unix timestamp of end of tournament
  durationMinutes: number;  // # of minutes the tournament should go
  playersPerGame:
      number;           // number of players to wait for before starting a game
  queue: string[];      // player names in the queue, server will start games
  playerCount: number;  // total players in the tournament
  replays: string[];    // a list of all replays that are tracked so far
  id?: string;          // client field
}

// the items to be shown in the leaderboard list
// located at /tournaments/:id/players
export interface ILeaderboardPlayer {
  name: string;           // generals.io username, will also be the id
  rank: number;           // the person with the most points, show ties
  points: number;         // start at 0
  currentStreak: number;  // start at 0, potentially used to determine bonus for
                          // being on a streak
  record:
      IGamePlayerRecord[];  // a list of the point values earned in each game
                            // played in the tournament and some metadata
}

export interface IGamePlayerRecord {
  replayId: string;
  points: number;
  onStreak: number;
  win: boolean;
}

// a game that was played during a tournament
// located at /tournaments/:id/games
export interface IGame {
  started: number;        // unix timestamp of start of the game
  players: string[];      // a list of the players in a game, ordered by points
  status: GameStatus;     // the current status of the game
  timesChecked?: number;  // just some metadata for the last time a game was
                          // checked to see if there was a replay
  replayId?: string;      // replay id from generals api response
  replay?: IGameReplay;
}

export interface IGameReplay {
  scores: IGamePlayer[];
  summary: string[];
}

export interface IGamePlayer {
  name: string;
  kills: number;
  rank: number;
  points: number;
}

// a record of a player's stats for this tournament at a given point in time
// this will be used to determine a player's points or streak over time
// located at /tournaments/:id/records
export interface IPlayerHistoryRecord {
  name: string;           // generals.io username
  tournamentId: string;   // id of the tournament
  currentStreak: number;  // current streak
  bestStreak: number;     // best streak
  points: number;         // current points
  timestamp: number;  // unix timestamp of this record, should be the started
                      // timestamp of the last game this player played in
}

// the replay object from the generals.io api
export interface IGeneralsReplay {
  type: '1v1'|'2v2'|'classic'|'custom';
  id: string;
  started: number;
  turns: number;
  ranking: {name: string, stars: number}[];
}
