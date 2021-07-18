import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {DocumentSnapshot} from 'firebase-functions/lib/providers/firestore';
import {flatten} from 'lodash';

import {GeneralsServer} from '../../../../constants';
import {GameSpeed, IArenaEvent, IBracketMatchDocument, IGeneralsReplay, MatchStatus} from '../../../../types';
import {getReplaysForUsername} from '../../util/generals';
import * as simulator from '../../util/simulator';
import {getFinishedTime, timeoutAfter} from '../../util/util';

try {
  admin.initializeApp();
} catch (e) {
  // do nothing, this is fine
}
const db = admin.firestore();

/**
 * This function is responsible for looking for finished games within a match in
 * a double elimination bracket. When games complete, we will parse the replay
 * to determine who won and increment the score of the winning team
 */
export const onWriteMatch =
    functions.firestore.document('events/{eventId}/matches/{matchId}')
        .onWrite(async (matchDoc, context) => {
          if (matchDoc.after.exists) {
            const eventRef = matchDoc.after.ref.parent.parent!;

            try {
              await lookForFinishedGame(matchDoc.after, eventRef);
            } catch (error) {
              console.log(matchDoc.after.id, error);
              await keepLookingIn10Seconds(matchDoc.after);
            }
          }
          return 'Done';
        });

async function lookForFinishedGame(
    snapshot: DocumentSnapshot,
    eventRef: admin.firestore.DocumentReference,
    ): Promise<any> {
  const match = (snapshot.data() || {}) as IBracketMatchDocument;
  const {players, status, started} = match;

  console.log(`looking for finished game ${snapshot.id} with players ${
      players?.join(', ')}`);

  // if we have a match with some players, and it is not complete,
  // find games for these players
  if (status === MatchStatus.READY && players?.length) {
    // get list of tracked replays for a event
    const eventSnap = await eventRef.get();
    const event = (eventSnap.data() || {}) as IArenaEvent;
    const trackedReplays = event.replays || [];

    console.log(`${trackedReplays.length} tracked replays for ${eventSnap.id}`);

    // wait for all of those replays to load so we can compare those replays to
    // see if they're the same
    const replays = await getReplaysForPlayers(
        players, trackedReplays, started, event.server);

    console.log('got all replays for players')

    const {count, replay} = getMostPrevalentReplay(replays);
    if (replay) {
      console.log(`${replay.id} is shared by ${count} of the ${
          players.length} players`);
    }

    if (count > players.length / 2) {
      // if over half (but not exactly half) of the og players were in this
      // game, and we have not tracked it already, count the game
      await saveReplayToMatch(replay, snapshot, eventRef, event);
    } else {
      // otherwise, gotta keep looking, start in 10 seconds
      await keepLookingIn10Seconds(snapshot);
    }
  }
}

/**
 * Given the list of usernames, get the last 10 replays for each of them, and
 * then return a list of the replays that:
 * 1) aren't already tracked on this event
 * 2) started after this lobby was created
 * 3) the replay has <= the # of usernames in this game
 *
 * @param usernames
 * @param trackedReplays
 * @param gameStarted
 * @param server
 */
async function getReplaysForPlayers(
    usernames: string[],
    trackedReplays: string[],
    gameStarted: number,
    server = GeneralsServer.NA,
    ): Promise<IGeneralsReplay[]> {
  // for each player, request their latest 10 replays
  const replayPromises: Promise<IGeneralsReplay[]>[] =
      usernames.map(name => getReplaysForUsername(name, 0, 10, server));

  // wait for all requests to come back or timeout after 10 seconds
  const replays = await Promise.race([
    Promise.all(replayPromises),
    timeoutAfter(10000, []),
  ]);

  return flatten(replays).filter(replay => {
    // replays must exist, not already be tracked, and have to start
    // after this game was created in the database
    return replay && !trackedReplays.includes(replay.id) &&
        replay.started > gameStarted &&
        replay.ranking.length <= usernames.length;
  });
}

/**
 * Given a list of replays for the players in this game, return the replay that
 * is most prevalent in this list, along with the number of times it is seen
 * @param replays
 */
