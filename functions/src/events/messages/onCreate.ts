import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

import {IChatMessage, IDoubleElimEvent, IEvent} from '../../../../types';
import {postToSlack} from '../../util/slack';
import {ADMINS} from '../../../../constants';

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
          const event = (eventSnap.data() || {}) as IEvent;
          const {name, chatBlocklist = [], disableChat = false} = event;

          const {qualified = []} = event as IDoubleElimEvent;
          const {sender, text} = doc.data() as IChatMessage;
          const canSendMessage = qualified.length === 0 || qualified.includes(sender) || ADMINS.includes(sender);

          if (chatBlocklist.includes(sender) || !canSendMessage || disableChat) {
            await doc.ref.delete();
            return postToSlack(`DELETED MESSAGE\n${name}:\n${sender}: ${text}`);
          } else {
            return postToSlack(`${name}:\n${sender}: ${text}`);
          }
        });