import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {ILeaderboardPlayer, IPlayerHistoryRecord} from '../../../../types';

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
export const onCreateRecord =
    functions.firestore
        .document('tournaments/{tournamentId}/records/{recordId}')
        .onCreate(async (doc, context) => {
          const tournamentId = context.params.tournamentId;
          const tournamentRef = db.collection('tournaments').doc(tournamentId);

          const record = doc.data() as IPlayerHistoryRecord;
          const winner = record.rank === 1;

          const snapshot =
              await tournamentRef.collection('players').doc(record.name).get();
          const {currentStreak} = (snapshot.data() || {}) as ILeaderboardPlayer;

          // double points from the 3rd win in a row onward
          if (currentStreak >= 2 && winner) {
            record.points *= 2;
            record.streak = true;
          }

          return tournamentRef.collection('players').doc(record.name).update({
            points: admin.firestore.FieldValue.increment(record.points),
            currentStreak: winner ? admin.firestore.FieldValue.increment(1) : 0,
            record: admin.firestore.FieldValue.arrayUnion(record),
          });
        });