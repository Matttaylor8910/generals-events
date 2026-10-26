import {GeneralsServer} from './constants';

export enum EventType {
  FFA = 'FFA',
  ONE_VS_ONE = '1v1',
  TWO_VS_TWO = '2v2',
  BIG_TEAM = 'Big Team',
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
  RANDOM_PARTNERS = 'Random Partners',
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
  CANCELLED = 'CANCELLED',

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

  teamSize?: number;
  playersPerGame?: number;

  options: Partial<IGeneralsGameOptions>;  // all possible options

  chatBlocklist?: string[];
  disableChat?: boolean;
  disableJoin?: boolean;

  id?: string;       // client field
  exists?: boolean;  // client field
}

export type IEvent =
    IArenaEvent|IDoubleElimEvent|IDynamicDYPEvent|IMultiStageEvent|ILinkEvent;

// a fixed bring-your-partner team registered on a team arena event
export interface IArenaTeam {
  id: string;             // stable unique id from the event's team counter
  name: string;           // display name ('' falls back to member list)
  captain: string;
  members: string[];      // active roster, at most event.teamSize names
  requests: string[];     // players who asked to join, pending captain accept
  noShows: string[];      // members the captain marked absent
  acceptFill: boolean;        // captain opts in to voluntary random fill
  allowShortHanded: boolean;  // captain allows queuing below teamSize
  points: number;
  games: number;
  wins: number;
  participants: string[];  // members who actually played at least one game
}

// the immutable team roster dispatched into one team arena game; players may
// be shorter than teamSize when the team opted into short-handed play
export interface IArenaGameTeam {
  id: string;
  name: string;
  players: string[];
}

// the normalized event_team lobby contract (usernames only, never ids)
export interface IEventTeamLobby {
  version: number;   // currently 1
  teamSize: number;
  gameSize: number;  // nominal players per game, a multiple of teamSize
  teams: string[][]; // actual dispatched rosters
}

// the Firestore-stored form of that contract: documents cannot hold nested
// arrays, so each roster is wrapped in an object. Only storage boundaries
// use this shape — everything on the wire keeps IEventTeamLobby.
export interface IStoredEventTeamLobby
    extends Omit<IEventTeamLobby, 'teams'> {
  teams: {players: string[]}[];
}

// per-team terminal outcome of a dispatched arena game
export interface IArenaTeamOutcome {
  id: string;
  winner: boolean;
  eliminatedTurn: number|null;
}

// the arena event object located at /events/:id
export interface IArenaEvent extends IBaseEvent {
  endTime: number;  // unix timestamp of end of event, required here
  playersPerGame:
      number;       // number of players to wait for before starting a game
  queue: string[];  // player names in the queue, server will start games
  ongoingGameCount: number;    // total games currently in progress
  completedGameCount: number;  // total completed games

  // team arena state (Big Team or 2v2 arenas); unset on legacy arenas
  arenaTeams?: IArenaTeam[];   // fixed rosters for bring-your-partner events
  arenaReady?: {[username: string]: number};  // fresh ready timestamps (ms)
  arenaQueueAt?: {[username: string]: number};  // first-ready time per
    // player; heartbeats update arenaReady but never this, so queue order
    // stays FIFO across renewals
  arenaPlaying?: string[];       // players locked into an in-flight game
  arenaParticipants?: string[];  // everyone ever dispatched into a game
  arenaMatchNumber?: number;     // monotonically increasing match counter
  arenaTeamNumber?: number;      // monotonically increasing BYP team counter
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
  withdrawn?: boolean;  // team arena withdrawal keeps the scored record so
                        // event history/points survive; registration UI and
                        // matchmaking treat withdrawn players as absent
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
  teamCaptain?: string;
  teamMembers?: string[];
  // Public captain usernames; only the authenticated backend writes invites.
  bigTeamInvites?: string[];
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
  finished?: number|null; // unix timestamp of the end of the game, or null
                          // when unknown (legacy Chess Clock replays)
  replay?: IReplayStats;  // replay scores, summary, stats, etc
  replayId?: string;      // replay id from generals api response
  elapsedMs?: number|null;  // exact game duration for Chess Clock replays
}

// a game that was played during an event
// located at /events/:id/games
export interface IGame extends IReplayData {
  players: string[];      // a list of the players in a game, ordered by points
  status: GameStatus;     // the current status of the game
  timesChecked?: number;  // just some metadata for the last time a game was
                          // checked to see if there was a replay
  id?: string;            // client field

