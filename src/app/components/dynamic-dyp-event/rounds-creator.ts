import {shuffle} from 'lodash';
import {IDynamicDYPMatch, IDynamicDYPRound, IDynamicDYPTeam, MatchStatus} from 'types';

const DEBUG = false;
const maxAttempts = 10;
let attempt: number;

/**
 * Given a list of players, generate a list of rounds to be played in a Dynamic
 * DYP Event.
 *
 * If there is an odd number of players, one player will get significantly less
 * games than others, so you can optionally pass an oddManOut that will get the
 * short end of the stick. Generally should be an event organizer.
 *
 * Additionally, you can pass the max # of rounds to display.
 */
export function getRounds(
    players: string[],
    oddManOut?: string,
    maxRounds?: number,
    teamSize = 2,
    playersPerGame = 4,
    ): IDynamicDYPRound[] {
  if (teamSize === 2 && playersPerGame === 4) {
    return getClassicRounds(players, oddManOut, maxRounds);
  }

  return getGenericRounds(players, oddManOut, maxRounds, teamSize, playersPerGame);
}

/**
 * Return true when the generic round inputs are valid: distinct nonempty
 * player names, an integer teamSize from 2 to 8, an integer playersPerGame
 * holding a whole number of teams between 2 and the 16 player lobby cap,
 * and an integer maxRounds between 1 and 100
 */
function validGenericInputs(
    players: string[],
    maxRounds: number,
    teamSize: number,
    playersPerGame: number,
    ): boolean {
  if (!Array.isArray(players) || !players.length ||
      players.some(player => typeof player !== 'string' || !player) ||
      new Set(players).size !== players.length) {
    return false;
  }

  if (!Number.isInteger(teamSize) || teamSize < 2 || teamSize > 8) {
    return false;
  }

  if (!Number.isInteger(playersPerGame) ||
      playersPerGame < teamSize * 2 || playersPerGame > 16 ||
      playersPerGame % teamSize !== 0) {
    return false;
  }

  return Number.isInteger(maxRounds) && maxRounds >= 1 && maxRounds <= 100;
}

function getClassicRounds(
    players: string[],
    oddManOut?: string,
    maxRounds?: number,
    ): IDynamicDYPRound[] {
  attempt = attempt ?? 1;

  const shuffled = shufflePlayers(players, oddManOut);

  const teamsPerRound = getTeamsPerRound(shuffled).slice(0, maxRounds);

  // generate the dynamic dyp rounds by shuffling teams per round
  const rounds = [];
  let matchNumber = 1;
  const matchesCount = new Map<string, number>();
  for (let i = 0; i < teamsPerRound.length; i++) {
    // new round
    rounds.push({name: `Round ${i + 1}`, complete: false, matches: []});

    // shuffle the team and remove one odd team if necessary
    const teams = shuffle(teamsPerRound[i]) as IDynamicDYPTeam[];
    if (teams.length % 2 === 1) {
      const teamToSkip = findTeamToSkip(teams, matchesCount);
      teams.splice(teamToSkip, 1);
    }

    // generate matches for the shuffled teams
    for (let t = 0; t < teams.length; t += 2) {
      const match = {
        teams: teams.slice(t, t + 2),
        ready: [],
        number: matchNumber++,
        status: MatchStatus.NOT_STARTED,
      };
      rounds[i].matches.push(match);

      // keep track of how many matches each player gets to play in
      for (const team of match.teams) {
        for (const player of team.players) {
          matchesCount.set(player, (matchesCount.get(player) || 0) + 1);
        }
      }
    }
  }

  const values = Array.from(matchesCount.values());
  const even = players.length % 2 === 0;

  // if every player doesn't get to play the same number of matches, retry
  if (even && values.some(value => value !== values[0])) {
    if (attempt <= maxAttempts) {
      attempt++;
      console.log(`attempt ${attempt}`);
      return getClassicRounds(players, oddManOut, maxRounds);
    } else {
      console.log('Max retries reached');
    }
  }

  // at this point either we found a good set of rounds/matches or we've
  // exhausted the maximum number of retries
  for (const entry of matchesCount.entries()) {
    const [name, numGames] = entry;
    console.log(`${name} gets to play ${numGames} matches`);
  }
  return rounds;
}

