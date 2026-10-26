import {IDoubleElimEvent, ILeaderboardPlayer, IMatchTeam} from './types';

// a generals.io game lobby holds at most 16 players, so a team in a two-team
// match can never have more than 8 members
export const MIN_TEAM_SIZE = 2;
export const MAX_TEAM_SIZE = 8;

/**
 * Return a sorted copy of a team's member list. The canonical ordering is
 * what every member's player doc is expected to carry, and what team
 * identity comparisons use.
 *
 * @param members the member list to canonicalize
 */
export function canonicalTeamMembers(members: string[]): string[] {
  return (members || []).slice().sort((a, b) => a.localeCompare(b));
}

/**
 * Return the canonical identity string for a team. JSON.stringify is used
 * instead of a delimiter join so member names can never produce collisions.
 *
 * @param members the member list to identify
 */
export function teamIdentity(members: string[]): string {
  return JSON.stringify(canonicalTeamMembers(members));
}

/**
 * Return true if the given value is a valid Big Team size: an integer between
 * 2 and 8 inclusive (a lobby fits 16 players, i.e. two teams of 8).
 *
 * @param teamSize the configured team size
 */
export function isValidTeamSize(teamSize: number): boolean {
  return Number.isInteger(teamSize) && teamSize >= MIN_TEAM_SIZE &&
      teamSize <= MAX_TEAM_SIZE;
}

/**
 * Return true if the given value is a well-formed member list: an array of
 * unique, nonempty player names. Malformed metadata (a string, a number, an
 * array containing numbers or objects, duplicates) is invalid rather than
 * something to silently sort or canonicalize.
 *
 * @param members the value to check
 */
export function isValidTeamMembers(members: any): members is string[] {
  return Array.isArray(members) && members.length > 0 &&
      new Set(members).size === members.length &&
      members.every(member => typeof member === 'string' && !!member);
}

/**
 * Return true only when the given value represents a player with no team:
 * missing entirely or an explicitly empty roster. Anything else (a number,
 * an object, a malformed or populated array) means the player carries team
 * metadata that must not be silently overwritten.
 *
 * @param members the stored teamMembers value
 */
export function isUnassigned(members: any): boolean {
  return members === undefined || members === null ||
      (Array.isArray(members) && members.length === 0);
}

/**
 * Return the list of fully confirmed big teams for an event. A team only
 * counts as confirmed when EVERY member's player doc agrees:
 *
 *  - the event's teamSize is a valid integer 2..8
 *  - the roster has exactly teamSize unique, nonempty member names
 *  - the captain is a member of the roster
 *  - every member is registered, checked in, and not disqualified
 *  - every member's doc carries the identical canonical roster and captain
 *
 * Bogus, stale, or overlapping roster claims cannot produce a confirmed
 * team this way, and the inputs are never mutated.
 *
 * @param event the double elimination event
 * @param players the event's registered player docs
 */
export function getConfirmedBigTeams(
    event: IDoubleElimEvent,
    players: ILeaderboardPlayer[],
    ): IMatchTeam[] {
  const teamSize = event?.teamSize;
  if (typeof teamSize !== "number" || !isValidTeamSize(teamSize)) {
    return [];
  }

  const checkedIn = new Set(event?.checkedInPlayers || []);
  const byName = new Map<string, ILeaderboardPlayer>();
  const dupes = new Set<string>();
  for (const player of players || []) {
    if (byName.has(player.name)) {
      // two docs for the same name means the input is inconsistent; any team
      // containing that name cannot be confirmed
      dupes.add(player.name);
    }
    byName.set(player.name, player);
  }

  const teams: IMatchTeam[] = [];
  const seen = new Set<string>();

  for (const player of players || []) {
    const members = player.teamMembers;

    // roster must be a well-formed member list of exactly teamSize names
    // including the player whose doc claims it
    if (!isValidTeamMembers(members) || members.length !== teamSize ||
        !members.includes(player.name) || dupes.has(player.name)) {
      continue;
    }

    // the captain must actually be a member of the roster
    const captain = player.teamCaptain;
    if (!captain || !members.includes(captain)) {
      continue;
    }

    const identity = teamIdentity(members);
    if (seen.has(identity)) {
      continue;
    }

    // every member must be registered, checked in, eligible, and carry the
    // identical reciprocal roster and captain
    const memberDocs = members.map(member => byName.get(member));
    const consistent = memberDocs.every(member => {
      return !!member && !dupes.has(member.name) &&
          checkedIn.has(member.name) && !member.dq &&
          member.teamCaptain === captain &&
          isValidTeamMembers(member.teamMembers) &&
          teamIdentity(member.teamMembers) === identity;
    });
    if (!consistent) {
      continue;
    }

    seen.add(identity);
    const roster = canonicalTeamMembers(members);
    const placeholder = roster.join(' and ');
    const name = byName.get(captain)?.teamName || placeholder;
    teams.push({
      name,
      players: roster,
      placeholder: name === placeholder ? '' : placeholder,
    });
  }

  return teams;
}
