// Typed bridge to the canonical team arena validation/scoring implemented
// in functions/src/util/TeamArena.js (plain JS so the vanilla-node simulator
// can use it). Keeping one implementation prevents the frontend and backend
// wire contracts from drifting apart.

import {IArenaTeam, IEvent, IEventTeamLobby, IStoredEventTeamLobby} from './types';

declare function require(name: string): any;

const TeamArena = require('./functions/src/util/TeamArena.js');

export function isTeamArena(event: Partial<IEvent>|null|undefined): boolean {
  return TeamArena.isTeamArena(event);
}

export function validateTeamArenaConfig(
    event: Partial<IEvent>|null|undefined): void {
  return TeamArena.validateTeamArenaConfig(event);
}

// Validates and normalizes an event_team lobby payload. The result carries
// only the contract fields (version/teamSize/gameSize/teams) in contract
// order; unknown keys and malformed rosters throw.
export function normalizeEventTeam(raw: any): IEventTeamLobby {
  return TeamArena.normalizeLobby(raw);
}

export function rankArenaTeams(teams: IArenaTeam[]): IArenaTeam[] {
  return TeamArena.rankArenaTeams(teams);
}

// Firestore document codec for the lobby contract. Writes must go through
// storeEventTeam (rosters become {players} objects — nested arrays are
// forbidden), and reads decode back to the wire shape with the same
// strict validation as normalizeEventTeam.
export function storeEventTeam(raw: IEventTeamLobby): IStoredEventTeamLobby {
  return TeamArena.storeLobby(raw);
}

export function loadEventTeam(raw: IStoredEventTeamLobby): IEventTeamLobby {
  return TeamArena.loadLobby(raw);
}