function getGenericRounds(
    players: string[],
    oddManOut?: string,
    maxRounds = 10,
    teamSize = 2,
    playersPerGame = 4,
    ): IDynamicDYPRound[] {
  if (!validGenericInputs(players, maxRounds, teamSize, playersPerGame)) {
    return [];
  }

  const teamsPerMatch = Math.floor(playersPerGame / teamSize);
  const shuffled = shufflePlayers(players, oddManOut);
  const rounds = [];
  const matchesCount = new Map<string, number>();
  const teammateCounts = new Map<string, number>();
  const opponentCounts = new Map<string, number>();
  let matchNumber = 1;

  for (let roundIndex = 0; roundIndex < maxRounds; roundIndex++) {
    const orderedPlayers = rotatePlayers(shuffled, roundIndex);

    // select the active players for this round before building any teams:
    // the players with the fewest matches so far play, ties broken by the
    // rotated order. Picking whole teams to skip after team construction
    // could sit a whole team's worth of players out repeatedly and skew
    // everyone's match counts; this keeps the spread within one match
    const activeCount =
        Math.floor(shuffled.length / playersPerGame) * playersPerGame;
    const activePlayers = orderedPlayers
        .map((name, index) => ({name, index}))
        .sort((a, b) => {
          return (matchesCount.get(a.name) || 0) -
              (matchesCount.get(b.name) || 0) || a.index - b.index;
        })
        .slice(0, activeCount)
        .map(entry => entry.name);

    const teams = buildTeams(
        activePlayers, teamSize, matchesCount, teammateCounts);

    if (teams.length < teamsPerMatch) {
      break;
    }

    const matches = buildMatches(
        teams,
        teamsPerMatch,
        matchNumber,
        matchesCount,
        opponentCounts,
    );

    if (matches.length === 0) {
      break;
    }

    rounds.push({
      name: `Round ${roundIndex + 1}`,
      complete: false,
      matches,
    });

    matchNumber += matches.length;

    for (const match of matches) {
      incrementMatchCounts(match, matchesCount, teammateCounts, opponentCounts);
    }
  }

  return rounds;
}

function getTeamsPerRound(players: string[]): IDynamicDYPTeam[][] {
  const rounds = [];
  const numTeams = Math.floor(players.length / 2);

  // beyond length / 2 for the spread, your spread is identical to previous
  // spreads i.e. for 12 players, spread of 7 is the same as spread 5 in reverse
  for (let spread = 1; spread <= numTeams; spread++) {
    // this algorithm is neat in that we can generate two rounds simultaneously
    // for a given spread
    const round0 = [];
    const round1 = [];
    const set0 = new Set();
    const set1 = new Set();

    let current = 0;
    let round = 0;

    if (DEBUG) {
      console.log(`\nChecking spread of ${spread}\n`);
    }

    // run through the algorithm building up pairings for the rounds until we
    // run out of people for each round or a set has seen current before,
    // indicating that one player would need to be paired twice
    while (set1.size < numTeams) {
      // if we've encountered the current number before, that's okay, we just
      // looped, increment current and keep going
      if (round === 0 && set0.has(current) ||
          round === 1 && set1.has(current)) {
        current++;
      }

      // find the next index
      const next = (current + spread) % players.length;
      const team = generateTeam(players[current], players[next]);
      if (DEBUG) {
        console.log(`adding [${current},${next}] to round ${round}`);
      }

      // oscillate between adding to round 0 and 1
      if (round === 0) {
        // if next is already in the set, it has been used before
        // note: no need to check for round 1 because round 0 will happen first
        // and break
        //
        // TODO: potential opimization: we can generate the spreads that will
        // work beforehand by finding the least common multiple of spread and
        // players.length, dividing that by spread, and returning true if even
        if (set0.has(next)) break;

        // add to round 0
        round0.push(team);
        set0.add(current);
        round = 1;
      } else {
        // add to round 1
        round1.push(team);
        set1.add(current);
        round = 0;
      }

      // update current
      current = next;

      if (DEBUG) {
        console.log(`round0: ${round0} round1: ${round1}\n`);
      }
    }

    // double check everyone was used, then add to rounds
    if (set0.size === numTeams) {
      rounds.push(round0);

      // when the spread # the number of teams possible,
      // both rounds will have identical teams
      if (spread < numTeams) {
        rounds.push(round1);
      }
    }
  }

  return rounds;
}

function buildTeams(
    players: string[],
    teamSize: number,
    matchesCount: Map<string, number>,
    teammateCounts: Map<string, number>,
    ): IDynamicDYPTeam[] {
  const remaining = players.slice();
  const teams = [];

  while (remaining.length >= teamSize) {
    remaining.sort((a, b) => comparePlayers(a, b, matchesCount));
    const captain = remaining.shift();
    if (!captain) {
      break;
    }

    const team = [captain];
    while (team.length < teamSize) {
      const candidate = remaining
          .map((name, index) => {
            return {
              index,
              name,
              score: getTeammateScore(name, team, matchesCount, teammateCounts),
            };
          })
          .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))[0];

      if (!candidate) {
        break;
      }

      team.push(candidate.name);
      remaining.splice(candidate.index, 1);
    }

    if (team.length === teamSize) {
      teams.push({
        players: team.sort((a, b) => a.localeCompare(b)),
        score: 0,
      });
    }
  }

  return teams;
}

