import {cloneDeep, map, shuffle} from 'lodash';
import {IBracketMatch, IDoubleElimEvent, IDoubleEliminationBracket, IMatchTeam, MatchTeamStatus} from 'types';

export function getShuffledBracket(
    event: IDoubleElimEvent, teams: IMatchTeam[]): IDoubleEliminationBracket {
  let matchTeams: IMatchTeam[] = teams.map(team => {
    const tsp = team.players.map(player => (event.tsp ?? {})[player] ?? 0)
                    .reduce((a, b) => a + b, 0);
    return {
      name: team.name,
      players: team.players,
      score: 0,
      status: MatchTeamStatus.UNDECIDED,
      dq: false,
      tsp,
    };
  });

  matchTeams = cloneDeep(matchTeams);

  // determine the number of matches in the first round given a set # of teams
  const round1Matches = determineRound1Matches(matchTeams.length);

  // generate an empty bracket given a number of round 1 matches
  const bracket = generateEmptyBracket(round1Matches, event);

  // when tsp is present, we will seed the tournament based on total seed
  // points for the current/last season
  if (event.tsp) {
    // sort the teams (players) descending by tsp
    matchTeams.sort((a, b) => b.tsp - a.tsp);

    // get the seed positions for the tournament based on the number of teams,
    // then set the matches
    const seeds = getSeeds(matchTeams.length);

    for (let i = 0; i < seeds.length; i++) {
      seeds[i].filter(seed => seed !== null).forEach(seed => {
        const team = matchTeams[seed - 1];
        bracket.winners[0].matches[i].teams.push(team);
      });
    }
  }

  // no tsp, shuffle the teams
  else {
    matchTeams = shuffle(matchTeams);

    // pair teams in matches for the first round of the winners bracket
    let i = 0;
    const increment = round1Matches / (matchTeams.length - round1Matches);
    matchTeams.forEach(team => {
      const index = Math.floor(i) % round1Matches;
      bracket.winners[0].matches[index].teams.push(team);

      // after we've populated each match once, we need to increment differently
      // based on the number or remaining teams to pair so that we spread them
      // out roughly evenly throughout the matches
      i += (i >= round1Matches - 1 ? increment : 1);
    });
  }

  // generate the byes and the placeholders for where winners/losers will go
  generatePlaceholders(bracket);

  return bracket;
}

function generateEmptyBracket(
    round1Matches: number,
    event: IDoubleElimEvent,
    ): IDoubleEliminationBracket {
  const bracket = {winners: [], losers: [], results: {}};
  const {winners, losers, semifinals, finals} = event.winningSets;

  // generate the winner bracket
  let winnerTracker = round1Matches;
  let winnerRound = 1;
  while (winnerTracker > 0) {
    const round = {
      name: `Round ${winnerRound}`,
      matches: [],
      winningSets: winners,
    };

    for (let i = 0; i < winnerTracker; i++) {
      round.matches.push({teams: []});
    }

    bracket.winners.push(round);

    // in the winner's bracket, the # of matches just keeps halving
    // until we reach the finals match and the loser's bracket finishes
    winnerTracker = Math.floor(winnerTracker / 2);
    winnerRound++;

    // the last round before we break out of the loop is the semifinals match
    if (winnerTracker === 0) {
      round.name = 'Semifinals';
      round.winningSets = semifinals;
    }
  }

  // add the finals match
  bracket.winners.push({
    name: 'Finals',
    matches: [{teams: []}],
    winningSets: finals,
  });

  // generate losers bracket
  let loserTracker = round1Matches / 2;
  let loserRound = 1;
  while (loserTracker > 0) {
    const round = {
      name: `Losers Round ${loserRound}`,
      matches: [],
      winningSets: losers,
    };

    for (let i = 0; i < loserTracker; i++) {
      round.matches.push({
        teams: [],

        // every other match doesn't need the right border, because we're
        // drawing a straight line to the next match in the following round
        // where the number of matches is the same as this round. See comment
        // below on loserTracker
        noRightBorder: loserRound % 2 > 0
      });
    }

    bracket.losers.push(round);

    // loser bracket has two rounds in a row with the same number of matches
    // this is to make way for the losers dropping in from the winner's bracket
    loserTracker =
        loserRound % 2 > 0 ? loserTracker : Math.floor(loserTracker / 2);
    loserRound++;

    // the last round before we break out of the loop is the semifinals match
    if (loserTracker === 0) {
      round.name = 'Semifinals';
      round.winningSets = semifinals;
    }
  }

  return bracket;
}

/**
 * Generate the placeholders for a given bracket in place
 * @param bracket
 */
