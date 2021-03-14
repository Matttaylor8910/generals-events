import {DocumentSnapshot} from 'firebase-functions/lib/providers/firestore';
import {cloneDeep, map} from 'lodash';

import {IBracketMatch, IDoubleElimEvent, IDoubleEliminationBracket, IMatchTeam, MatchStatus, MatchTeamStatus} from '../../../types';

type BracketName = 'winners'|'losers';

const TODO_WINNING_SETS = 2;

export async function handleDoubleElimEventUpdate(
    snapshot: DocumentSnapshot, eventId: string): Promise<void> {
  const event = snapshot.data() as IDoubleElimEvent;

  if (event?.bracket) {
    crawlTournament(event.bracket);
    await snapshot.ref.update({bracket: event.bracket});
  }
}

/**
 * Crawl both sides of the tournament for updates and post back to firebase
 */
export function crawlTournament(bracket: IDoubleEliminationBracket) {
  crawlBracket(bracket, 'winners');
  crawlBracket(bracket, 'losers');
}

/**
 * Crawl through every round in the bracket to see if any matches
 * need to be updated or players need to advance
 */
function crawlBracket(
    bracket: IDoubleEliminationBracket,
    bracketName: BracketName,
) {
  bracket[bracketName].forEach((round, roundIdx) => {
    if (!round.complete) {
      round.matches.forEach((match, matchIdx) => {
        switch (match.status) {
          case MatchStatus.COMPLETE:
            break;
          case MatchStatus.READY:
            checkupOnMatch(bracket, match, roundIdx, matchIdx, bracketName);
            break;
          default:
            determineReadyMatch(
                bracket, match, roundIdx, matchIdx, bracketName);
        }
      });

      // determine if the whole round is complete
      round.complete =
          round.matches.every(match => match.status === MatchStatus.COMPLETE);
    }
  });
}

/**
 * Determine if a match is ready to start or if byes/players need to progress
 */
function determineReadyMatch(
    bracket: IDoubleEliminationBracket,
    match: IBracketMatch,
    roundIdx: number,
    matchIdx: number,
    bracketName: BracketName,
) {
  // if bye, advance the only team to the next match
  if (match.bye) {
    const advanceTeam =
        !match.teams[0].placeholder ? match.teams[0] : match.teams[1];
    advanceWinningTeam(bracket, advanceTeam, roundIdx, matchIdx, bracketName);

    if (!advanceTeam.placeholder) {
      advanceTeam.status = MatchTeamStatus.WINNER;
    }

    match.status = MatchStatus.COMPLETE;
  }

  // if there are two teams ready to play, start em up
  else if (hasTwoTeams(match)) {
    match.status = MatchStatus.READY;
  }

  else if (byebye(match)) {
    match.bye = true;
  }
}

/**
 * Return true if the match is two byes
 */
function byebye(match: IBracketMatch):
    boolean{return match.teams &&
            match.teams.length === 2 &&  // two teams #wedontfuckaround
            match.teams[0].placeholder === 'Bye' &&
            match.teams[1].placeholder === 'Bye'}

/**
 * Return true if the match has two teams
 */
function hasTwoTeams(match: IBracketMatch):
    boolean {
      return match.teams.length === 2 &&
          (match.teams[0].name?.length || 0) > 0 &&
          (match.teams[1].name?.length || 0) > 0;
    }

/**
 * If the match was ready, we can make the assumption that there are two
 * teams. Determine if the match is over and if we need to move players around
 */
function checkupOnMatch(
    bracket: IDoubleEliminationBracket,
    match: IBracketMatch,
    roundIdx: number,
    matchIdx: number,
    bracketName: BracketName,
) {
  const team1Score = match.teams[0].score || 0;
  const team2Score = match.teams[1].score || 0;

  // if team1 has won, end the match and advance
  if (team1Score >= TODO_WINNING_SETS) {
    advancePlayers(
        bracket, match, match.teams[0], match.teams[1], roundIdx, matchIdx,
        bracketName);
  } else if (team2Score >= TODO_WINNING_SETS) {
    advancePlayers(
        bracket, match, match.teams[1], match.teams[0], roundIdx, matchIdx,
        bracketName);
  }
}

/**
 * Advance players after a match is completed
 */
