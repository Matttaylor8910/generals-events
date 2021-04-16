import {shuffle} from 'lodash';
import {IDynamicDYPRound, IDynamicDYPTeam, MatchStatus} from 'types';

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
      return getRounds(players, oddManOut, maxRounds);
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