import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

import {IArenaEvent, ILeaderboardPlayer} from '../../../types';
import {getCurrentStars} from '../util/generals';

try {
  admin.initializeApp();
} catch (e) {
  // do nothing, this is fine
}
const db = admin.firestore();

export const getEventStars =
    functions.pubsub.schedule('every 1 hours').onRun(async (context) => {
      const events = await db.collection('events')
                         .where('startTime', '>', Date.now())
                         .get();


      for (const doc of events.docs) {
        const {type, server} = (doc.data() || {}) as IArenaEvent;
        const players = await doc.ref.collection('players').get();

        const batch = db.batch();
        for (const player of players.docs) {
          const {name} = (player.data() || {}) as ILeaderboardPlayer;
          const currentStars = await getCurrentStars(name, type, server);
          batch.update(player.ref, {'stats.currentStars': currentStars});
        }
        await batch.commit();
      }
    });