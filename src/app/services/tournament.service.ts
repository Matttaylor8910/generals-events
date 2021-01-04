import {Injectable} from '@angular/core';
import {AngularFirestore} from '@angular/fire/firestore';
import {Observable} from 'rxjs';
import {map} from 'rxjs/operators';
import {Tournament} from 'types';

@Injectable({providedIn: 'root'})
export class TournamentService {
  constructor(
      private readonly afs: AngularFirestore,
  ) {}

  createTournament(tournament: Partial<Tournament>) {
    return this.afs.collection('tournaments').add({
      queue: [],
      startTime: null,
      endTime: null,
      ...tournament,
    });
  }

  getTournaments(finished: boolean): Observable<Tournament[]> {
    return this.afs
        .collection<Tournament>(
            'tournaments',
            ref => {
              let query = ref.orderBy('asc');

              if (finished) {
                query = ref.where('endTime', '!=', null);
              }

              return query;
            })
        .snapshotChanges()
        .pipe(map(actions => {return actions.map(action => {
                    const {doc} = action.payload;
                    return {...doc.data(), id: doc.id};
                  })}));
  }
}
