import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {DocumentSnapshot} from 'firebase-functions/lib/providers/firestore';
import {flatten} from 'lodash';

import {GeneralsServer} from '../../../../constants';
import {GameStatus, IGame, IGeneralsReplay, ITournament, TournamentType} from '../../../../types';
import {getReplaysForUsername} from '../../util/generals';
import * as simulator from '../../util/simulator';
import {timeoutAfter} from '../../util/util';

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
            const tournamentRef = gameDoc.after.ref.parent.parent!;

            // on create, increment the amount on ongoing games
            if (!gameDoc.before.exists) {
              await tournamentRef.update({
                ongoingGameCount: admin.firestore.FieldValue.increment(1),
              });
            }

            try {
              await lookForFinishedGame(gameDoc.after, tournamentRef);
            } catch (error) {
              console.log(gameDoc.after.id, error);
              await keepLookingIn10Seconds(gameDoc.after);
            }
          }
          return 'Done';
        });

async function lookForFinishedGame(
    snapshot: DocumentSnapshot,
    tournamentRef: admin.firestore.DocumentReference,
    ): Promise<any> {
  const game = (snapshot.data() || {}) as IGame;
  const {players} = game;
  const timesChecked = game.timesChecked || 0;
  const TWENTY_MINUTES = 120;  // 120 * 10 = 1200 -> 20 minutes (in seconds)

  console.log(`looking for finished game ${snapshot.id}`);

  // if we still haven't found a replay within 20 minutes, pull the plug
  if (timesChecked >= TWENTY_MINUTES) {
    console.log('it has been 20 minutes');
    await tournamentRef.update({
      ongoingGameCount: admin.firestore.FieldValue.increment(-1),
    });
    return await snapshot.ref.delete();
  }

  // if we have a game with some players, and we haven't set a replayId yet,
  // find games for these players
  if (!game.replayId && players?.length) {
    // get list of tracked replays for a tournament
    const tournamentSnap = await tournamentRef.get();
    const tournament = (tournamentSnap.data() || {}) as ITournament;
    const trackedReplays = tournament.replays || [];

    console.log(
        `${trackedReplays.length} tracked replays for ${tournamentSnap.id}`);

    // wait for all of those replays to load so we can compare those replays to
    // see if they're the same
    const replays = await getReplaysForPlayers(
        players, trackedReplays, game.started, tournament.server);

    console.log('got all replays for players')

    const {count, replay} = getMostPrevalentReplay(replays);
    if (replay) {
      console.log(`${replay.id} is shared by ${count} of the ${
          players.length} players`);
    }

    if (count > players.length / 2) {
      // if over half (but not exactly half) of the og players were in this
      // game, and we have not tracked it already, count the game
      await saveReplayToGame(replay, snapshot, tournamentRef, tournament);
    } else {
      // otherwise, gotta keep looking, start in 10 seconds
      await keepLookingIn10Seconds(snapshot);
    }
  }
}

/**
 * Given the list of usernames, get the last 10 replays for each of them, and
 * then return a list of the replays that:
 * 1) aren't already tracked on this tournament
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
    timeoutAfter(1000, []),
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

async function saveReplayToGame(
    replay: IGeneralsReplay,
    gameSnapshot: DocumentSnapshot,
    tournamentRef: admin.firestore.DocumentReference,
    tournament: ITournament,
    ): Promise<void> {
  const batch = db.batch();
  batch.update(tournamentRef, {
    replays: admin.firestore.FieldValue.arrayUnion(replay.id),
    completedGameCount: admin.firestore.FieldValue.increment(1),
    ongoingGameCount: admin.firestore.FieldValue.increment(-1),
  });

  console.log(`getting replay stats for ${replay.id}`);

  // pull down the replay and save it to the game doc
  const {scores, summary, turns} =
      await simulator.getReplayStats(replay.id, tournament.server);

  // determine if the winner is on a streak
  const winner = scores[0];
  const snapshot =
      await tournamentRef.collection('players').doc(winner.name).get();
  const {currentStreak} = snapshot.data() || {};

  // don't do streaks for FFA, instead just give a 5 point bonus for 1st
  if (tournament.type === TournamentType.FFA) {
    winner.points += 5;
  }
  // all other types, double points from the 3rd win in a row onward
  // we use the number 2 here because currentStreak is about to be updated to
  // 3+, but could currently be 2 in the database prior to this game
  else if (currentStreak >= 2) {
    winner.streak = true;
    winner.points *= 2;
  }

  // save the replay to the game doc
  const finished = replay.started + (turns * 1000);
  const tooLate = tournament.endTime < finished;
  batch.update(gameSnapshot.ref, {
    replayId: replay.id,
    started: replay.started,
    finished: finished,
    replay: {scores, summary, turns},
    status: tooLate ? GameStatus.TOO_LATE : GameStatus.FINISHED,
  });

  // update each of the player's leaderboard item if the game finished before
  // the clock ran out
  if (!tooLate) {
    for (const player of scores) {
      // determine if this player is in the tournament
      const playerRef = tournamentRef.collection('players').doc(player.name);
      const playerDoc = await playerRef.get();
      if (!playerDoc.exists) continue;

      const recordId = `${replay.id}_${player.name}`;
      // determine finished for this player based on their last turn
      const record = {
        replayId: replay.id,
        started: replay.started,
        finished: replay.started + (player.lastTurn * 1000),
        ...player,
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