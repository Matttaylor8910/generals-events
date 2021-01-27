import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {DocumentSnapshot} from 'firebase-functions/lib/providers/firestore';
import {IEvent} from '../../../types';

try {
  admin.initializeApp();
} catch (e) {
  console.log(e);
}
const db = admin.firestore();

export const onUpdateEvent =
    functions.firestore.document('tournaments/{eventId}')
        .onUpdate(async (eventDoc, context) => {
          const eventId = context.params.eventId;
          await checkQueue(eventDoc.after, eventId);
          return 'Done';
        });

async function checkQueue(snapshot: DocumentSnapshot, eventId: string) {
  const {endTime, queue, playersPerGame} = snapshot.data() as IEvent;

  // if the event isn't over, start a new game if there are enough players
  // in the queue to do so
  if (endTime > Date.now() && queue.length >= playersPerGame) {
    const players = queue.slice(0, playersPerGame);
    players.sort((a, b) => a.localeCompare(b));
    const started = Date.now();

    const id = `${players.join('_vs_')}`;

    const batch = db.batch();
    batch.update(snapshot.ref, {
      queue: admin.firestore.FieldValue.arrayRemove(...players),
    });
    batch.create(snapshot.ref.collection('redirect').doc(id), {
      lobby: `event_${eventId}_${started}`,
      started,
      players,
    });
    await batch.commit();
  }
}