  // team arena dispatch metadata (immutable once the matcher writes it)
  arenaTeams?: IArenaGameTeam[];
  eventTeam?: IStoredEventTeamLobby;
  lobby?: string;
  // the lobby configuration captured at dispatch; later event edits can
  // never retroactively invalidate a game already sent to a lobby
  options?: Partial<IGeneralsGameOptions>;
  server?: GeneralsServer;
}

// a redirect doc telling a player which lobby to join
// located at /events/:id/redirect
export interface IRedirect {
  players: string[];            // mutable acknowledgement list
  lobby: string;
  started: number;
  gameId?: string;              // team arena games are pre-created by matcher
  arenaTeams?: IArenaGameTeam[];
  eventTeam?: IStoredEventTeamLobby;
  // dispatch-time snapshots of the lobby configuration and target server
  options?: Partial<IGeneralsGameOptions>;
  server?: GeneralsServer;
}

export interface IReplayStats {
  scores: IGamePlayerRecord[];
  summary: string[];
  turns: number;
  elapsedMs?: number|null;  // exact duration for Chess Clock replays; null
                            // means a legacy clock replay without timing data
  teamOutcomes?: IArenaTeamOutcome[];  // team arena terminal outcomes
}

export interface IGamePlayerRecord {
  name: string;
  kills: number;
  rank: number;
  points: number;
  lastTurn: number;
  tilesAfterFirstRound: number;
  streak: boolean;
  teamCount?: number;
  elapsedMs?: number|null;  // exact death offset for Chess Clock replays;
                            // null while still alive / for legacy replays
}

// a record of a player's stats for this event at a given point in time
// this will be used to determine a player's points or streak over time
// located at /events/:id/records
export interface IPlayerHistoryRecord extends IGamePlayerRecord {
  started: number;
  finished: number|null;  // null when the finish time is unknown
  replayId: string;
  teamId?: string;        // team arena games tag the dispatched team id
}

export interface IChatMessage {
  sender: string;
  text: string;
  timestamp: number;  // unix timestamp in client, serverTimestamp in db
  color?: string;     // if provided, the message will be this color
}

// the replay object from the generals.io api
export interface IGeneralsReplay {
  type: '1v1'|'2v2'|'bigteam'|'classic'|'custom';
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
    team1Score?: number,
    team2Score?: number,
    [teamScore: string]: number|undefined,
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

// Chess Clock modifier options for a game lobby; the keys match the live
// game's modifier_options.ChessClock contract.
export interface IChessClockOptions {
  StartingClock?: number;       // seconds each player starts with (min 1)
  ClockIncrement?: number;      // seconds awarded each round (min 0)
  DontLimitMoveSpeed?: boolean; // unlimited speed when everyone has moved
}

// per-modifier option payloads; only ChessClock is currently supported
export interface IModifierOptions {
  ChessClock?: IChessClockOptions;
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

  // the spawn fairness, between 0 and 1, e.g. 0.75
  spawn_fairness?: number;

  // the team to join when you reach a lobby
  team?: number;

  // the number of players the lobby should hold (max_players)
  players?: number;

  // the dispatched team roster for a team arena lobby, serialized as JSON on
  // the lobby URL (the event_team query param)
  event_team?: IEventTeamLobby;

  // the tunnel density, between 0 and 1, e.g. 0.75
  tunnels?: number;

  // the minimum army a tunnel tile can hold, an integer between 5 and 400
  tunnel_min?: number;

  // the maximum army a tunnel tile can hold, an integer between 5 and 500
  tunnel_max?: number;

  // the stronghold density, between 0 and 1, e.g. 0.75
  strongholds?: number;

  // the minimum stronghold strength, an integer between 5 and 100
  stronghold_min?: number;

  // the maximum stronghold strength, an integer between 5 and 100
  stronghold_max?: number;

  // the modifiers to use: a comma separated list in URL form ('0,2,11'),
  // or a list of numeric ids in stored options
  modifiers?: string|number[]|string[];

  // per-modifier options (currently only ChessClock)
  modifier_options?: IModifierOptions;

  // the event this lobby belongs to
  eventId?: string;
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
  startTime: number;
  date: string;
  time: string;
  timezone: string;
}
