import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {DocumentSnapshot} from 'firebase-functions/lib/providers/firestore';

import {GameStatus, IGame, IGeneralsReplay, ITournament} from '../../../../types';
import {getLastReplayForUsername} from '../../util/api';
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
          // await checkReplay(gameDoc.before, gameDoc.after);
          await lookForFinishedGame(gameDoc.after);
          return 'Done';
        });

async function lookForFinishedGame(snapshot: DocumentSnapshot) {
  const game = snapshot.data() || {} as IGame;
  const {players} = game;
  const timesChecked = game.timesChecked || 0;
  const TWENTY_MINUTES = 120;  // 120 * 10 = 1200 -> 20 minutes (in seconds)

  // if we have a game with some players, and we haven't set a replayId yet,
  // find games for these players
  if (!game.replayId && players?.length && timesChecked < TWENTY_MINUTES) {
    // get list of tracked replays for a tournament
    const tournamentSnap = await snapshot.ref.parent.parent!.get();
    const tournament = tournamentSnap.data() || {} as ITournament;
    const trackedReplays = tournament.replays || [];

    console.log(`tracked replays for ${tournamentSnap.id}:`, trackedReplays);

    // for each player, request their latest replay
    const replayPromises: Promise<IGeneralsReplay>[] =
        players.map((player: string) => getLastReplayForUsername(player));

    // wait for all of those replays to load so we can compare those replays to
    // see if they're the same
    const replays: IGeneralsReplay[] = await Promise.all(replayPromises);

    // build up a map of the present replayIds and their counts
    const replayCounts = new Map<string, number>();
    console.log(`loaded ${replays.length} replays`);
    replays
        .filter(replay => {
          // replays must exist, not already be tracked, and have to start
          // after this game was created in the database
          return replay && !trackedReplays.includes(replay.id) &&
              replay.started > game.started;
        })
        .map(replay => replay.id)
        .forEach(replayId => {
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
    console.log(`${most.replayId} is shared by ${most.count} of the ${
        players.length} players`);

    // if over half (but not exactly half) of the og players were in this
    // game, and we have not tracked it already, count the game
    if (most.count > players.length / 2) {
      const batch = db.batch();
      batch.update(tournamentSnap.ref, {
        replays: admin.firestore.FieldValue.arrayUnion(most.replayId),
      });

      console.log(`committing ${most.replayId}`);

      // pull down the replay and save it
      const replay = await simulator.getReplay(most.replayId);
      batch.update(snapshot.ref, {
        replay,
        replayId: most.replayId,
        status: GameStatus.FINISHED,
      });

      // update each of the player's leaderboard item
      for (const player of replay.scores) {
        const recordId = `${snapshot.id}_${player.name}`;
        batch.create(tournamentSnap.ref.collection('records').doc(recordId), {
          name: player.name,
          replayId: most.replayId,
          points: player.points,
          win: player.rank === 1,
        });
      }

      await batch.commit();
      return;
    }

    // if we made it this far, gotta keep looking, start in 10 seconds
    await keepLookingIn10Seconds(snapshot);
  }
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