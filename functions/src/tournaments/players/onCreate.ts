import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

import {ILeaderboardPlayer, IPlayerHistoryRecord, ITournament} from '../../../../types';
import {getCurrentStars} from '../../util/generals';

import {recordSanityCheck} from './onUpdate';

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
          const tournamentSnap = await tournamentRef.get();
          const tournament = (tournamentSnap.data() || {}) as ITournament;

          const {name} = doc.data() as ILeaderboardPlayer;

          const recordSnapshots = await tournamentRef.collection('records')
                                      .where('name', '==', name)
                                      .get();

          const existing = (recordSnapshots.docs.map(snap => snap.data()) ||
                            []) as IPlayerHistoryRecord[];

          const {record, currentStreak, points} =
              recordSanityCheck(existing, tournament);

          const currentStars =
              await getCurrentStars(name, tournament.type, tournament.server);

          // if you already had records or points, give them back to you
          const batch = db.batch();
          batch.update(doc.ref, {
            record,
            points,
            currentStreak,
            'stats.currentStars': currentStars,
          });

          // update the player count for this tournament
          batch.update(tournamentRef, {
            playerCount: admin.firestore.FieldValue.increment(1),
          });

          return batch.commit();
        });