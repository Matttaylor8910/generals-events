import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {DocumentSnapshot} from 'firebase-functions/lib/providers/firestore';
import {flatten} from 'lodash';

import {GeneralsServer} from '../../../../constants';
import {EventType, GameSpeed, GameStatus, IArenaEvent, IGame, IGeneralsReplay, ILeaderboardPlayer} from '../../../../types';
import {getReplaysForUsername} from '../../util/generals';
import * as simulator from '../../util/simulator';
import {getFinishedTime, timeoutAfter, keepLookingIn10Seconds} from '../../util/util';

try {
  admin.initializeApp();
} catch (e) {
  // do nothing, this is fine
}
const db = admin.firestore();

export const onWriteGame =
    functions.firestore.document('events/{eventId}/games/{gameId}')
        .onWrite(async (gameDoc, context) => {
          if (gameDoc.after.exists) {
            const eventRef = gameDoc.after.ref.parent.parent!;

            // on create, increment the amount on ongoing games
            if (!gameDoc.before.exists) {
              await eventRef.update({
                ongoingGameCount: admin.firestore.FieldValue.increment(1),
              });
            }

            try {
              await lookForFinishedGame(gameDoc.after, eventRef);
            } catch (error) {
              console.log(gameDoc.after.id, error);
              await keepLookingIn10Seconds(gameDoc.after);
            }
          }
          return 'Done';
        });

async function lookForFinishedGame(
    snapshot: DocumentSnapshot,
    eventRef: admin.firestore.DocumentReference,
    ): Promise<any> {
  const game = (snapshot.data() || {}) as IGame;
  const {players} = game;
  const timesChecked = game.timesChecked || 0;
  const TWENTY_MINUTES = 12000;  // 120 * 10 = 1200 -> 20 minutes (in seconds)

  console.log(`looking for finished game ${snapshot.id}`);

  // if we still haven't found a replay within 20 minutes, pull the plug
  // note: the /games subcollection only applies to FFA Arena events
  if (timesChecked >= TWENTY_MINUTES) {
    console.log('it has been 20 minutes');
    await eventRef.update({
      ongoingGameCount: admin.firestore.FieldValue.increment(-1),
    });
    return await snapshot.ref.delete();
  }

  // get the event data
  const eventSnap = await eventRef.get();
  const event = (eventSnap.data() || {}) as IArenaEvent;

  const {replayId, started} = game;
  console.log(`looking at game ${snapshot.id}, replayId: ${
      replayId}, started: ${started}`);

  // if we have a game with some players, and we haven't set a replayId yet,
  // find games for these players
  if (!replayId && players?.length) {
    // get the list of tracked replays for this event
    const trackedReplays = event.replays || [];
    console.log(`${trackedReplays.length} tracked replays for ${eventSnap.id}`);

    // wait for all of those replays to load so we can compare those replays to
    // see if they're the same
    const replays = await getReplaysForPlayers(
        players, trackedReplays, game.started, event.server);

    console.log('got all replays for players')

    const {count, replay} = getMostPrevalentReplay(replays);
    if (replay) {
      console.log(`${replay.id} is shared by ${count} of the ${
          players.length} players`);
    }

    if (count > players.length / 2) {
      // if over half (but not exactly half) of the og players were in this
      // game, and we have not tracked it already, count the game
      await saveReplayToGame(
          replay.id, replay.started, snapshot, eventRef, event);
    } else {
      // otherwise, gotta keep looking, start in 10 seconds
      await keepLookingIn10Seconds(snapshot);
    }
  }

  // in the case of there being no replay, but there is a replayId and started
  // timestamp, we can pull down the replay and calculate scores for this game
  else if (!game.replay && (replayId && started)) {
    console.log('we have a replayId and started, save replay to game');
    await saveReplayToGame(replayId, started, snapshot, eventRef, event);
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
  // for each player, request their latest 80 replays
  const replayPromises: Promise<IGeneralsReplay[]>[] =
      usernames.map(name => getReplaysForUsername(name, 0, 80, server));

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

async function saveReplayToGame(
    replayId: string,
    started: number,
    gameSnapshot: DocumentSnapshot,
    eventRef: admin.firestore.DocumentReference,
    event: IArenaEvent,
    ): Promise<void> {
  const batch = db.batch();
  batch.update(eventRef, {
    replays: admin.firestore.FieldValue.arrayUnion(replayId),
    completedGameCount: admin.firestore.FieldValue.increment(1),
    ongoingGameCount: admin.firestore.FieldValue.increment(-1),
  });

  console.log(`getting replay stats for ${replayId}`);

  // pull down the replay and save it to the game doc
  const {scores, summary, turns} =
      await simulator.getReplayStats(replayId, event.server);


  const speed = event.options?.speed ?? GameSpeed.SPEED_1X;
  const finished = getFinishedTime(started, turns, speed);
  const afterTime = event.endTime < finished;

  // determine if the winner is on a streak
  const [winner, second] = scores;
  const snapshot = await eventRef.collection('players').doc(winner.name).get();
  const {currentStreak} = snapshot.data() || {};

  // don't do streaks for FFA, instead just give a 5 point bonus for 1st
  if (event.type === EventType.FFA) {
    winner.points += 5;

    // to encourage long battles, award extra points to first and second so they
    // can duke it out
    if (!afterTime) {
      const mins = Math.floor(turns / 60);
      winner.points += mins;
      second.points += Math.floor(mins / 2);
    }
  }
  // all other types, double points from the 3rd win in a row onward
  // we use the number 2 here because currentStreak is about to be updated to
  // 3+, but could currently be 2 in the database prior to this game
  else if (currentStreak >= 2) {
    winner.streak = true;
    winner.points *= 2;
  }

  // save the replay to the game doc
  batch.update(gameSnapshot.ref, {
    replayId: replayId,
    started: started,
    finished: finished,
    replay: {scores, summary, turns},
    status: GameStatus.FINISHED,
  });

  // update each of the player's leaderboard item
  for (const player of scores) {
    // determine if this player is in the event
    const playerRef = eventRef.collection('players').doc(player.name);
    const playerDoc = await playerRef.get();
    if (!playerDoc.exists) continue;

    const recordId = `${replayId}_${player.name}`;

    // determine finished for this player based on their last turn
    const record = {
      replayId: replayId,
      started: started,
      finished: getFinishedTime(started, player.lastTurn, speed),
      ...player,
    };

    // save the record in case we ever build features around this
    batch.set(eventRef.collection('records').doc(recordId), record);

    // set lastThreeOpponents if this is a 1v1 event
    let opponents: string[] = [];
    if (event.type === EventType.ONE_VS_ONE) {
      const {lastThreeOpponents = []} =
          playerDoc.data() as ILeaderboardPlayer;
      const opponent = scores.find(p => p.name !== player.name)?.name;
      opponents = [opponent, ...lastThreeOpponents.slice(0, 2)];
    }

    // update the player's points, streak, and record on the leaderboard
    batch.update(playerRef, {
      points: admin.firestore.FieldValue.increment(player.points),
      currentStreak:
          player.rank === 1 ? admin.firestore.FieldValue.increment(1) : 0,
      record: admin.firestore.FieldValue.arrayUnion(record),
      lastThreeOpponents: opponents,
    });
  }

  console.log('committing...');
  await batch.commit();
  console.log('done!');
}