function generatePlaceholders(bracket: IDoubleEliminationBracket) {
  let winnerRound = 0;
  let loserRound = 0;
  let matchNumber = 1;

  while (winnerRound < bracket.winners.length ||
         loserRound < bracket.losers.length) {
    if (winnerRound < bracket.winners.length) {
      bracket.winners[winnerRound].matches.forEach(match => {
        match.number = matchNumber++;  // increment after setting
        match.bye =
            match.teams.length === 1;  // set a bye boolean for base round
        match.final = winnerRound + 1 === bracket.winners.length;

        if (match.final) {
          match.lobby = 'finals';
        }

        match.teams = generateWinningPlaceholder(match, match.final);
      });
      winnerRound++;
    }

    if (loserRound < bracket.losers.length) {
      bracket.losers[loserRound].matches.forEach((match, index) => {
        match.number = matchNumber++;  // increment after setting
        match.teams = generateLosingPlaceholder(bracket, loserRound, index);
      });
      loserRound++;

      // to try to keep the match numbers matching down the tournament,
      if (loserRound > 1 && loserRound % 2 === 1 &&
          loserRound < bracket.losers.length) {
        bracket.losers[loserRound].matches.forEach((match, index) => {
          match.number = matchNumber++;  // increment after setting
          match.teams = generateLosingPlaceholder(bracket, loserRound, index);
        });
        loserRound++;
      }
    }
  }
}

function generateWinningPlaceholder(
    match: IBracketMatch,
    final: boolean,
    ): IMatchTeam[] {
  if (final) {
    return [{}, {placeholder: 'Winner of loser\'s bracket'}];
  } else if (match.teams.length === 0) {
    return [{}, {}];
  } else {
    return match.teams;
  }
}

function generateLosingPlaceholder(
    bracket: IDoubleEliminationBracket,
    loserRound: number,
    index: number,
    ): IMatchTeam[] {
  // every other round we pull losers down from the winner's bracket
  if (loserRound === 0) {
    let one = (index * 2);
    let oneBye = bracket.winners[loserRound].matches[one].bye;
    let two = ((index * 2) + 1);
    let twoBye = bracket.winners[loserRound].matches[two].bye

    return [
      {placeholder: oneBye ? 'Bye' : 'Loser of ' + (one + 1)},
      {placeholder: twoBye ? 'Bye' : 'Loser of ' + (two + 1)}
    ];
  } else if (loserRound % 2 === 1) {
    return [
      {}, {
        placeholder:
            'Loser of ' + getMatchNumberForLoser(bracket, loserRound, index)
      }
    ];
  } else {
    return [{}, {}];
  }
}

/**
 * Retrive the match number of the match in the winner's bracket that the loser
 * will come down from This match will be from the round in the winner's bracket
 * with the same number of matches The match will be the
 */
function getMatchNumberForLoser(
    bracket: IDoubleEliminationBracket,
    loserRound: number,
    index: number,
    ): number {
  // determine the number of matches in this round of the losers bracket
  const matchesInRound = bracket.losers[loserRound].matches.length;

  // use that to find the round in the winner's bracket with that number of
  // matches this will be the round where the losers drop down
  let winnerRound = 0;
  while (bracket.winners[winnerRound].matches.length > matchesInRound) {
    winnerRound++;
  }

  // every other losing bracket round we want to swap whether we're reversing
  // the matches being brought down this is to keep the different sides of the
  // bracket playing each other back and forth
  if ((loserRound + 1) % 4 > 0) {
    index = matchesInRound - index - 1;
  }

  // now select the match number from that corresponding match in the winner's
  // bracket
  return map(bracket.winners[winnerRound].matches, 'number')[index];
}

/**
 * Return the number of matches in the first round of the winners bracket from
 * the total number of teams
 */
function determineRound1Matches(teamsLength: number, matches = 1): number {
  if (matches * 2 >= teamsLength) {
    return matches;
  } else {
    return determineRound1Matches(teamsLength, matches * 2);
  }
}

/**
 * Return a list of seeds positions for a given number of participants
 */
function getSeeds(participantsCount: number) {
  if (participantsCount < 2) {
    return [];
  }

  let matches = [[1, 2]];
  const rounds = Math.ceil(Math.log(participantsCount) / Math.log(2));

  for (let round = 1; round < rounds; round++) {
    const roundMatches = [];
    const sum = Math.pow(2, round + 1) + 1;

    for (var i = 0; i < matches.length; i++) {
      let home = changeIntoBye(matches[i][0], participantsCount);
      let away = changeIntoBye(sum - matches[i][0], participantsCount);
      roundMatches.push([home, away]);
      home = changeIntoBye(sum - matches[i][1], participantsCount);
      away = changeIntoBye(matches[i][1], participantsCount);
      roundMatches.push([home, away]);
    }
    matches = roundMatches;
  }

  return matches;
}

/**
 * Return either a seed number or a bye for a round
 */
function changeIntoBye(seed: number, participantsCount: number): number|null {
  return seed <= participantsCount ? seed : null;
}