import {Injectable} from '@angular/core';
import {AngularFirestore} from '@angular/fire/firestore';
import {Observable} from 'rxjs';
import {map} from 'rxjs/operators';
import {ITournament} from 'types';

@Injectable({providedIn: 'root'})
export class TournamentService {
  constructor(
      private readonly afs: AngularFirestore,
  ) {}

  createTournament(tournament: Partial<ITournament>) {
    return this.afs.collection('tournaments').add({
      name: 'New Tournament',
      queue: [],
      startTime: null,
      endTime: null,
      ...tournament,
    });
  }

  getTournaments(finished: boolean): Observable<ITournament[]> {
    return this.afs
        .collection<ITournament>(
            'tournaments',
            ref => {
              return ref.where('endTime', finished ? '!=' : '==', null)
                  .limit(10);
            })
        .snapshotChanges()
        .pipe(map(actions => {
          return actions
              .map(action => {
                const {doc} = action.payload;
                return {...doc.data(), id: doc.id};
              })
              .sort((a, b) => {
                return finished ? b.endTime - a.endTime :
                                  a.startTime - b.startTime;
              });
        }));
  }
}
