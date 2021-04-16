import * as admin from 'firebase-admin';
import {DocumentSnapshot} from 'firebase-functions/lib/providers/firestore';
import {IDynamicDYPEvent, MatchStatus} from '../../../types';

try {
  admin.initializeApp();
} catch (e) {
  // do nothing, this is fine
}
// const db = admin.firestore();

export async function handleDynamicDYPUpdate(snapshot: DocumentSnapshot):
    Promise<void> {
  const event = snapshot.data() as IDynamicDYPEvent;

  if (event?.rounds && !event.endTime) {
    // or each player
    // - look at their schedule
    // - determine first non-completed game
    //   - array join their name in ready
    setReadyPlayers(event);

    // for each match
    // - if a match is not complete, and it has 4 ready players
    //   - set to ready
    //   - generate new match
    //     - this match will continuously look for completed games
    // - pull score from map
    // - if 3 games have been played (scores added together === 3)
    //   - set match to complete
    //   - update player stats

    // for each round
    // - round.complete = matches.every(m => m.complete)

    const updates: {[key: string]: any} = {
      'rounds': event.rounds,
    };

    // const prelimsDone = event.rounds.every(round => round.complete);


    // if (eventOver) {
    //   // find the winner of the finals match
    //   const finals = event.bracket.winners[event.bracket.winners.length - 1];
    //   const lastMatch = finals.matches[finals.matches.length - 1];
    //   const winner = lastMatch.teams.find(t => t.score ===
    //   finals.winningSets);

    //   // set the winner and endTime
    //   updates.winners = [winner!.name];
    //   updates.endTime = Date.now();
    // }

    await snapshot.ref.update(updates);
  }
}

function setReadyPlayers(event: IDynamicDYPEvent) {
  const playersSet = new Set<string>();

  for (const round of event.rounds) {
    if (!round.complete) {
      for (const match of round.matches) {
        // determine which players are ready for non-complete games
        if (match.status !== MatchStatus.COMPLETE) {
          for (const team of match.teams) {
            for (const player of team.players) {
              // only set this player is ready for match if:
              // - it's in a non-completed round
              // - it's in a non-completed match
              // - this is the first match this player is ready for
              // - this match doesn't already have this player set to ready
              if (!playersSet.has(player)) {
                playersSet.add(player);

                if (!match.ready.includes(player)) {
                  match.ready.push(player);
                }
              }
            }
          }
        }

        // if all players are ready, update the match status
        if (match.status === MatchStatus.NOT_STARTED &&
            match.ready.length === 4) {
          match.status = MatchStatus.READY;
        }

        // if the match is ready, see if it's over
        if (match.status === MatchStatus.READY) {
          const matchResults = event.results[String(match.number)] || {};
          const {team1Score = 0, team2Score = 0} = matchResults;

          match.teams[0].score = team1Score;
          match.teams[1].score = team2Score;

          // TODO: un-hardcode this "play 3 games"
          if (team1Score + team2Score === 3) {
            match.status = MatchStatus.COMPLETE;
          }
        }
      }
    }
  }
}