function buildMatches(
    teams: IDynamicDYPTeam[],
    teamsPerMatch: number,
    startNumber: number,
    matchesCount: Map<string, number>,
    opponentCounts: Map<string, number>,
    ): IDynamicDYPMatch[] {
  const remaining = teams.slice();
  const matches = [];
  let matchNumber = startNumber;

  while (remaining.length >= teamsPerMatch) {
    remaining.sort((a, b) => {
      return getTeamMatchCount(a, matchesCount) - getTeamMatchCount(b, matchesCount) ||
          a.players.join('|').localeCompare(b.players.join('|'));
    });

    const matchTeams = [remaining.shift()!];
    while (matchTeams.length < teamsPerMatch) {
      const candidate = remaining
          .map((team, index) => {
            return {
              index,
              team,
              score: getOpponentScore(team, matchTeams, matchesCount, opponentCounts),
            };
          })
          .sort((a, b) => {
            return a.score - b.score ||
                a.team.players.join('|').localeCompare(b.team.players.join('|'));
          })[0];

      if (!candidate) {
        break;
      }

      matchTeams.push(candidate.team);
      remaining.splice(candidate.index, 1);
    }

    if (matchTeams.length === teamsPerMatch) {
      matches.push({
        teams: matchTeams,
        ready: [],
        number: matchNumber++,
        status: MatchStatus.NOT_STARTED,
      });
    }
  }

  return matches;
}

function comparePlayers(
    a: string,
    b: string,
    matchesCount: Map<string, number>,
    ): number {
  return (matchesCount.get(a) || 0) - (matchesCount.get(b) || 0) ||
      a.localeCompare(b);
}

function rotatePlayers(players: string[], offset: number): string[] {
  if (!players.length) {
    return [];
  }

  const start = offset % players.length;
  return players.slice(start).concat(players.slice(0, start));
}

function getTeammateScore(
    candidate: string,
    team: string[],
    matchesCount: Map<string, number>,
    teammateCounts: Map<string, number>,
    ): number {
  const repeats = team.reduce((total, player) => {
    return total + (teammateCounts.get(getPairKey(player, candidate)) || 0);
  }, 0);

  return repeats * 100 + (matchesCount.get(candidate) || 0);
}

function getOpponentScore(
    team: IDynamicDYPTeam,
    currentTeams: IDynamicDYPTeam[],
    matchesCount: Map<string, number>,
    opponentCounts: Map<string, number>,
    ): number {
  const repeats = currentTeams.reduce((total, currentTeam) => {
    return total + currentTeam.players.reduce((teamTotal, currentPlayer) => {
      return teamTotal + team.players.reduce((playerTotal, player) => {
        return playerTotal + (opponentCounts.get(getPairKey(currentPlayer, player)) || 0);
      }, 0);
    }, 0);
  }, 0);

  return repeats * 100 + getTeamMatchCount(team, matchesCount);
}

function getTeamMatchCount(
    team: IDynamicDYPTeam,
    matchesCount: Map<string, number>,
    ): number {
  return team.players.reduce((total, player) => {
    return total + (matchesCount.get(player) || 0);
  }, 0);
}

function incrementMatchCounts(
    match: IDynamicDYPMatch,
    matchesCount: Map<string, number>,
    teammateCounts: Map<string, number>,
    opponentCounts: Map<string, number>,
    ) {
  for (const team of match.teams) {
    for (const player of team.players) {
      matchesCount.set(player, (matchesCount.get(player) || 0) + 1);
    }

    incrementPairCounts(team.players, teammateCounts);
  }

  for (let i = 0; i < match.teams.length; i++) {
    for (let j = i + 1; j < match.teams.length; j++) {
      incrementCrossCounts(match.teams[i].players, match.teams[j].players, opponentCounts);
    }
  }
}

function incrementPairCounts(players: string[], counts: Map<string, number>) {
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const key = getPairKey(players[i], players[j]);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
}

function incrementCrossCounts(
    first: string[],
    second: string[],
    counts: Map<string, number>,
    ) {
  for (const left of first) {
    for (const right of second) {
      const key = getPairKey(left, right);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
}

function getPairKey(a: string, b: string): string {
  return [a, b].sort((left, right) => left.localeCompare(right)).join('|');
}

/**
 * Given two players a and b, return a team with these players
 * @param {*} a
 * @param {*} b
 */
function generateTeam(a: string, b: string): IDynamicDYPTeam {
  return {players: [a, b].sort((x, y) => x.localeCompare(y)), score: 0};
}

/**
 * Return the index of a team to skip for this round based on who has played the
 * most games
 */
function findTeamToSkip(teams: IDynamicDYPTeam[], map: Map<string, number>) {
  const minTeams =
      teams
          .map((team, index) => {
            return {
              min: Math.min(...team.players.map(p => map.get(p) || 0)),
              index,
            };
          })
          .sort((a, b) => b.min - a.min);

  return minTeams[0].index;
}

/**
 * Return a shuffled list of players with the oddManOut at the front
 */
function shufflePlayers(players: string[], oddManOut?: string): string[] {
  const shuffled = shuffle(players);
  if (oddManOut) {
    const index = shuffled.indexOf(oddManOut);
    if (index >= 0) {
      shuffled.splice(0, 0, ...shuffled.splice(index, 1));
    }
  }
  return shuffled;
}