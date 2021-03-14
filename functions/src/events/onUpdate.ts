import * as functions from 'firebase-functions';
import {EventFormat, IEvent} from '../../../types';
import {handleArenaEventUpdate} from './arena';
import {handleDoubleElimEventUpdate} from './doubleElim';

export const onUpdateEvent =
    functions.firestore.document('events/{eventId}')
        .onUpdate(async (eventDoc, context) => {
          const eventId = context.params.eventId;
          const event = eventDoc.after?.data() as IEvent;

          switch (event?.format) {
            case EventFormat.ARENA:
              return handleArenaEventUpdate(eventDoc.after, eventId);
            case EventFormat.DOUBLE_ELIM:
              return handleDoubleElimEventUpdate(eventDoc.after, eventId);
            default:
              console.log('Unrecognized event type');
              return 'Error';
          }
        });