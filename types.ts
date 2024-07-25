import {GeneralsServer} from './constants';

export enum EventType {
  FFA = 'FFA',
  ONE_VS_ONE = '1v1',
  TWO_VS_TWO = '2v2',
  MULTI_STAGE_EVENT = 'Multi-Stage Event',
}

export enum EventFormat {
  DOUBLE_ELIM = 'Double Elimination',
  ARENA = 'Arena',
  DYNAMIC_DYP = 'Dynamic DYP',
  MULTI_STAGE_EVENT = '',
}

export enum DoublesPairingStrategy {
  BRING_YOUR_PARTNER = 'Bring Your Partner',
  // DRAW_YOUR_PARTNER = 'Draw Your Partner',
}

export enum Visibility {
  PUBLIC = 'Public',
  PRIVATE = 'Private',
  MULTI_STAGE_EVENT = 'Part of Multi-Stage Event',
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

  // A deprecated status that was set for games finishing after the arena countdown reached 0
  TOO_LATE = 'TOO_LATE',
}

export enum PartnerStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  NONE = '',
}

export enum GameSpeed {
  SPEED_0_25X = '0.25x',
  SPEED_0_5X = '0.5x',
  SPEED_0_75X = '0.75x',
  SPEED_1X = '1x',
  SPEED_1_5X = '1.5x',
  SPEED_2X = '2x',
  SPEED_3X = '3x',
  SPEED_4X = '4x',
}

export interface IBaseEvent {
  name: string;
  format: EventFormat;
  type: EventType;
  visibility: Visibility;
  startTime: number;        // unix timestamp of start of event
  endTime?: number;         // unix timestamp of end of event
  playerCount: number;      // total players in the event
  replays: string[];        // a list of all replays that are tracked so far
  winners: string[];        // a list of the winner(s)
  server?: GeneralsServer;  // optional server override
  parentId?: string;        // eventId for this event's parent, for multi-stage

  // 2v2 events will need a pairing strategy
  doublesPairingStrategy?: DoublesPairingStrategy;

  options: Partial<IGeneralsGameOptions>;  // all possible options

  chatBlocklist?: string[];
  disableChat?: boolean;
  disableJoin?: boolean;

  id?: string;       // client field
  exists?: boolean;  // client field
}

export type IEvent =
    IArenaEvent|IDoubleElimEvent|IDynamicDYPEvent|IMultiStageEvent|ILinkEvent;

// the arena event object located at /events/:id
export interface IArenaEvent extends IBaseEvent {
  endTime: number;  // unix timestamp of end of event, required here
  playersPerGame:
      number;       // number of players to wait for before starting a game
  queue: string[];  // player names in the queue, server will start games
  ongoingGameCount: number;    // total games currently in progress
  completedGameCount: number;  // total completed games
}

export interface IDoubleElimEvent extends IBaseEvent {
  checkInTime: number;
  checkedInPlayers: string[];  // players that have checked in
  winningSets: {
    winners: number;  // games needed to win to advance in the winners bracket
    losers: number;   // games needed to win to advance in the losers bracket
    semifinals: number;  // games needed to win to win the semifinals match
    finals: number;      // games needed to win to win the finals match
  };
  twitchChannel?: string;  // optional streamer URL

  // once the event starts this bracket will be updated live by cloud functions
  bracket?: IDoubleEliminationBracket;

  // the season tournaments will only let qualified players check in
  qualified?: string[];
  tsp: {[name: string]: number};
}

export interface IDynamicDYPEvent extends IBaseEvent {
  checkInTime: number;
  checkedInPlayers: string[];

  afks: string[];  // TODO: maybe make this some disqualified array?

  rounds?: IDynamicDYPRound[];
  results: IMatchResults;
  finals?: IDynamicDYPFinals;
}

export interface IMultiStageEvent extends IBaseEvent {
  ongoingGameCount: number;    // total games currently in progress
  completedGameCount: number;  // total completed games
}

