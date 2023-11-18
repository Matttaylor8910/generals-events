import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import {EventFormat, EventType, IEvent, Visibility} from '../../../types';
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
          const {format, type} = eventDoc.after?.data() ?? {} as IEvent;

          await handleChatBlocklist(eventDoc);
          await handleWinners(eventDoc, type);

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

async function handleWinners(eventDoc: functions.Change<QueryDocumentSnapshot>, type: EventType) {
  const before = ((eventDoc.before?.data() ?? {}).winners ?? []) as string[];
  const after = ((eventDoc.after?.data() ?? {}).winners ?? []) as string[];
  
  // if this is not a public event, no-op
  // only public events should update the champions
  const {visibility} = eventDoc.after.data() || {} as IEvent;
  if (visibility !== Visibility.PUBLIC) return;
  
  // if there is any change in the winners, update the current
  if (after.length !== before.length || after.some(name => !before.includes(name))) {
    const homepageRef = db.collection('generals.io').doc('homepage');
    const { champions } = (await homepageRef.get()).data() as {champions: {players: string[], type: string}[]};
    const event = champions.find(event => event.type === type);
    
    // if this event's type matches one of the types in the champions array, update those players
    // multi-stage events still are manual
    if (event) {
      event.players = after;
      await homepageRef.update({champions});
    }
  }
}

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