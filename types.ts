import {GeneralsServer} from './constants';

export enum EventFormat {
  DOUBLE_ELIM = 'Double Elimination',
  ARENA = 'Arena',
}

export enum EventType {
  FFA = 'FFA',
  ONE_VS_ONE = '1v1',
}

export enum Visibility {
  PUBLIC = 'Public',
  PRIVATE = 'Private',
}

export enum EventStatus {
  UNKNOWN = 'UNKNOWN',
  UPCOMING = 'UPCOMING',
  ONGOING = 'ONGOING',
  ALMOST_DONE = 'ALMOST_DONE',
  FINISHED = 'FINISHED',
}

export enum GameStatus {
  STARTED = 'STARTED',
  FINISHED = 'FINISHED',
  TOO_LATE = 'TOO_LATE',
}

export interface IBaseEvent {
  name: string;
  format: EventFormat;
  type: EventType;
  visibility: Visibility;
  startTime: number;           // unix timestamp of start of event
  endTime?: number;            // unix timestamp of end of event
  playerCount: number;         // total players in the event
  completedGameCount: number;  // total completed games
  replays: string[];           // a list of all replays that are tracked so far
  server?: GeneralsServer;     // optional server override

  id?: string;       // client field
  exists?: boolean;  // client field
}

export type IEvent = IArenaEvent|IDoubleElimEvent;

// the arena event object located at /events/:id
export interface IArenaEvent extends IBaseEvent {
  endTime: number;  // unix timestamp of end of event, required here
  playersPerGame:
      number;       // number of players to wait for before starting a game
  queue: string[];  // player names in the queue, server will start games
  ongoingGameCount: number;  // total games currently in progress
}

export interface IDoubleElimEvent extends IBaseEvent {
  checkedInPlayers: string[];  // players that have checked in
  winningSets: {
    winners: number;  // games needed to win to advance in the winners bracket
    losers: number;   // games needed to win to advance in the losers bracket
    final: number;    // games needed to win to win the final
  };
}

// the items to be shown in the leaderboard list
// located at /events/:id/players
export interface ILeaderboardPlayer {
  name: string;    // generals.io username, will also be the id
  dq: boolean;     // can be set to true to ban a player from participating
  rank: number;    // the person with the most points, show ties
  points: number;  // start at 0
  currentStreak: number;  // start at 0, used to determine being on a streak
  record: IPlayerHistoryRecord[];  // a list of the point values earned in each
                                   // game played in the event and some metadata
  stats?: ILeaderboardPlayerStats;
  lastThreeOpponents?: string[];  // names of last 3 recent opponents, most
                                  // recent at the beginning
}

export interface ILeaderboardPlayerStats {
  currentStars: number;         // stars for event type on generals.io
  totalGames: number;           // count
  totalWins: number;            // count
  winRate: number;              // wins / totalGames
  longestStreak: number;        // longest win streak
  quickestWin: number|null;     // number of turns for quickest win
  averageWin: number|null;      // average number of turns per win
  averageKills: number|null;    // average number of kills per game
  averageTurns: number|null;    // average turns they were alive per game
  averageRank: number|null;     // average finishing rank per game
  killDeathRatio: number|null;  // totalKills / (totalGames - totalWins)
}

// a game that was played during an event
// located at /events/:id/games
export interface IGame {
  started: number;        // unix timestamp of start of the game
  players: string[];      // a list of the players in a game, ordered by points
  status: GameStatus;     // the current status of the game
  timesChecked?: number;  // just some metadata for the last time a game was
                          // checked to see if there was a replay
  finished?: number;      // unix timestamp of the end of the game
  replayId?: string;      // replay id from generals api response
  replay?: IReplayStats;  // replay scores, summary, stats, etc
  id?: string;            // client field
}

export interface IReplayStats {
  scores: IGamePlayerRecord[];
  summary: string[];
  turns: number;
}

export interface IGamePlayerRecord {
  name: string;
  kills: number;
  rank: number;
  points: number;
  lastTurn: number;
  streak: boolean;
}

// a record of a player's stats for this event at a given point in time
// this will be used to determine a player's points or streak over time
// located at /events/:id/records
export interface IPlayerHistoryRecord extends IGamePlayerRecord {
  started: number;
  finished: number;
  replayId: string;
}

export interface IChatMessage {
  sender: string;
  text: string;
  timestamp: number;  // unix timestamp in client, serverTimestamp in db
  color?: string;     // if provided, the message will be this color
}

// the replay object from the generals.io api
export interface IGeneralsReplay {
  type: '1v1'|'2v2'|'classic'|'custom';
  id: string;
  started: number;
  turns: number;
  ranking: {name: string, stars: number}[];
}
