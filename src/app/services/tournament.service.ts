import {Injectable} from '@angular/core';
import {AngularFirestore} from '@angular/fire/firestore';
import * as firebase from 'firebase';
import {Observable} from 'rxjs';
import {map} from 'rxjs/operators';
import {ILeaderboardPlayer, ITournament} from 'types';

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
      playerCount: 0,
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

  getTournament(tournamentId: string): Observable<ITournament> {
    return this.afs.collection('tournaments')
        .doc<ITournament>(tournamentId)
        .snapshotChanges()
        .pipe(map(tournament => {
          return {...tournament.payload.data(), id: tournament.payload.id};
        }));
  }

  addPlayer(tournamentId: string, name: string) {
    return this.afs.collection('tournaments')
        .doc(tournamentId)
        .collection<ILeaderboardPlayer>('players')
        .doc(name)
        .set({name, rank: 0, points: 0, currentStreak: 0, record: []});
  }

  removePlayer(tournamentId: string, name: string) {
    return this.afs.collection('tournaments')
        .doc(tournamentId)
        .collection<ILeaderboardPlayer>('players')
        .doc(name)
        .delete();
  }

  getPlayers(tournamentId: string): Observable<ILeaderboardPlayer[]> {
    return this.afs.collection('tournaments')
        .doc(tournamentId)
        .collection<ILeaderboardPlayer>(
            'players', ref => ref.orderBy('points', 'desc').orderBy('name'))
        .snapshotChanges()
        .pipe(map(actions => {
          const players = actions.map(action => {
            return action.payload.doc.data();
          });

          let rank = 0;
          let gap = 1;
          let lastPoints = -1;
          for (const player of players) {
            if (lastPoints !== player.points) {
              rank += gap;
              gap = 1;
            } else {
              gap++;
            }
            player.rank = rank;
            lastPoints = player.points;
          }

          return players;
        }));
  }

  joinQueue(tournamentId: string, name: string) {
    return this.afs.collection('tournaments').doc(tournamentId).update({
      queue: firebase.default.firestore.FieldValue.arrayUnion(name)
    });
  }

  leaveQueue(tournamentId: string, name: string) {
    return this.afs.collection('tournaments').doc(tournamentId).update({
      queue: firebase.default.firestore.FieldValue.arrayRemove(name)
    });
  }

  getRedirect(tournamentId: string, name: string):
      Observable<{lobby: string, id: string}> {
    return this.afs.collection('tournaments')
        .doc(tournamentId)
        .collection(
            'redirect',
            ref => {
              return ref.where('players', 'array-contains', name);
            })
        .snapshotChanges()
        .pipe(map(redirects => {
          if (!redirects?.length) {
            return null;
          }
          return {
            lobby: redirects[0].payload.doc.data()?.lobby,
                id: redirects[0].payload.doc.id,
          }
        }));
  }

  clearRedirect(tournamentId: string, redirectId: string, name: string) {
    return this.afs.collection('tournaments')
        .doc(tournamentId)
        .collection('redirect')
        .doc(redirectId)
        .set({
          players: firebase.default.firestore.FieldValue.arrayRemove(name),
        });
  }
}
