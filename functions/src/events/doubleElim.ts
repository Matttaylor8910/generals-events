import {DocumentSnapshot} from 'firebase-functions/lib/providers/firestore';
import {cloneDeep, flatten, map} from 'lodash';

import {IBracketMatch, IDoubleElimEvent, IDoubleEliminationBracket, IMatchTeam, MatchStatus, MatchTeamStatus} from '../../../types';

type BracketName = 'winners'|'losers';

export async function handleDoubleElimEventUpdate(snapshot: DocumentSnapshot):
    Promise<void> {
  const event = snapshot.data() as IDoubleElimEvent;

  if (event?.bracket && !event.endTime) {
    const eventOver = await crawlTournament(snapshot, event.bracket);

    const updates: {[key: string]: any} = {
      'bracket.winners': event.bracket.winners,
      'bracket.losers': event.bracket.losers,
    };

    if (eventOver) {
      // find the winner of the finals match
      const finals = event.bracket.winners[event.bracket.winners.length - 1];
      const lastMatch = finals.matches[finals.matches.length - 1];
      const winner = lastMatch.teams.find(t => t.score === finals.winningSets);

      // set the winner and endTime
      updates.winners = winner?.players ?? [];
      updates.endTime = Date.now();
    }

    await snapshot.ref.update(updates);
  }
}

/**
 * Crawl both sides of the bracket for updates and post back to firebase
 */
async function crawlTournament(
    snapshot: DocumentSnapshot,
    bracket: IDoubleEliminationBracket,
) {
  const eventOver = await crawlBracket(snapshot, bracket, 'winners');
  await crawlBracket(snapshot, bracket, 'losers');

  return eventOver;
}

/**
 * Crawl through every round in the bracket to see if any matches
 * need to be updated or players need to advance
 */
async function crawlBracket(
    snapshot: DocumentSnapshot,
    bracket: IDoubleEliminationBracket,
    bracketName: BracketName,
) {
  let eventOver = false;
  const rounds = bracket[bracketName];

  for (let roundIdx = 0; roundIdx < rounds.length; roundIdx++) {
    const round = rounds[roundIdx];
    if (!round.complete) {
      for (let matchIdx = 0; matchIdx < round.matches.length; matchIdx++) {
        const match = round.matches[matchIdx];
        switch (match.status) {
          case MatchStatus.COMPLETE:
            break;
          case MatchStatus.READY:
            eventOver = await checkupOnMatch(
                snapshot, bracket, match, roundIdx, matchIdx, bracketName,
                round.winningSets);
            break;
          default:
            await determineReadyMatch(
                snapshot,
                bracket,
                match,
                roundIdx,
                matchIdx,
                bracketName,
            );
        }
      }

      // determine if the whole round is complete
      round.complete =
          round.matches.every(match => match.status === MatchStatus.COMPLETE);
    }
  }

  return eventOver;
}

/**
 * Determine if a match is ready to start or if byes/players need to progress
 */
async function determineReadyMatch(
    snapshot: DocumentSnapshot,
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

    await setMatchComplete(snapshot, match);
  }

  // if there are two teams ready to play, start em up
  else if (hasTwoTeams(match)) {
    await setMatchReady(snapshot, match);
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
          (match.teams[0].players?.length ?? 0) > 0 &&
          (match.teams[1].players?.length ?? 0) > 0;
    }

/**
 * If the match was ready, we can make the assumption that there are two
 * teams. Determine if the match is over and if we need to move players around
 * Return true if the event is over
 */
function checkupOnMatch(
    snapshot: DocumentSnapshot,
    bracket: IDoubleEliminationBracket,
    match: IBracketMatch,
    roundIdx: number,
    matchIdx: number,
    bracketName: BracketName,
    winningSets: number,
) {
  const matchResults = bracket.results[String(match.number)] || {};
  const {team1Score = 0, team2Score = 0} = matchResults;

  match.teams[0].score = team1Score;
  match.teams[1].score = team2Score;

  // if team1 has won, end the match and advance
  if (team1Score >= winningSets) {
    return advancePlayers(
        snapshot, bracket, match, match.teams[0], match.teams[1], roundIdx,
        matchIdx, bracketName);
  } else if (team2Score >= winningSets) {
    return advancePlayers(
        snapshot, bracket, match, match.teams[1], match.teams[0], roundIdx,
        matchIdx, bracketName);
  }

  // event is still going
  return Promise.resolve(false);
}