export interface ILinkEvent extends IBaseEvent {
  url: string;  // link to an external event
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

  // fields for 2v2 events
  partner?: string;
  partnerStatus?: PartnerStatus;
  teamName?: string;
}

export interface ILeaderboardPlayerStats {
  currentStars: number;         // stars for event type on generals.io
  eventWins: number;            // event wins for this type of tourney
  totalGames: number;           // count
  totalWins: number;            // count
  perfectStarts: number;        // count
  winRate: number;              // wins / totalGames
  longestStreak: number;        // longest win streak
  averageOpening: number|null;  // average tiles after the first round
  quickestWin: number|null;     // number of turns for quickest win
  averageWin: number|null;      // average number of turns per win
  averageKills: number|null;    // average number of kills per game
  averageTurns: number|null;    // average turns they were alive per game
  averageRank: number|null;     // average finishing rank per game
  killDeathRatio: number|null;  // totalKills / (totalGames - totalWins)

  // TSP on the generals.io rankings page for this season if applicable
  totalSeedPoints: number|null;
}

export interface IReplayData {
  started: number;        // unix timestamp of start of the game
  finished?: number;      // unix timestamp of the end of the game
  replay?: IReplayStats;  // replay scores, summary, stats, etc
  replayId?: string;      // replay id from generals api response
}

// a game that was played during an event
// located at /events/:id/games
export interface IGame extends IReplayData {
  players: string[];      // a list of the players in a game, ordered by points
  status: GameStatus;     // the current status of the game
  timesChecked?: number;  // just some metadata for the last time a game was
                          // checked to see if there was a replay
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
  tilesAfterFirstRound: number;
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
  ranking: IGeneralsRanking[];
}

export interface IGeneralsRanking {
  name: string;
  stars: number;
  currentName: string;
}

export interface IDoubleEliminationBracket {
  winners: IBracketRound[];
  losers: IBracketRound[];
  results: IMatchResults;
}

export interface IBracketRound {
  name: string;
  complete: boolean;
  matches: IBracketMatch[];
  winningSets: number;
}

export enum MatchStatus {
  COMPLETE = 'COMPLETE',
  READY = 'READY',
  NOT_STARTED = 'NOT_STARTED',
}

// the interface for a match displayed in the bracket UI
export interface IBracketMatch {
  teams: IMatchTeam[];
  number: number;
  final: boolean;
  bye: boolean;
  status: MatchStatus;

  noRightBorder: boolean;  // helper boolean for a css class

  lobby?: string;  // optional lobby to use
}

// the document under /events/:eventId/matches
export interface IBracketMatchDocument extends IBracketMatch {
  players: string[];
  timesChecked: number;
  started: number;
  updated: number;
  replays: IReplayData[];
}

export enum MatchTeamStatus {
  UNDECIDED = 'UNDECIDED',
  WINNER = 'WINNER',
  LOSER = 'LOSER',
  ELIMINATED = 'ELIMINATED',
}

export interface IMatchTeam {
  name?: string;             // the name of the team to display
  players?: string[];        // the list of players in this team
  score?: number;            // the current # of games won in this match
  status?: MatchTeamStatus;  // status for styling the team in the bracket
  dq?: boolean;              // when set to true, style the match to show DQ
  placeholder?: string;      // some matches have placeholder strings
  tsp?: number;              // tsp for this season if applicable
}

export interface IMatchResults {
  // the key is the match number
  [key: string]: {
    team1Score: number,
    team2Score: number,
  };
}

export enum PlayerProfileStatus {
  FIRST_LOAD = 'FIRST_LOAD',
  LOADING = 'LOADING',
  LOADED = 'LOADED',
}

// located at /players/{:name}
export interface IPlayerProfile {
  status: PlayerProfileStatus;
  lastUpdated: number;
  lastReplayId: string;

  // stats
  totalGames: number;

  // client field
  exists?: boolean;
}

