import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

try {
  admin.initializeApp();
} catch (e) {
  console.log(e);
}
const db = admin.firestore();

export const onDeletePlayer =
    functions.firestore.document('tournaments/{eventId}/players/{playerId}')
        .onDelete(async (doc, context) => {
          const eventId = context.params.eventId;
          return db.collection('tournaments').doc(eventId).update({
            playerCount: admin.firestore.FieldValue.increment(-1)
          });
        });