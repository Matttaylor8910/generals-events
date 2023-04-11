import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {EventFormat, IEvent} from '../../../types';
import {handleArenaEventUpdate} from './arena';
import {handleDoubleElimEventUpdate} from './doubleElim';
import {handleDynamicDYPUpdate} from './dynamicDYP';
import { QueryDocumentSnapshot } from 'firebase-functions/v1/firestore';

try {
  admin.initializeApp();
} catch (e) {
  // do nothing, this is fine
}
const db = admin.firestore();

export const onUpdateEvent =
    functions.firestore.document('events/{eventId}')
        .onUpdate(async (eventDoc, context) => {
          const {format} = eventDoc.after?.data() ?? {} as IEvent;

          await handleChatBlocklist(eventDoc)

          switch (format) {
            case EventFormat.ARENA:
              return handleArenaEventUpdate(eventDoc.after);
            case EventFormat.DOUBLE_ELIM:
              return handleDoubleElimEventUpdate(eventDoc.after);
            case EventFormat.DYNAMIC_DYP:
              return handleDynamicDYPUpdate(eventDoc.after);
            default:
              console.log('Unrecognized event type');
              return 'Error';
          }
        });

async function handleChatBlocklist(eventDoc: functions.Change<QueryDocumentSnapshot>) {
  const before = ((eventDoc.before?.data() ?? {}).chatBlocklist ?? []) as string[];
  const after = ((eventDoc.after?.data() ?? {}).chatBlocklist ?? []) as string[];

  if (before.length < after.length) {
    const diff = after.filter(a => !before.includes(a));
    const batch = db.batch();
    const messagesRef = eventDoc.after.ref.collection('messages');
    
    // for every username that was added to the chatBlocklist, find all messages sent
    // by them and delete them
    await Promise.all(diff.map(username => {
      return messagesRef.where('sender', '==', username).get().then(snapshot => {
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
      });
    }));

    // commit all deletes at once
    await batch.commit();
  }
}