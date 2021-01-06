import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

try {
  admin.initializeApp();
} catch (e) {
  console.log(e);
}
const db = admin.firestore();

export const onCreatePlayer =
    functions.firestore
        .document('tournaments/{tournamentId}/players/{playerId}')
        .onCreate(async (doc, context) => {
          const tournamentId = context.params.tournamentId;
          return db.collection('tournaments').doc(tournamentId).update({
            playerCount: admin.firestore.FieldValue.increment(1)
          });
        });