/**
 * Advance players after a match is completed
 * Return true if the event is over
 */
async function advancePlayers(
    snapshot: DocumentSnapshot,
    bracket: IDoubleEliminationBracket,
    match: IBracketMatch,
    winningTeam: IMatchTeam,
    losingTeam: IMatchTeam,
    roundIdx: number,
    matchIdx: number,
    bracketName: BracketName,
) {
  await setMatchComplete(snapshot, match);
  winningTeam.status = MatchTeamStatus.WINNER;
  losingTeam.status = MatchTeamStatus.LOSER;

  // end the event or do a finals rematch
  if (match.final) {
    // the player(s) in the kings seat lost
    const winnersBracketWinnerLost = losingTeam.name === match.teams[0].name;

    // #71 there should only ever be two finals matches
    const finalsRound = bracket.winners[bracket.winners.length - 1];
    const isFirstFinal = finalsRound.matches.length === 1;

    if (winnersBracketWinnerLost && isFirstFinal) {
      // setup the new finals match
      const finalFinal = cloneDeep(match);
      finalFinal.teams.forEach(team => {
        team.score = 0;
        team.status = MatchTeamStatus.UNDECIDED;
      });
      finalFinal.number = match.number + 1;
      await setMatchReady(snapshot, finalFinal);

      // get it started
      bracket.winners[roundIdx].matches.push(finalFinal);

      // strip the old finals match of its gold border
      match.final = false;
    } else {
      winningTeam.players?.forEach(async player => {
        await setRank(snapshot, player, 1);
      });
      losingTeam.players?.forEach(async player => {
        await setRank(snapshot, player, 2);
      });
      return true;
    }
  }

  // if not the finals, just advance players
  else {
    advanceWinningTeam(bracket, winningTeam, roundIdx, matchIdx, bracketName);
    await advanceLosingTeam(
        snapshot, bracket, losingTeam, roundIdx, matchIdx, bracketName);
  }

  // event is still going
  return false;
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
async function advanceLosingTeam(
    snapshot: DocumentSnapshot,
    bracket: IDoubleEliminationBracket,
    team: IMatchTeam,
    roundIdx: number,
    matchIdx: number,
    bracketName: BracketName,
) {
  // if the team lost in the loser bracket, nothing to do but eliminate
  if (bracketName === 'losers') {
    team.status = MatchTeamStatus.ELIMINATED;

    // this was the loser of the loser's bracket semifinal, they placed 3rd
    if (bracket[bracketName].length === roundIdx + 1) {
      team.players?.forEach(async player => {
        await setRank(snapshot, player, 3);
      });
    }
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

async function setMatchReady(
    snapshot: DocumentSnapshot,
    match: IBracketMatch,
) {
  match.status = MatchStatus.READY;
  try {
    const now = Date.now();
    await snapshot.ref.collection('matches').doc(String(match.number)).create({
      ...match,
      players: flatten(match.teams.map(team => team.players)),
      started: now,
      updated: now,
    });
  } catch (e) {
    // do nothing, it's already created
  }
}

async function setMatchComplete(
    snapshot: DocumentSnapshot,
    match: IBracketMatch,
) {
  match.status = MatchStatus.COMPLETE;
  try {
    await snapshot.ref.collection('matches').doc(String(match.number)).update({
      ...match,
      updated: Date.now(),
    });
  } catch (e) {
    // when we cannot set matches as complete, it's because they were never
    // started in the first place, meaning it was probably a bye
  }
}

function setRank(snapshot: DocumentSnapshot, name: string, rank: number) {
  return snapshot.ref.collection('players').doc(name).update({rank});
}