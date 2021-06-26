import * as admin from 'firebase-admin';
import {DocumentSnapshot} from 'firebase-functions/lib/providers/firestore';
import {flatten} from 'lodash';

import {IDynamicDYPEvent, IDynamicDYPMatch, MatchStatus} from '../../../types';

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
    // determine which players are ready to play the next match and set the
    // match statuses
    await crawlRounds(snapshot, event);

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

async function crawlRounds(
    snapshot: DocumentSnapshot, event: IDynamicDYPEvent) {
  const playersSet = new Set<string>();

  for (const round of event.rounds ?? []) {
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
          await setMatchReady(snapshot, match);
        }

        // if the match is ready, see if it's over
        if (match.status === MatchStatus.READY) {
          const matchResults = event.results[String(match.number)] || {};
          const {team1Score = 0, team2Score = 0} = matchResults;

          match.teams[0].score = team1Score;
          match.teams[1].score = team2Score;

          // TODO: un-hardcode this "play 3 games"
          if (team1Score + team2Score === 3) {
            await setMatchComplete(snapshot, match);
          }
        }
      }

      // complete the round when every match is completed
      round.complete = round.matches.every(match => {
        return match.status === MatchStatus.COMPLETE;
      });
    }
  }
}

async function setMatchReady(
    snapshot: DocumentSnapshot,
    match: IDynamicDYPMatch,
) {
  match.status = MatchStatus.READY;
  try {
    const now = Date.now();
    await snapshot.ref.collection('dyp-matches')
        .doc(String(match.number))
        .create({
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
    match: IDynamicDYPMatch,
) {
  match.status = MatchStatus.COMPLETE;
  try {
    await snapshot.ref.collection('dyp-matches')
        .doc(String(match.number))
        .update({
          ...match,
          updated: Date.now(),
        });
  } catch (e) {
    // when we cannot set matches as complete, it's because they were never
    // started in the first place, meaning it was probably a bye
  }
}