import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {flatten} from 'lodash';

import {IGeneralsReplay, IPlayerProfile, PlayerProfileStatus} from '../../../../types';
import {getReplaysForUsername} from '../../util/generals';
import {timeoutAfter} from '../../util/util';

try {
  admin.initializeApp();
} catch (e) {
  // do nothing, this is fine
}
const db = admin.firestore();

export const getReplaysForUser =
    functions.runWith({memory: '1GB', timeoutSeconds: 360})
        .https.onCall(async (name) => {
          // make a reference to the player and get their current status
          const playerRef = db.collection('players').doc(name);
          const player = await playerRef.get();
          const {status = PlayerProfileStatus.FIRST_LOAD} =
              player.data() || {} as IPlayerProfile;
          console.log(`${name} profile status: ${status}`);

          // stop early if there is already another function loading the recent
          // results
          if (status === PlayerProfileStatus.LOADING) {
            console.log(`${name} is already being calculated`);
            return;
          }

          // set the initial status if this is the first load
          if (status === PlayerProfileStatus.FIRST_LOAD) {
            await playerRef.set({status}, {merge: true});
          } else {
            await playerRef.set(
                {status: PlayerProfileStatus.LOADING},
                {merge: true},
            );
          }

          // if this player profile doesn't exist yet, create it and set the
          // status
          const totalGames = await countGames(name);
          await playerRef.set({totalGames}, {merge: true});
          console.log(`${name} total games: ${totalGames}`);

          // load all replays
          const allReplays = await getAllReplays(name, totalGames);
          const lastReplayId = allReplays.length > 0 ? allReplays[0].id : null;
          console.log(
              `Found ${allReplays.length} replays, last: ${lastReplayId}`);

          // save replays in chunks, multiple replays per doc, to save on db
          // reads when reading this data for charts
          const chunkSize = 2000;
          for (let i = 0; i < allReplays.length; i += chunkSize) {
            const chunk = Math.floor(i / chunkSize);
            await playerRef.collection('replays').doc(`chunk_${chunk}`).set({
              replays: allReplays.slice(i, i + chunkSize),
              order: chunk,
            });
          }

          // save the player stats
          return playerRef.update({
            status: PlayerProfileStatus.LOADED,
            lastUpdated: Date.now(),
            lastReplayId,
            totalGames: allReplays.length,
          });
        });

/**
 * Load and return all replays played by a given player
 */
async function getAllReplays(
    name: string, totalGames: number): Promise<IGeneralsReplay[]> {
  // find all replays in parallel
  const count = 200;
  const replayPromises = [];
  for (let offset = 0; offset < totalGames; offset += count) {
    replayPromises.push(getReplaysForUsername(name, offset, count));
  }

  // wait for all requests to come back or timeout after 60 seconds
  const replays = await Promise.race([
    Promise.all(replayPromises),
    timeoutAfter(60000, []),
  ]);
  return flatten(replays);
}

/**
 * Find the total number of games for a player using binary search
 */
async function countGames(name: string): Promise<number> {
  let low = 0;
  let high = 1000000;
  while (low !== high) {
    const mid = Math.floor((low + high + 1) / 2);
    const replay = await getReplaysForUsername(name, mid, 1);
    if (replay.length === 0) {
      high = mid - 1;
    } else {
      low = mid;
    }
  }
  return low - 1;
}