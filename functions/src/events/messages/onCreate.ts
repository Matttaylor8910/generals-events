import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

import {IChatMessage, IEvent} from '../../../../types';
import {postToSlack} from '../../util/slack';

try {
  admin.initializeApp();
} catch (e) {
  // do nothing, this is fine
}
const db = admin.firestore();

export const onCreateMessage =
    functions.firestore.document('events/{eventId}/messages/{messageId}')
        .onCreate(async (doc, context) => {
          const eventId = context.params.eventId;
          const eventRef = db.collection('events').doc(eventId);
          const eventSnap = await eventRef.get();
          const {name, chatBlocklist = []} = (eventSnap.data() || {}) as IEvent;

          const {sender, text} = doc.data() as IChatMessage;

          if (chatBlocklist.includes(sender)) {
            await doc.ref.delete();
            return postToSlack(`DELETED MESSAGE\n${name}:\n${sender}: ${text}`);
          } else {
            return postToSlack(`${name}:\n${sender}: ${text}`);
          }
        });