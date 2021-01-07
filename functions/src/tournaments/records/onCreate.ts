import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {IPlayerHistoryRecord} from '../../../../types';

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
          const record = doc.data() as IPlayerHistoryRecord;

          return db.collection('tournaments')
              .doc(tournamentId)
              .collection('players')
              .doc(record.name)
              .update({
                points: admin.firestore.FieldValue.increment(record.points),
                currentStreak:
                    record.win ? admin.firestore.FieldValue.increment(1) : 0,
                record: admin.firestore.FieldValue.arrayUnion({
                  replayId: record.replayId,
                  points: record.points,
                  onStreak: false,  // TODO: support streaks?
                  win: record.win,
                }),
              });
        });