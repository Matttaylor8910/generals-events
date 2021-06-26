import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {GameStatus} from '../../../../types';

try {
  admin.initializeApp();
} catch (e) {
  // do nothing, this is fine
}
const db = admin.firestore();

/**
 * Redirect documents being created spawns a game with these players, which will
 * be responsible for hitting the generals API to determine when this game ends
 */
export const onCreateRedirect =
    functions.firestore.document('events/{eventId}/redirect/{redirectId}')
        .onCreate(async (doc, context) => {
          const eventId = context.params.eventId;
          const {players, started} = doc.data();

          return db.collection('events').doc(eventId).collection('games').add(
              {players, started, status: GameStatus.STARTED});
        });