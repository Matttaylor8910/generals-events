import {Injectable} from '@angular/core';
import {AngularFirestore} from '@angular/fire/firestore';
import {flatten} from 'lodash';
import {Observable} from 'rxjs';
import {map} from 'rxjs/operators';
import {IGeneralsReplay, IPlayerProfile, IPlayerReplaysChunk} from 'types';

@Injectable({providedIn: 'root'})
export class ProfileService {
  constructor(
      private afs: AngularFirestore,
  ) {}

  getProfile(name: string): Observable<IPlayerProfile> {
    return this.afs.collection('players')
        .doc<IPlayerProfile>(name)
        .snapshotChanges()
        .pipe(map(event => {
          return {
            ...event.payload.data(),
            exists: event.payload.exists,
          };
        }));
  }

  getReplays(name: string): Observable<IGeneralsReplay[]> {
    return this.afs.collection<IPlayerProfile>('players')
        .doc(name)
        .collection<IPlayerReplaysChunk>('replays')
        .snapshotChanges()
        .pipe(map(actions => {
          const replays = actions
                              .map(action => {
                                const {doc} = action.payload;
                                return {...doc.data()};
                              })
                              .sort((a, b) => {
                                return a.order - b.order;
                              })
                              .map(a => a.replays);

          console.log(`loaded ${replays.length} chunks`);

          return flatten(replays).sort((a, b) => a.started - b.started);
        }));
  }
}
