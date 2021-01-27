import {Injectable} from '@angular/core';
import {AngularFirestore} from '@angular/fire/firestore';
import * as firebase from 'firebase';
import {Observable} from 'rxjs';
import {map} from 'rxjs/operators';
import {IChatMessage} from 'types';
import {GeneralsService} from './generals.service';

@Injectable({providedIn: 'root'})
export class MessageService {
  constructor(
      private readonly afs: AngularFirestore,
      private readonly generals: GeneralsService,
  ) {}

  addEventMessage(eventId: string, text: string) {
    return this.afs.collection('events')
        .doc(eventId)
        .collection('messages')
        .add({
          text,
          sender: this.generals.name,
          timestamp: firebase.default.firestore.FieldValue.serverTimestamp()
        });
  }

  getEventMessages(eventId: string): Observable<IChatMessage[]> {
    return this.afs.collection('events')
        .doc(eventId)
        .collection('messages', ref => ref.orderBy('timestamp', 'desc'))
        .snapshotChanges()
        .pipe(map(actions => {
          return actions.map(action => {
            const message = action.payload.doc.data();
            message.timestamp = message.timestamp ?
                message.timestamp.toDate().getTime() :
                Date.now();
            return message as IChatMessage;
          });
        }));
  }
}