function advancePlayers(
    bracket: IDoubleEliminationBracket,
    match: IBracketMatch,
    winningTeam: IMatchTeam,
    losingTeam: IMatchTeam,
    roundIdx: number,
    matchIdx: number,
    bracketName: BracketName,
) {
  match.status = MatchStatus.COMPLETE;
  winningTeam.status = MatchTeamStatus.WINNER;
  losingTeam.status = MatchTeamStatus.LOSER;

  // end the tournament or do a finals rematch
  if (match.final) {
    // the player(s) in the kings seat lost
    const needsRematch = losingTeam.name === match.teams[0].name;

    if (needsRematch) {
      // setup the new finals match
      const finalFinal = cloneDeep(match);
      finalFinal.teams.forEach(team => {
        team.score = 0;
        team.status = MatchTeamStatus.UNDECIDED;
      });
      finalFinal.number = match.number + 1;
      finalFinal.status = MatchStatus.READY;

      // get it started
      bracket.winners[roundIdx].matches.push(finalFinal);

      // strip the old finals match of its gold border
      match.final = false;
    } else {
      endTournament();
    }
  }

  // if not the finals, just advance players
  else {
    advanceWinningTeam(bracket, winningTeam, roundIdx, matchIdx, bracketName);
    advanceLosingTeam(bracket, losingTeam, roundIdx, matchIdx, bracketName);
  }
}

/**
 * Pass the winning team along to their next match and reset their score for the
 * new match
 */
function advanceWinningTeam(
    bracket: IDoubleEliminationBracket,
    team: IMatchTeam,
    roundIdx: number,
    matchIdx: number,
    bracketName: BracketName,
) {
  const currentRound = bracket[bracketName][roundIdx];
  const nextRound = bracket[bracketName][roundIdx + 1];

  // clone the team and reset the values pertaining to this team
  const thisTeam: IMatchTeam = cloneDeep(team);
  thisTeam.status = MatchTeamStatus.UNDECIDED;
  thisTeam.score = 0;

  // only try to move the winner forward if there is a next round
  if (nextRound) {
    if (currentRound.matches.length === nextRound.matches.length) {
      nextRound.matches[matchIdx].teams[0] = thisTeam;
    } else {
      nextRound.matches[Math.floor(matchIdx / 2)].teams[matchIdx % 2] =
          thisTeam;
    }
  }

  // if we're in the loser's bracket, we need to pop up to the finals match
  else if (bracketName === 'losers') {
    const winnerRounds = bracket.winners.length;

    // find the finals match (last match in the last round) and send them up!
    bracket.winners[winnerRounds - 1].matches[0].teams[1] = thisTeam;
  }
}

/**
 * Pass the losing team to the right spot in the loser's bracket, or eliminate
 * them
 */
function advanceLosingTeam(
    bracket: IDoubleEliminationBracket,
    team: IMatchTeam,
    roundIdx: number,
    matchIdx: number,
    bracketName: BracketName,
) {
  // if the team lost in the loser bracket, nothing to do but eliminate
  if (bracketName === 'losers') {
    team.status = MatchTeamStatus.ELIMINATED;
  }

  // otherwise bring those losers from the winner's bracket to the loser's
  // bracket
  else {
    // clone the team and reset values
    const thisTeam: IMatchTeam = cloneDeep(team);
    thisTeam.status = MatchTeamStatus.UNDECIDED;
    thisTeam.score = 0;

    const loserMatch = getLoserMatchToGoTo(bracket, roundIdx, matchIdx);

    // first round puts players in alternating positions
    // all other rounds bring the loser down to be the second team
    const teamIdx = roundIdx === 0 ? matchIdx % 2 : 1;
    loserMatch.teams[teamIdx] = thisTeam;

    // if there is a Bye placeholder, then mark the match as a bye
    loserMatch.bye = map(loserMatch.teams, 'placeholder').includes('Bye');
  }
}

/**
 * Determine which match a team should play in next after losing
 */
function getLoserMatchToGoTo(
    bracket: IDoubleEliminationBracket,
    roundIdx: number,
    matchIdx: number,
    ):
    IBracketMatch {
      let loserRound;

      // round 0 just joins match losers from winner round 0 into matches
      if (roundIdx === 0) {
        loserRound = bracket.losers[0];
        return loserRound.matches[Math.floor(matchIdx / 2)];
      }

      // later losers from the winner's bracket need to figure out where to go
      else {
        const loserRoundIdx = (roundIdx * 2) - 1;
        loserRound = bracket.losers[loserRoundIdx];

        // determine if we are going to be reversing the losers in this round
        const loserMatchIdx = (loserRoundIdx + 1) % 4 > 0 ?
            loserRound.matches.length - (matchIdx + 1) :
            matchIdx;

        return loserRound.matches[loserMatchIdx];
      }
    }

function
endTournament() {
  console.log('TODO');
}