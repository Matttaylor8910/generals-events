import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {DocumentSnapshot} from 'firebase-functions/lib/providers/firestore';

try {
  admin.initializeApp();
} catch (e) {
  // do nothing, this is fine
}

export const onUpdateRedirect =
    functions.firestore.document('events/{eventId}/redirect/{redirectId}')
        .onUpdate(async (doc, context) => {
          await checkQueue(doc.after);
          return 'Done';
        });

/**
 * Check to see if the queue is empty (everyone has been redirected) and once it
 * has been, delete this document in 10 seconds to ensure this doc isn't
 * generated a second time, but make it possible for a game with this player
 * combo to be possible again in after 10 seconds have passed
 * @param snapshot
 */
async function checkQueue(snapshot: DocumentSnapshot) {
  const {players} = snapshot.data() || {};
  if (players?.length === 0) {
    await deleteIn10Seconds(snapshot);
  }
}

async function deleteIn10Seconds(snapshot: DocumentSnapshot): Promise<void> {
  return new Promise(resolve => {
    setTimeout(async () => {
      await snapshot.ref.delete();
      resolve();
    }, 10000);
  });
}