export interface IProfileStats {
  ffaCount: number;
  ffaPercentile: number;
  ffaWinRate: number;
  ffaChartData: {
    started: number,
    percentile: number,
    rank: number,
    count: number,
  }[];
  v1Count: number;
  v1WinRate: number;
  v1ChartData: {
    started: number,
    rank: number,
    winner: number,
    opponent: IGeneralsRanking,
    count: number,
  }[];
  previousNames: string[];
}

// located at /players/{:name}/replays/chunk_0 for example
export interface IPlayerReplaysChunk {
  replays: IGeneralsReplay;
  order: number;
}

export interface IDynamicDYPRound {
  name: string;
  complete: boolean;
  matches: IDynamicDYPMatch[];
}

export interface IDynamicDYPMatch {
  teams: IDynamicDYPTeam[];
  ready: string[];
  number: number;
  status: MatchStatus;

  lobby?: string;  // optional lobby to use
}

export interface IDynamicDYPTeam {
  players: string[];
  score: number;
}

export interface IDynamicDYPMatchDocument extends IDynamicDYPMatch {
  players: string[];
  timesChecked: number;
  started: number;
  updated: number;
  replays: IGeneralsReplay[];
}

export interface IDynamicDYPFinals {
  teams: IDynamicDYPFinalsTeam[];
  currentlyChoosing: string;  // name of player choosing the next partner
  bracket?: IBracketRound[];
}

export interface IDynamicDYPFinalsTeam {
  players: string[];
}

export interface IGeneralsGameOptions {
  // show the map when you are defeated when this value is true
  defeat_spectate?: boolean;

  // join the game lobby as a spectator when true
  // as of 6/14/21 providing this param with either value sets you as a
  // spectator since it is just checking for the param being present
  spectate?: boolean;

  // allows spectators messages to not being visible to players when true
  spectate_chat?: boolean;

  // the map name from a map URL e.g. super%20duper%20fan%20mape to use the map
  // from https://generals.io/maps/super%20duper%20fan%20mape
  map?: string;

  // the speed at which the game should be run
  speed?: GameSpeed;

  // the width of the map, between 0 and 1, e.g. 0.75
  width?: number;

  // the height of the map, between 0 and 1, e.g. 0.75
  height?: number;

  // the city density, between 0 and 1, e.g. 0.75
  cities?: number;

  // the mountain density, between 0 and 1, e.g. 0.75
  mountains?: number;

  // the swamp ratio, between 0 and 1, e.g. 0.75
  swamps?: number;

  // the desert ratio, between 0 and 1, e.g. 0.75
  deserts?: number;

  // the lookout ratio, between 0 and 1, e.g. 0.75
  lookouts?: number;

  // the observatory ratio, between 0 and 1, e.g. 0.75
  observatories?: number;

  // the city fairness, between 0 and 1, e.g. 0.75
  city_fairness?: number;

  // the team to join when you reach a lobby
  team?: number;

  // the modifiers to use, can be a single number or multiple comma separated
  // e.g. modifiers=1 or modifiers=0,2
  modifiers?: string;
}

export interface IGeneralsRankings {
  season: number;
  tsp: IGeneralsTSPForUsername[];
  weeks: IGeneralsRankingsWeek[];
}

export interface IGeneralsTSPForUsername {
  username: string;
  tsp: number;
}

export interface IGeneralsRankingsWeek {
  'duel': IGeneralsStarsForUsername[];  // this is all we care about
  'ffa': IGeneralsStarsForUsername[];
  '2v2': IGeneralsStarsForUsername[];
  'duel-alltime': IGeneralsStarsForUsername[];
  'ffa-alltime': IGeneralsStarsForUsername[];
  '2v2-alltime': IGeneralsStarsForUsername[];
}

export interface IGeneralsStarsForUsername {
  stars: number;
  username: string;
}

export interface IEventInfo {
  eventId: string;
  date: string;
  time: string;
  timezone: string;
  timerIframeUrl: string;
}