function getMostPrevalentReplay(replays: IGeneralsReplay[]):
    {count: number, replay: IGeneralsReplay} {
  // build up a map of the present replays and their counts
  const replayCounts = new Map<string, {
    replay: IGeneralsReplay,
    count: number,
  }>();
  console.log(`loaded ${replays.length} replays`);
  replays.forEach(replay => {
    const {count} = (replayCounts.get(replay.id) || {count: 0});
    replayCounts.set(replay.id, {replay, count: count + 1});
  });

  // determine which replay has the most shared players
  let most = {count: 0, replay: replays[0]};
  for (const entry of replayCounts.values()) {
    const {count, replay} = entry;
    if (count > most.count) {
      most = {count, replay};
    }
  }

  return most;
}

async function saveReplayToMatch(
    replay: IGeneralsReplay,
    matchSnapshot: DocumentSnapshot,
    eventRef: admin.firestore.DocumentReference,
    event: IArenaEvent,
    ): Promise<void> {
  const {number, teams} = matchSnapshot.data() as IBracketMatchDocument;

  const batch = db.batch();
  batch.update(eventRef, {
    replays: admin.firestore.FieldValue.arrayUnion(replay.id),
    completedGameCount: admin.firestore.FieldValue.increment(1),
  });

  console.log(`getting replay stats for ${replay.id}`);

  // pull down the replay and save it to the game doc
  const {scores, summary, turns} =
      await simulator.getReplayStats(replay.id, event.server);
  const winner = scores[0];

  // determine which team won and increment the score of that team
  const winningIndex = teams.findIndex(team => {
    return team.players?.includes(winner.name);
  });
  const teamToIncrement = winningIndex === 0 ? 'team1Score' : 'team2Score';
  console.log(`incrementing team ${teamToIncrement} for match ${number}`);
  batch.update(eventRef, {
    [`bracket.results.${number}.${teamToIncrement}`]:
        admin.firestore.FieldValue.increment(1)
  });

  // save the replay to the match doc
  const speed = event.options?.speed ?? GameSpeed.SPEED_1X;
  batch.update(matchSnapshot.ref, {
    updated: Date.now(),
    replays: admin.firestore.FieldValue.arrayUnion({
      replayId: replay.id,
      started: replay.started,
      finished: getFinishedTime(replay.started, turns, speed),
      replay: {scores, summary, turns},
    }),
  });

  for (const player of scores) {
    // determine if this player is in the event
    const playerRef = eventRef.collection('players').doc(player.name);
    const playerDoc = await playerRef.get();
    if (!playerDoc.exists) continue;

    const opponents = teams.filter(team => !team.players?.includes(player.name))
                          .map(team => team.name);

    // update the rank to either be 1 or 2 for dyp
    if (teams[winningIndex].players?.includes(player.name)) {
      player.rank = 1;

      // set the lastTurn for each of the winners to be the max between the two
      // for the purpose of showing an accurate quickest win stat
      const lastTurns =
          scores.filter(s => teams[winningIndex].players?.includes(s.name))
              .map(s => s.lastTurn);
      player.lastTurn = Math.max(...lastTurns);
    } else {
      player.rank = 2;
    }

    // determine finished for this player based on their last turn
    const record = {
      replayId: replay.id,
      started: replay.started,
      finished: getFinishedTime(replay.started, player.lastTurn, speed),
      ...player,

      // TODO make this an offical object at some point
      opponents,
    };

    // update the player's points, streak, and record on the leaderboard
    batch.update(playerRef, {
      record: admin.firestore.FieldValue.arrayUnion(record),
    });
  }

  console.log('committing...');
  await batch.commit();
  console.log('done!');
}

function keepLookingIn10Seconds(snapshot: DocumentSnapshot): Promise<void> {
  return new Promise(resolve => {
    setTimeout(async () => {
      await snapshot.ref.update({
        timesChecked: admin.firestore.FieldValue.increment(1),
      })
      resolve();
    }, 10000);
  });
}