import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

import {IArenaEvent, ILeaderboardPlayer, IPlayerHistoryRecord} from '../../../../types';
import {getCurrentStars} from '../../util/generals';

import {recordSanityCheck} from './onUpdate';

try {
  admin.initializeApp();
} catch (e) {
  // do nothing, this is fine
}
const db = admin.firestore();

export const onCreatePlayer =
    functions.firestore.document('events/{eventId}/players/{playerId}')
        .onCreate(async (doc, context) => {
          const eventId = context.params.eventId;
          const eventRef = db.collection('events').doc(eventId);
          const eventSnap = await eventRef.get();
          const event = (eventSnap.data() || {}) as IArenaEvent;

          // if the disableJoin flag is on, delete any users that are somehow otherwise created
          if (event.disableJoin) {
            return doc.ref.delete();
          }

          const {name} = doc.data() as ILeaderboardPlayer;

          const recordSnapshots = await eventRef.collection('records')
                                      .where('name', '==', name)
                                      .get();

          const existing = (recordSnapshots.docs.map(snap => snap.data()) ||
                            []) as IPlayerHistoryRecord[];

          const {record, currentStreak, points} =
              recordSanityCheck(existing, event);

          const currentStars =
              await getCurrentStars(name, event.type, event.server);

          // if you already had records or points, give them back to you
          const batch = db.batch();
          batch.update(doc.ref, {
            record,
            points,
            currentStreak,
            'stats.currentStars': currentStars,
          });

          // update the player count for this event
          batch.update(eventRef, {
            playerCount: admin.firestore.FieldValue.increment(1),
          });

          return batch.commit();
        });