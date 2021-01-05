import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {DocumentSnapshot} from 'firebase-functions/lib/providers/firestore';
import {IGame} from '../../../../types';
import {getReplay} from '../../util/simulator';

try {
  admin.initializeApp();
} catch (e) {
  console.log(e);
}

export const onWriteGame =
    functions.firestore.document('tournaments/{tourneyId}/games/{gameId}')
        .onWrite(async (gameDoc, context) => {
          await checkReplay(gameDoc.before, gameDoc.after);
          return 'Done';
        });

async function checkReplay(before: DocumentSnapshot, after: DocumentSnapshot) {
  const {replayId: beforeId} = before.data() || {} as IGame;
  const {replayId: afterId} = after.data() || {} as IGame;

  // get the replay info when a replay is added to the game
  if (beforeId !== afterId && afterId !== undefined) {
    const replay = await getReplay(afterId);
    await after.ref.update({replay});
  }
}