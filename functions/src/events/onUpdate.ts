import * as functions from 'firebase-functions';

// export const onUpdateEvent = functions.firestore.document('events/{eventId}')
//                                  .onUpdate(async (eventDoc, context) => {
//                                    const eventId = context.params.eventId;
//                                    await checkQueue(eventDoc.after, eventId);
//                                    return 'Done';
//                                  });


import {EventFormat, IEvent} from '../../../types';
import {handleArenaEventUpdate} from './arena';
import {handleDoubleElimEventUpdate} from './doubleElim';
import {handleDynamicDYPUpdate} from './dynamicDYP';

export const onUpdateEvent =
    functions.firestore.document('events/{eventId}')
        .onUpdate(async (eventDoc, context) => {
          const event = eventDoc.after?.data() as IEvent;

          switch (event?.format) {
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
