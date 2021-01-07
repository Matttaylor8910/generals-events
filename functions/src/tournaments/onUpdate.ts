import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {DocumentSnapshot} from 'firebase-functions/lib/providers/firestore';
import {ITournament} from '../../../types';

try {
  admin.initializeApp();
} catch (e) {
  console.log(e);
}
const db = admin.firestore();

export const onUpdateTournament =
    functions.firestore.document('tournaments/{tournamentId}')
        .onUpdate(async (gameDoc, context) => {
          const tournamentId = context.params.tournamentId;
          await checkQueue(gameDoc.after, tournamentId);
          return 'Done';
        });

async function checkQueue(snapshot: DocumentSnapshot, tournamentId: string) {
  const {endTime, queue, playersPerGame} = snapshot.data() as ITournament;

  // if the tournament isn't over, start a new game if there are enough players
  // in the queue to do so
  if (!endTime && queue.length >= playersPerGame) {
    const players = queue.slice(0, playersPerGame);
    players.sort((a, b) => a.localeCompare(b));
    const started = Date.now();

    const id = `${players.join('_vs_')}`;

    const batch = db.batch();
    batch.update(snapshot.ref, {
      queue: admin.firestore.FieldValue.arrayRemove(...players),
    });
    batch.create(snapshot.ref.collection('redirect').doc(id), {
      lobby: `tournament_${tournamentId}_${started}`,
      started,
      players,
    });
    await batch.commit();
  }
}