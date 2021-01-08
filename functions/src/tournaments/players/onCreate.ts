import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {ILeaderboardPlayer, IPlayerHistoryRecord} from '../../../../types';

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
          const tournamentRef = db.collection('tournaments').doc(tournamentId);
          const {name} = doc.data() as ILeaderboardPlayer;

          const recordSnapshots = await tournamentRef.collection('records')
                                      .where('name', '==', name)
                                      .get();

          const record = (recordSnapshots.docs.map(snap => snap.data()) ||
                          []) as IPlayerHistoryRecord[];

          // if you already had records or points, give them back to you
          await doc.ref.update({
            record,
            points: record.map(r => r.points).reduce((a, b) => a + b),
          });

          return tournamentRef.update({
            playerCount: admin.firestore.FieldValue.increment(1),
          });
        });