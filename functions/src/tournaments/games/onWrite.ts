import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {DocumentSnapshot} from 'firebase-functions/lib/providers/firestore';
import {flatten} from 'lodash';

import {GeneralsServer} from '../../../../constants';
import {GameStatus, IGame, IGeneralsReplay, ITournament} from '../../../../types';
import {getReplaysForUsername} from '../../util/api';
import * as simulator from '../../util/simulator';

try {
  admin.initializeApp();
} catch (e) {
  console.log(e);
}
const db = admin.firestore();

export const onWriteGame =
    functions.firestore.document('tournaments/{tourneyId}/games/{gameId}')
        .onWrite(async (gameDoc, context) => {
          if (gameDoc.after.exists) {
            await lookForFinishedGame(gameDoc.after);
          }
          return 'Done';
        });

async function lookForFinishedGame(snapshot: DocumentSnapshot): Promise<any> {
  const game = (snapshot.data() || {}) as IGame;
  const {players} = game;
  const timesChecked = game.timesChecked || 0;
  const TWENTY_MINUTES = 120;  // 120 * 10 = 1200 -> 20 minutes (in seconds)

  // if we still haven't found a replay within 20 minutes, pull the plug
  if (timesChecked >= TWENTY_MINUTES) {
    return await snapshot.ref.delete();
  }

  // if we have a game with some players, and we haven't set a replayId yet,
  // find games for these players
  if (!game.replayId && players?.length) {
    // get list of tracked replays for a tournament
    const tournamentSnap = await snapshot.ref.parent.parent!.get();
    const tournament = (tournamentSnap.data() || {}) as ITournament;
    const trackedReplays = tournament.replays || [];

    console.log(`tracked replays for ${tournamentSnap.id}:`, trackedReplays);

    // wait for all of those replays to load so we can compare those replays to
    // see if they're the same
    const replayIds = await getReplayIdsForPlayers(
        players,
        tournament.replays,
        game.started,
        tournament.server,
    );

    const {count, replayId} = getMostPrevalentReplay(replayIds);
    console.log(
        `${replayId} is shared by ${count} of the ${players.length} players`);

    if (count > players.length / 2) {
      // if over half (but not exactly half) of the og players were in this
      // game, and we have not tracked it already, count the game
      await saveReplayToGame(
          replayId,
          snapshot,
          tournamentSnap.ref,
          tournament.server,
      );
    } else {
      // otherwise, gotta keep looking, start in 10 seconds
      await keepLookingIn10Seconds(snapshot);
    }
  }
}

/**
 * Given the list of usernames, get the last 10 replays for each of them, and
 * then return a list of the replayIds for the replays that:
 * 1) aren't already tracked on this tournament
 * 2) started after this lobby was created
 * 3) the replay has <= the # of usernames in this game
 *
 * @param usernames
 * @param trackedReplays
 * @param gameStarted
 * @param server
 */
async function getReplayIdsForPlayers(
    usernames: string[],
    trackedReplays: string[],
    gameStarted: number,
    server = GeneralsServer.NA,
    ): Promise<string[]> {
  // for each player, request their latest 10 replays
  const replayPromises: Promise<IGeneralsReplay[]>[] =
      usernames.map(name => getReplaysForUsername(name, 0, 10, server));

  // wait for all requests to come back
  const replays = await Promise.all(replayPromises);

  return flatten(replays)
      .filter(replay => {
        // replays must exist, not already be tracked, and have to start
        // after this game was created in the database
        return replay && !trackedReplays.includes(replay.id) &&
            replay.started > gameStarted &&
            replay.ranking.length <= usernames.length;
      })
      .map(replay => replay.id);
}

/**
 * Given a list of ids for replays for the players in this game, return the
 * replayId that is most prevalent in this list, along with the number of times
 * it is seen
 * @param replayIds
 */
function getMostPrevalentReplay(replayIds: string[]):
    {count: number, replayId: string} {
  // build up a map of the present replayIds and their counts
  const replayCounts = new Map<string, number>();
  console.log(`loaded ${replayIds.length} replays`);
  replayIds.forEach(replayId => {
    replayCounts.set(replayId, (replayCounts.get(replayId) || 0) + 1);
  });

  // determine which replay has the most shared players
  let most = {count: 0, replayId: ''};
  for (const entry of replayCounts.entries()) {
    const [replayId, count] = entry;
    if (count > most.count) {
      most = {count, replayId};
    }
  }

  return most;
}

async function saveReplayToGame(
    replayId: string,
    gameSnapshot: DocumentSnapshot,
    tournamentRef: admin.firestore.DocumentReference,
    server = GeneralsServer.NA,
    ): Promise<void> {
  const batch = db.batch();
  batch.update(tournamentRef, {
    replays: admin.firestore.FieldValue.arrayUnion(replayId),
  });

  console.log(`committing ${replayId}`);

  // pull down the replay and save it to the game doc
  const replay = await simulator.getReplay(replayId, server);

  // determine if the winner is on a streak
  const winner = replay.scores[0];
  const snapshot =
      await tournamentRef.collection('players').doc(winner.name).get();
  const {currentStreak} = snapshot.data() || {};

  // double points from the 3rd win in a row onward
  if (currentStreak >= 2) {
    winner.streak = true;
    winner.points *= 2;
  }

  // save the replay to the game doc
  const finished = Date.now();
  batch.update(gameSnapshot.ref, {
    replay,
    replayId,
    finished,
    status: GameStatus.FINISHED,
  });

  // update each of the player's leaderboard item
  for (const player of replay.scores) {
    // determine if this player is in the tournament
    const playerRef = tournamentRef.collection('players').doc(player.name);
    const playerDoc = await playerRef.get();
    if (!playerDoc.exists) continue;

    const recordId = `${replayId}_${player.name}`;
    const record = {
      replayId,
      finished,
      name: player.name,
      points: player.points,
      rank: player.rank,
      kills: player.kills,
      streak: player.streak,
    };

    // save the record in case we ever build features around this
    batch.create(tournamentRef.collection('records').doc(recordId), record);

    // update the player's points, streak, and record on the leaderboard
    batch.update(playerRef, {
      points: admin.firestore.FieldValue.increment(player.points),
      currentStreak:
          player.rank === 1 ? admin.firestore.FieldValue.increment(1) : 0,
      record: admin.firestore.FieldValue.arrayUnion(record),
    });
  }

  await batch.commit();
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