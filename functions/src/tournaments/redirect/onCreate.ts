import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {GameStatus} from '../../../../types';

try {
  admin.initializeApp();
} catch (e) {
  console.log(e);
}
const db = admin.firestore();

/**
 * Redirect documents being created spawns a game with these players, which will
 * be responsible for hitting the generals API to determine when this game ends
 */
export const onCreateRedirect =
    functions.firestore
        .document('tournaments/{tournamentId}/redirect/{redirectId}')
        .onCreate(async (doc, context) => {
          const tournamentId = context.params.tournamentId;
          const {players, started} = doc.data();

          return db.collection('tournaments')
              .doc(tournamentId)
              .collection('games')
              .add({players, started, status: GameStatus.STARTED});
        });